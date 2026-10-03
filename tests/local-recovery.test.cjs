const test = require('node:test'),
  assert = require('node:assert/strict');
const { OllamaService } = require('../core/ollama-service.cjs');
const { Ollama } = require('../core/ollama.cjs');
const environment = { LOCALAPPDATA: 'C:/Test/Local' };
test('offline default local Ollama starts once for concurrent requests and recognizes the existing service', async () => {
  let launches = 0,
    online = false;
  const service = new OllamaService({
    platform: 'win32',
    environment,
    exists: () => true,
    fetcher: async () => {
      if (!online) throw Error('offline');
      return { ok: true };
    },
    launcher: async (exe) => {
      assert.match(exe, /Ollama/);
      launches++;
      online = true;
    },
  });
  assert.deepEqual(
    await Promise.all([
      service.ensure('http://127.0.0.1:11434'),
      service.ensure('http://127.0.0.1:11434'),
    ]),
    [true, true],
  );
  assert.equal(launches, 1);
  await service.ensure('http://127.0.0.1:11434');
  assert.equal(launches, 1);
});
test('service recovery never starts an arbitrary remote/custom endpoint or a missing binary', async () => {
  let launches = 0;
  const service = new OllamaService({
    platform: 'win32',
    environment,
    exists: () => false,
    fetcher: async () => {
      throw Error('offline');
    },
    launcher: async () => {
      launches++;
    },
  });
  for (const url of [
    'https://example.org:11434',
    'http://127.0.0.1:1234',
    'http://user:password@localhost:11434',
    'http://localhost:11434/custom',
    'http://localhost:11434',
  ])
    assert.equal(await service.ensure(url), false);
  assert.equal(launches, 0);
});
test('cancelling a waiter does not stop or duplicate a shared service startup', async () => {
  let release,
    online = false,
    launches = 0;
  const service = new OllamaService({
    platform: 'win32',
    environment,
    exists: () => true,
    fetcher: async () => ({ ok: online }),
    launcher: () => {
      launches++;
      return new Promise(
        (r) =>
          (release = () => {
            online = true;
            r();
          }),
      );
    },
  });
  const controller = new AbortController(),
    first = service.ensure('http://localhost:11434', controller.signal),
    second = service.ensure('http://localhost:11434');
  await new Promise((r) => setImmediate(r));
  controller.abort(Error('cancelled'));
  await assert.rejects(first, /cancelled/);
  release();
  assert.equal(await second, true);
  assert.equal(launches, 1);
});
test('Ollama retries one refused connection after recovery, but HTTP errors and cancellation do not restart it', async () => {
  const previous = global.fetch;
  let sends = 0,
    starts = 0;
  const ollama = new Ollama(() => ({ ollamaUrl: 'http://127.0.0.1:11434' }), {
    service: {
      ensure: async () => {
        starts++;
        return true;
      },
    },
  });
  try {
    global.fetch = async () => {
      if (!sends++) throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      return new Response(JSON.stringify({ models: [] }));
    };
    await ollama.request('/api/tags');
    assert.equal(sends, 2);
    assert.equal(starts, 1);
    global.fetch = async () => new Response('{}', { status: 500 });
    await assert.rejects(ollama.request('/api/tags'), /500/);
    assert.equal(starts, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(ollama.request('/api/tags', undefined, controller.signal));
    assert.equal(starts, 1);
  } finally {
    global.fetch = previous;
  }
});
test('Windows voice selection prefers British male and never falls through to a first female or remote voice', async () => {
  const { chooseMaleLocalVoice } = await import('../core/local-voice.mjs');
  const v = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });
  const female = v('Microsoft Zira'),
    david = v('Microsoft David'),
    george = v('Microsoft George', 'en-GB');
  assert.equal(chooseMaleLocalVoice([female, david, george]), george);
  assert.equal(chooseMaleLocalVoice([female, david]), david);
  assert.equal(chooseMaleLocalVoice([female, v('George', 'en-GB', false)]), null);
  assert.equal(chooseMaleLocalVoice([]), null);
});
