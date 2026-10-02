const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Planner } = require('../core/planner.cjs');
const { Safety } = require('../core/safety.cjs');
const { Executor } = require('../core/tools.cjs');
const { Ollama } = require('../core/ollama.cjs');

function planner(ollama, executor, events = []) {
  return new Planner({
    ollama,
    executor,
    config: () => ({ websiteAliases: { youtube: 'https://www.youtube.com/' } }),
    safety: new Safety(),
    store: { task() {} },
    emit: (type, data) => events.push({ type, data }),
    audit: { write() {} },
  });
}
test('STOP aborts an in-flight model request and allows the next command', async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const p = planner(
    {
      chat: (_m, _t, _v, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true });
          started();
        }),
    },
    { execute: async () => ({ success: true }) },
  );
  const pending = p.command('Tell me about the moon');
  await ready;
  p.cancel();
  await pending;
  assert.equal(p.busy, false);
  await p.command('Open YouTube');
  assert.equal(p.active.status, 'completed');
});
test('direct Roblox launch retains permissions and mock safety without model calls', async () => {
  let allowed = false;
  const events = [];
  const executor = new Executor({
    config: () => ({ browser: allowed, mock: true }),
    host: {},
    worker: 'never-run',
    audit: { write() {} },
  });
  const p = planner(
    {
      chat: () => {
        throw Error('Model must not be called');
      },
    },
    executor,
    events,
  );
  executor.apps.all = async () => [{ Name: 'Roblox', AppID: 'Roblox' }];
  await p.command('Open Roblox');
  assert.equal(p.active.status, 'failed');
  allowed = true;
  await p.command('Open Roblox');
  assert.equal(p.active.steps[0].result.mock, true);
  assert.match(events.filter((e) => e.type === 'reply').at(-1).data, /Simulated/);
});
test('Ollama API errors retain the server explanation', async () => {
  const server = require('node:http').createServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'model not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const ai = new Ollama(() => ({ ollamaUrl: `http://127.0.0.1:${server.address().port}` }));
    await assert.rejects(ai.request('/api/chat', {}), /400: model not found/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
