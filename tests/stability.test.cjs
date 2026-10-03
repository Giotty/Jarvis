const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { defaults } = require('../core/config.cjs');
const { readConfiguration, writeConfiguration } = require('../core/configuration.cjs');
const { Ollama } = require('../core/ollama.cjs');
const { SpeechWorker } = require('../core/speech.cjs');
const { namedWindow } = require('./legacy/agent-intake.cjs');
const { ordinaryNavigation } = require('../core/navigation-safety.cjs');
const { Planner } = require('./legacy/planner.cjs');
const { Vision } = require('../core/vision.cjs');
const { pythonCall } = require('../core/tools.cjs');
const { targetWindow } = require('../core/window-target.cjs');
const { resolveOrdinal } = require('../core/ordinal-controls.cjs');
const { Safety } = require('../core/safety.cjs');

test('search-field editing cannot be redirected into the omnibox by model arguments', () => {
  const p = new Planner({});
  p.context.request = 'Type MrBeast in the YouTube search box';
  const call = p.repairCall({
    function: {
      name: 'type_text',
      arguments: { text: 'MrBeast', label: "Barre d'adresse et de recherche" },
    },
  });
  assert.equal(call.args.label, 'Search');
  p.context.request = 'Type this in the address bar';
  assert.equal(
    p.repairCall({
      function: { name: 'type_text', arguments: { text: 'example.com', label: 'Address' } },
    }).args.label,
    'Address',
  );
});

test('typing-only requests stop before a model-added submit click in the same batch', async () => {
  const p = new Planner({ emit() {}, store: { task() {} } });
  p.context.request = 'Type hello in the search box';
  p.active = {
    status: 'running',
    steps: [
      { tool: 'type_text', status: 'done', result: { verified: true, field: 'Search' } },
      { tool: 'click_control', status: 'pending' },
    ],
  };
  assert.equal(p.completeSingleAction(), true);
  assert.equal(p.active.steps[1].status, 'skipped');
  assert.equal(p.active.status, 'completed');
});

test('expired approval releases the task and permits another command', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const p = new Planner({
    config: () => ({}),
    emit: (type, data) => events.push({ type, data }),
    store: { task() {} },
    safety: new Safety(),
    executor: { host: {} },
  });
  p.active = {
    status: 'running',
    steps: [{ tool: 'delete_file', args: { path: 'fixture' }, risk: 3, status: 'pending' }],
  };
  await p.run();
  assert.equal(p.active.status, 'waiting');
  t.mock.timers.tick(60020);
  assert.equal(p.active.status, 'cancelled');
  assert.equal(p.safety.pending.size, 0);
  assert.equal(events.at(-1).data, 'IDLE');
});

test('a verified single-profile click completes without another model click after the app restarts', async () => {
  const p = new Planner({
    config: () => ({ vision: 'continuous' }),
    emit() {},
    store: { task() {} },
  });
  p.context.request = 'Open the first profile on Steam';
  p.active = {
    steps: [
      {
        tool: 'click_control',
        status: 'done',
        risk: 1,
        result: { success: true, verified: true, message: 'Clicked Account A.' },
      },
    ],
  };
  p.infer = () => {
    throw Error('Must not re-plan a completed single click');
  };
  await p.run();
  assert.equal(p.active.status, 'completed');
  assert.equal(p.history.at(-1).content, 'Clicked Account A.');
});
test('first and second are resolved by actual peer geometry even when the model points to the other tile', () => {
  const a = {
    label: 'Account A',
    kind: 'ButtonControl',
    x: 30,
    y: 40,
    bounds: { width: 20, height: 30 },
  };
  const b = {
    label: 'Account B',
    kind: 'ButtonControl',
    x: 70,
    y: 40,
    bounds: { width: 20, height: 30 },
  };
  const add = {
    label: 'Add account',
    kind: 'ButtonControl',
    x: 90,
    y: 40,
    bounds: { width: 20, height: 30 },
  };
  assert.equal(resolveOrdinal('first profile', [b, a, add], b), a);
  assert.equal(resolveOrdinal('second profile', [b, a, add], a), b);
  assert.throws(() => resolveOrdinal('third profile', [a, b, add], a), /Not enough/);
});
test('UTF-8 worker protocol preserves localized Windows titles and Unicode text', async (t) => {
  const python = path.resolve(__dirname, '../.venv/Scripts/python.exe');
  if (!fs.existsSync(python)) return t.skip('Local Python environment not installed');
  const root = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'unicode-protocol.py');
  fs.writeFileSync(
    file,
    "import sys,json,os\nrequest=json.load(sys.stdin)\nprint(json.dumps({'title':request['title'],'text':request['text'],'utf8':os.environ.get('PYTHONUTF8')}))\n",
  );
  const result = await pythonCall({ pythonPath: python }, file, {
    title: 'Se connecter à Steam',
    text: 'Rechercher été 😀',
  });
  assert.equal(result.title, 'Se connecter à Steam');
  assert.equal(result.text, 'Rechercher été 😀');
  assert.equal(result.utf8, '1');
});
test('window targeting restores the HUD even when preparing desktop focus fails', async () => {
  let visible = true;
  const target = targetWindow(
    () => ({
      isDestroyed: () => false,
      isVisible: () => visible,
      isMinimized: () => false,
      hide: () => {
        visible = false;
      },
      showInactive: () => {
        visible = true;
      },
    }),
    async () => {},
    async () => {
      throw Error('No foreground target');
    },
  );
  await assert.rejects(
    target(async () => {}),
    /No foreground target/,
  );
  assert.equal(visible, true);
});
test('accessible selection resolves a generic ordinal without another image-model request', async () => {
  const controls = [
    { label: 'Account A', kind: 'ButtonControl', x: 30, y: 40 },
    { label: 'Account B', kind: 'ButtonControl', x: 70, y: 40 },
  ];
  let calls = 0;
  const vision = new Vision({
    config: () => ({ vision: 'manual' }),
    ollama: {
      chat: async (_m, _t, hasImage) => {
        calls++;
        assert.equal(hasImage, false);
        return { content: JSON.stringify({ accessibleIndex: 1, confidence: 1 }) };
      },
    },
  });
  const selected = await vision.locate(
    'second account',
    { image: 'fixture', width: 100, height: 100, bounds: { x: 0, y: 0, width: 100, height: 100 } },
    undefined,
    controls,
  );
  assert.equal(selected.label, 'Account B');
  assert.equal(selected.x, 70);
  assert.equal(selected.kind, 'ButtonControl');
  assert.equal(calls, 1);
});
test('settings corruption recovers the chosen voice and never silently resets a saved profile', () => {
  const root = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(root, { recursive: true });
  const folder = fs.mkdtempSync(path.join(root, 'settings-'));
  assert.equal(path.dirname(folder), root);
  const file = path.join(folder, 'config.json');
  try {
    const config = { ...defaults(), ttsEngine: 'kokoro', kokoroVoice: 'bm_george', mock: false };
    writeConfiguration(file, config);
    writeConfiguration(file, config);
    fs.writeFileSync(file, 'invalid');
    const restored = readConfiguration(file);
    assert.equal(restored.recovered, true);
    assert.equal(restored.config.kokoroVoice, 'bm_george');
    assert.equal(restored.config.mock, false);
    writeConfiguration(file, restored.config);
    assert.equal(readConfiguration(file).config.ttsEngine, 'kokoro');
    fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ ...config, oldUnusedKey: true }));
    assert.equal(readConfiguration(file).config.kokoroVoice, 'bm_george');
    fs.writeFileSync(file, 'invalid');
    fs.writeFileSync(file + '.bak', 'invalid');
    assert.throws(() => readConfiguration(file), /preserved/);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
test('an image can never be sent to a text-only configured model even after the visual flag clears', async () => {
  const ai = new Ollama(() => ({
    ollamaUrl: 'http://localhost',
    model: 'text',
    visionModel: 'text',
  }));
  const calls = [];
  ai.request = async (route, body) => {
    calls.push([route, body]);
    if (route === '/api/show')
      return { capabilities: body.model === 'vision' ? ['vision', 'tools'] : ['tools'] };
    if (route === '/api/tags') return { models: [{ name: 'vision' }] };
    return { message: { content: 'Observed' } };
  };
  await ai.chat(
    [{ role: 'user', content: 'click this', images: ['image'] }],
    [{ type: 'function' }],
    false,
  );
  assert.equal(calls.find(([route]) => route === '/api/chat')[1].model, 'vision');
});
test('vision-only models describe pixels separately before a text model plans tools', async () => {
  const ai = new Ollama(() => ({
    ollamaUrl: 'http://localhost',
    model: 'text',
    visionModel: 'vision',
  }));
  const chat = [];
  ai.request = async (route, body) => {
    if (route === '/api/show')
      return { capabilities: body.model === 'vision' ? ['vision'] : ['tools'] };
    if (route === '/api/tags') return { models: [] };
    chat.push(body);
    return { message: { content: 'A profile chooser' } };
  };
  await ai.chat(
    [{ role: 'user', content: 'open first profile', images: ['image'] }],
    [{ type: 'function' }],
    true,
  );
  assert.equal(chat[0].model, 'vision');
  assert.equal(chat[0].tools, undefined);
  assert.equal(chat[1].model, 'text');
  assert.equal(
    chat[1].messages.some((m) => m.images),
    false,
  );
});
test('failed speech warmup is retried and CUDA timeout falls back to CPU', async () => {
  const worker = new SpeechWorker(() => ({ sttDevice: 'auto', sttModel: 'small.en' }), 'fixture');
  let attempts = 0;
  worker.request = async () => {
    if (++attempts === 1) throw Error('Failed to initialize');
    return { ready: true };
  };
  await assert.rejects(worker.prepare());
  await worker.prepare();
  assert.equal(attempts, 2);
  worker.prepared = null;
  const requests = [];
  worker.request = async (payload) => {
    requests.push(payload);
    if (requests.length === 1) throw Error('CUDA timed out');
    return payload.operation ? { ready: true } : { text: 'Open Steam' };
  };
  const result = await worker.transcribe('audio');
  assert.equal(result.text, 'Open Steam');
  assert.equal(requests.at(-1).device, 'cpu');
});
test('a Steam profile request focuses the unique existing localized Steam window', () => {
  const steam = { title: 'Se connecter à Steam', application: 'steamwebhelper.exe' };
  assert.equal(
    namedWindow('open the first profile on Steam', [
      { title: 'Google', application: 'chrome.exe' },
      steam,
    ]),
    steam,
  );
  assert.equal(namedWindow('open first profile', [steam]), null);
  assert.equal(
    namedWindow('open first profile on Steam', [steam, { ...steam, title: 'Steam Friends' }]),
    null,
  );
});
test('ordinary actual UI navigation is automatic; send, deletion, payment, installation and admin controls stay gated', () => {
  for (const label of ['Account A', 'Recherche', 'Library', 'Home', 'Videos'])
    assert.equal(
      ordinaryNavigation({ kind: 'ButtonControl', label }, { application: 'chrome.exe' }),
      true,
    );
  assert.equal(
    ordinaryNavigation(
      { kind: 'ComboBoxControl', label: 'Rechercher' },
      { application: 'chrome.exe' },
    ),
    true,
  );
  assert.equal(
    ordinaryNavigation({ kind: 'EditControl', label: 'Password' }, { application: 'chrome.exe' }),
    false,
  );
  for (const label of [
    'Send',
    'Submit',
    'Envoyer',
    'Delete',
    'Supprimer',
    'Purchase',
    'Pay',
    'Install',
    'Restart',
    'Authorize',
    'Log in',
  ])
    assert.equal(
      ordinaryNavigation({ kind: 'ButtonControl', label }, { application: 'chrome.exe' }),
      false,
    );
  assert.equal(
    ordinaryNavigation({ kind: 'ButtonControl', label: 'Run' }, { application: 'powershell.exe' }),
    false,
  );
});
test('the current command stays after previous conversation and before its own tool results', async () => {
  const p = new Planner({ config: () => ({}), emit() {} });
  p.controller = new AbortController();
  p.context.request = 'Type MrBeast';
  p.messages = [
    { role: 'system', content: 'JARVIS' },
    { role: 'user', content: 'Open YouTube on Google' },
    { role: 'assistant', content: 'Opened YouTube' },
    { role: 'user', content: 'Type MrBeast' },
    { role: 'tool', content: 'Current result' },
  ];
  p.ollama = {
    chat: async (messages) => {
      assert.deepEqual(
        messages.filter((m) => m.role === 'user').map((m) => m.content),
        ['Open YouTube on Google', 'Type MrBeast'],
      );
      assert.equal(messages.at(-1).role, 'tool');
      return { content: 'Done' };
    },
  };
  await p.infer();
});
