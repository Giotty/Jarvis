const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { defaults, schema } = require('../core/config.cjs');
const { Safety } = require('../core/safety.cjs');
const { validate, Executor, safePath } = require('../core/tools.cjs');
const { Store } = require('../core/store.cjs');
const { Planner } = require('./legacy/planner.cjs');
const { Vision } = require('../core/vision.cjs');
const { Audit } = require('../core/log.cjs');
const { telemetry } = require('../core/telemetry.cjs');
test('configuration defaults preserve privacy and rejects remote AI endpoints', () => {
  const c = defaults();
  assert.equal(c.mock, false);
  assert.equal(c.microphone, false);
  assert.equal(c.mouse, false);
  assert.throws(() => schema.parse({ ...c, ollamaUrl: 'https://example.com' }));
  assert.throws(() => schema.parse({ ...c, interval: 1 }));
  assert.throws(() => schema.parse({ ...c, disableSafety: true }));
});
test('fixed risks cannot be downgraded by model parameters', () => {
  assert.equal(validate({ tool: 'delete_file', args: { path: 'x' } }).risk, 3);
  assert.equal(validate({ tool: 'click_mouse', args: { x: 10, y: 10 } }).risk, 2);
  assert.throws(() => validate({ tool: 'type_text', args: { text: 'abc', risk: 0 } }));
  assert.equal(
    validate({ tool: 'run_powershell', args: { command: 'Get-ItemProperty HKCU:\\Software' } })
      .risk,
    3,
  );
  assert.throws(() => validate({ tool: 'run_powershell', args: { command: 'Get-Date', risk: 0 } }));
  assert.throws(() => validate({ tool: 'open_url', args: { url: 'file:///C:/Windows' } }));
});
test('approval is immutable, single-use, expiring and cancelled by stop', () => {
  const s = new Safety(),
    a = { tool: 'delete_file', args: { path: 'one' } };
  const p = s.require(a, 3, 'task');
  a.args.path = 'two';
  assert.equal(s.consume(p.id, true).args.path, 'one');
  assert.throws(() => s.consume(p.id, true));
  const expired = s.require(a, 3, 'task');
  expired.expires = 0;
  assert.throws(() => s.consume(expired.id, true));
  const stopped = s.require(a, 3, 'task');
  s.stop();
  assert.throws(() => s.consume(stopped.id, true));
});
test('mock executor does not launch apps and permissions still apply', async () => {
  let launches = 0;
  let c = { ...defaults(), browser: true, mock: true };
  const ex = new Executor({
    config: () => c,
    audit: { write() {} },
    worker: 'unused',
    host: { openUrl: () => launches++ },
  });
  const r = await ex.execute({ tool: 'open_url', args: { url: 'https://example.com' } });
  assert.equal(r.mock, true);
  assert.equal(launches, 0);
  c = { ...c, browser: false };
  await assert.rejects(
    ex.execute({ tool: 'open_url', args: { url: 'https://example.com' } }),
    /disabled/,
  );
});
test('switching simulation off launches arbitrary installed applications through the shared route', async () => {
  let config = { ...defaults(), browser: true, mock: true };
  const opened = [];
  const ex = new Executor({
    config: () => config,
    audit: { write() {} },
    worker: 'unused',
    host: {
      openSystem: async (uri) => opened.push(uri),
      verifyApplication: async (name, result) => ({ ...result, verified: true, application: name }),
    },
  });
  ex.apps.cached = Promise.resolve([
    { Name: 'Future Photo Studio', AppID: 'PhotoStudio_123!App' },
    { Name: 'Future Music Editor', AppID: 'MusicEditor_456!App' },
  ]);
  ex.apps.expires = Date.now() + 60000;
  assert.equal(
    (await ex.execute({ tool: 'open_application', args: { name: 'Future Photo Studio' } })).mock,
    true,
  );
  assert.deepEqual(opened, []);
  config = { ...config, mock: false };
  for (const name of ['Future Photo Studio', 'Future Music Editor']) {
    const result = await ex.execute({ tool: 'open_application', args: { name } });
    assert.equal(result.mock, undefined);
    assert.equal(result.verified, true);
    assert.equal(result.application, name);
  }
  assert.deepEqual(opened, [
    'shell:AppsFolder\\PhotoStudio_123!App',
    'shell:AppsFolder\\MusicEditor_456!App',
  ]);
});
test('file roots reject traversal and root deletion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-test-'));
  try {
    await assert.rejects(safePath(root, '..'), /child/);
    await assert.rejects(safePath(root, '.'), /child/);
    assert.equal(await safePath(root, 'notes/new.txt'), path.join(root, 'notes/new.txt'));
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test('SQLite memories survive reload and can edit/delete', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-memory-'));
  try {
    const s = await new Store().init(root);
    s.remember('notes', 'first');
    const id = s.memories()[0].id;
    s.remember('preferences', 'updated', id);
    const other = await new Store().init(root);
    assert.equal(other.memories()[0].content, 'updated');
    other.forget(id);
    assert.equal(other.memories().length, 0);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
function plannerFixture(calls) {
  const events = [],
    saved = [],
    executed = [];
  let queries = 0;
  const p = new Planner({
    ollama: {
      chat: async () =>
        queries++
          ? { content: 'Task completed.' }
          : { tool_calls: calls.map(([name, args]) => ({ function: { name, arguments: args } })) },
    },
    executor: {
      execute: async (a) => {
        executed.push(a.tool);
        return { success: true };
      },
    },
    safety: new Safety(),
    store: { task: (t) => saved.push(structuredClone(t)) },
    emit: (type, data) => events.push({ type, data }),
    audit: { write() {} },
  });
  return { p, events, saved, executed };
}
test('planner pauses at each important action and resumes only on approval', async () => {
  const { p, events, executed } = plannerFixture([
    ['open_url', { url: 'https://example.com' }],
    ['type_text', { text: 'reply', confirmSensitive: true }],
    ['hotkey', { keys: ['enter'] }],
  ]);
  await p.command('write reply');
  assert.deepEqual(executed, ['open_url']);
  const first = events.find((e) => e.type === 'confirmation').data;
  await p.confirm(first.id, true);
  assert.deepEqual(executed, ['open_url', 'type_text']);
  assert.equal(p.active.status, 'waiting');
  const last = events.filter((e) => e.type === 'confirmation').at(-1).data;
  await p.confirm(last.id, true);
  assert.equal(p.active.status, 'completed');
});
test('denied action stops the remaining plan', async () => {
  const { p, events, executed } = plannerFixture([
    ['type_text', { text: 'a', confirmSensitive: true }],
    ['open_url', { url: 'https://example.com' }],
  ]);
  await p.command('type the requested text');
  await p.confirm(events.find((e) => e.type === 'confirmation').data.id, false);
  assert.equal(p.active.status, 'cancelled');
  assert.deepEqual(executed, []);
});
test('invalid model tool cannot execute', async () => {
  const { p, executed } = plannerFixture([['unknown', {}]]);
  await p.command('execute the requested action');
  assert.equal(p.active.steps[0].status, 'failed');
  assert.deepEqual(executed, []);
});
test('unchanged vision frames do not trigger additional inference', async () => {
  let calls = 0;
  const config = { ...defaults(), interval: 10 };
  const v = new Vision({
    config: () => config,
    capture: async () => ({
      image: 'abc',
      pixels: Buffer.alloc(20),
      width: 100,
      height: 100,
      monitor: '1',
      monitors: [],
    }),
    ollama: {
      chat: async () => {
        calls++;
        return { content: 'Screen' };
      },
    },
  });
  await v.analyze(true);
  v.lastAt = 0;
  const r = await v.analyze();
  assert.equal(r.unchanged, true);
  assert.equal(calls, 1);
  config.vision = 'off';
  await assert.rejects(v.analyze(true), /off/);
});
test('audit does not record sensitive arguments or text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-log-'));
  try {
    const a = new Audit(root);
    a.write('tool', {
      tool: 'type_text',
      text: 'PASSWORD-secret',
      args: { token: 'abc' },
      status: 'done',
    });
    const file = await fs.readFile(a.file, 'utf8');
    assert.ok(!file.includes('PASSWORD'));
    assert.ok(!file.includes('token'));
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test('telemetry returns real readings without requiring all sensors', async () => {
  const s = await telemetry();
  assert.ok(s.cpu === null || (s.cpu >= 0 && s.cpu <= 100));
  assert.ok(s.ramTotal >= 0);
  assert.ok(Array.isArray(s.processes));
  assert.ok(Number.isFinite(s.time));
});
test('mock mode also prevents risk-zero media key input', async () => {
  const ex = new Executor({
    config: () => ({ ...defaults(), keyboard: true, mock: true }),
    audit: { write() {} },
    worker: 'never-run',
    host: {},
  });
  assert.equal((await ex.execute({ tool: 'media', args: { key: 'volumeup' } })).mock, true);
});
test('persisted task history excludes prompts, arguments and tool results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-task-'));
  try {
    const store = await new Store().init(root);
    store.task({
      id: 'task1',
      title: 'private prompt',
      status: 'done',
      steps: [
        {
          tool: 'type_text',
          args: { text: 'secret' },
          result: { text: 'private output' },
          risk: 2,
          status: 'done',
        },
      ],
    });
    const stored = JSON.stringify(store.tasks());
    assert.ok(!stored.includes('private'));
    assert.ok(!stored.includes('secret'));
    assert.ok(stored.includes('type_text'));
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test('planner feeds results back and supports another bounded tool round', async () => {
  let round = 0;
  const results = [];
  const p = new Planner({
    ollama: {
      chat: async (messages) => {
        round++;
        if (round === 1)
          return { tool_calls: [{ function: { name: 'get_system_stats', arguments: {} } }] };
        assert.ok(messages.some((m) => m.role === 'tool'));
        if (round === 2)
          return { tool_calls: [{ function: { name: 'list_running_apps', arguments: {} } }] };
        return { content: 'Chrome is using the most memory.' };
      },
    },
    executor: {
      execute: async (a) => {
        results.push(a.tool);
        return { cpu: 12 };
      },
    },
    safety: new Safety(),
    store: { task() {} },
    emit() {},
    audit: { write() {} },
  });
  await p.command('What is using RAM?');
  assert.deepEqual(results, ['get_system_stats', 'list_running_apps']);
  assert.equal(p.active.status, 'completed');
});
test('missing Python fails speech requests without crashing', async () => {
  const { SpeechWorker } = require('../core/speech.cjs');
  const worker = new SpeechWorker(
    () => ({ pythonPath: 'jarvis-nonexistent-python', sttModel: 'base' }),
    'missing.py',
  );
  try {
    await assert.rejects(worker.transcribe('AA=='), /stopped/);
  } finally {
    worker.stop();
  }
});
