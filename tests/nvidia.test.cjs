const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { schema } = require('../core/config.cjs');
const { NvidiaProvider, ReasoningFilter, normalize } = require('../core/providers/nvidia.cjs');
const { HostedBudget } = require('../core/providers/hosted-budget.cjs');
const { ProviderRouter } = require('../core/providers/router.cjs');
const { roleFor } = require('../core/providers/task-profile.cjs');
const config = (extra = {}) =>
  schema.parse({
    provider: 'nvidia',
    cloudEnabled: true,
    routerMode: 'auto',
    preferLocalSimple: false,
    cloudScreen: true,
    ...extra,
  });
const key = { get: () => 'synthetic-credential-only', status: () => ({ nvidia: true }) };
const response = (content = 'READY', extra = {}) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, ...extra } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }),
  );
const model = config().nvidiaModel;
test('NVIDIA pins the free endpoint, normalizes tools and preserves native continuation', async () => {
  const requests = [],
    p = new NvidiaProvider({
      config: () => config(),
      secrets: key,
      fetcher: async (url, init) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return response(null, {
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: { name: 'inspect', arguments: '{"value":7}' },
            },
          ],
          reasoning_content: 'private thought',
        });
      },
    });
  const first = await p.chat(
    [{ role: 'user', content: 'Inspect' }],
    [{ type: 'function', function: { name: 'inspect', parameters: { type: 'object' } } }],
    false,
    undefined,
    undefined,
    { model },
  );
  assert.equal(first.tool_calls[0].function.arguments.value, 7);
  assert.equal(first.content, '');
  await p.chat(
    [first, { role: 'tool', tool_call_id: 'call1', content: '7' }],
    undefined,
    false,
    undefined,
    undefined,
    { model },
  );
  assert.equal(requests[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(requests[1].body.messages[0].reasoning_content, 'private thought');
  assert.equal(p.budget.snapshot().used, 2);
});
test('NVIDIA strips reasoning split over stream chunks and rejects incomplete streams', async () => {
  const events = [
    { choices: [{ delta: { content: '<thi' } }] },
    { choices: [{ delta: { content: 'nk>hidden</think>READY' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ];
  const p = new NvidiaProvider({
    config: () => config(),
    secrets: key,
    fetcher: async () =>
      new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('')),
  });
  let text = '';
  const r = await p.chat(
    [{ role: 'user', content: 'Hi' }],
    undefined,
    false,
    undefined,
    (t) => (text += t),
  );
  assert.equal(text, 'READY');
  assert.equal(r.content, 'READY');
  events.pop();
  await assert.rejects(
    () => p.chat([{ role: 'user', content: 'Hi' }], undefined, false, undefined, () => {}),
    { code: 'stream_interrupted' },
  );
  const filter = new ReasoningFilter();
  assert.equal(filter.push('<think>private', true), '');
  assert.throws(
    () => normalize({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }),
    { code: 'incomplete_response' },
  );
});
test('Missing credentials and unverified free models never spend the local request budget', async () => {
  let requests = 0;
  const p = new NvidiaProvider({
    config: () => config(),
    secrets: { get: () => '' },
    fetcher: async () => {
      requests++;
      return response();
    },
  });
  await assert.rejects(() => p.chat([{ role: 'user', content: 'Hi' }]), { code: 'missing_key' });
  assert.equal(requests, 0);
  assert.equal(p.budget.snapshot().used, 0);
  await assert.rejects(
    () => p.chat([], undefined, false, undefined, undefined, { model: 'z-ai/glm-5.3-flash' }),
    { code: 'free_endpoint_unverified' },
  );
});
test('Daily NVIDIA budget persists, caps attempts, and resets on local midnight', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-nvidia-budget-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = new Date(2026, 9, 3, 23, 59);
  const options = { directory, config: () => config({ nvidiaDailyCap: 2 }), clock: () => now };
  const b = new HostedBudget(options);
  b.take();
  b.take();
  assert.throws(() => b.take(), { code: 'daily_budget' });
  assert.equal(new HostedBudget(options).snapshot().used, 2);
  now = new Date(2026, 9, 4);
  assert.equal(b.snapshot().used, 0);
});
test('Capability probes grant only actually observed features', async () => {
  const p = new NvidiaProvider({
    config: () => config(),
    secrets: key,
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.tools || body.response_format || body.messages[0].content instanceof Array)
        return new Response('{}', { status: 400 });
      if (body.stream)
        return new Response(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: 'READY' }, finish_reason: 'stop' }] }) +
            '\n\n',
        );
      return response();
    },
  });
  const state = await p.probe(model);
  assert.equal(state.status, 'available');
  assert.deepEqual(state.caps, ['TEXT', 'STREAMING']);
  assert.equal((await p.capabilities(model)).includes('TOOLS'), false);
});
test('Structured characteristics choose fast, general, vision and bounded deep escalation', () => {
  assert.equal(roleFor({ complexity: 'trivial', confidence: 0.9 }), 'fast');
  assert.equal(roleFor({ complexity: 'complex', confidence: 0.9 }), 'general');
  assert.equal(roleFor({ vision: true }), 'vision');
  assert.equal(roleFor({ previousFailures: 2 }), 'deep');
});
test('Adaptive router checks proven capabilities, blocks paid providers and routes private memory locally', async () => {
  const calls = [],
    c = config();
  const p = (id) => ({
    available: () => true,
    capabilities: async () => ['TEXT', 'TOOLS', 'STRUCTURED_OUTPUT', 'VISION', 'STREAMING'],
    chat: async (_m, _t, _v, _s, _d, o) => {
      calls.push({ id, model: o.model });
      return { content: 'Done' };
    },
  });
  const nv = p('nvidia');
  nv.budget = new HostedBudget({ config: () => c });
  const providers = { nvidia: nv, gemini: p('gemini'), ollama: p('ollama'), openai: p('openai') };
  const r = new ProviderRouter({ config: () => c, providers });
  await r.chat([{ role: 'user', content: 'Hello' }], undefined, false, undefined, undefined, {
    profile: { complexity: 'trivial', confidence: 1 },
  });
  assert.equal(calls[0].model, c.nvidiaFastModel);
  await r.chat([{ role: 'tool', content: 'private-note', _privacy: 'memory' }]);
  assert.equal(calls.at(-1).id, 'ollama');
  const paid = new ProviderRouter({
    config: () => config({ provider: 'openai', routerMode: 'force-model' }),
    providers,
  });
  await paid.chat([{ role: 'user', content: 'Hello' }]);
  assert.equal(calls.at(-1).id, 'ollama');
});
test('NVIDIA rate cooldown honors Retry-After; cancellation never starts another request', async () => {
  let requests = 0;
  const p = new NvidiaProvider({
    config: () => config(),
    secrets: key,
    fetcher: async () => {
      requests++;
      return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
    },
  });
  await assert.rejects(() => p.chat([{ role: 'user', content: 'Hi' }]), { code: 'http_429' });
  await assert.rejects(() => p.chat([]), { code: 'http_429' });
  assert.equal(requests, 1);
  assert.ok(p.cooldownUntil > Date.now() + 110000);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => p.chat([], undefined, false, controller.signal));
  assert.equal(requests, 1);
});

test('Invalid NVIDIA credential blocks that provider and falls back without leaking the error body', async () => {
  const c = config(),
    p = new NvidiaProvider({
      config: () => c,
      secrets: key,
      fetcher: async () => new Response('{"error":"secret-bearing diagnostic"}', { status: 401 }),
    });
  p.profiles[c.nvidiaModel] = { status: 'available', caps: ['TEXT'] };
  const local = {
    capabilities: async () => ['TEXT'],
    chat: async () => ({ content: 'Local answer' }),
  };
  const r = new ProviderRouter({
    config: () => ({ ...c, routerMode: 'force-model' }),
    providers: { nvidia: p, ollama: local },
  });
  assert.equal((await r.chat([{ role: 'user', content: 'Hello' }])).provider, 'ollama');
  assert.equal(r.health.get('provider:nvidia').status, 'unavailable');
  assert.ok(!JSON.stringify(r.status()).includes('secret-bearing'));
});

test('Closed cloud screen permission redacts cached text and refuses unknown Gemini models in free mode', async () => {
  const { privateMessages } = require('../core/providers/router.cjs');
  const c = config({ cloudScreen: false });
  const redacted = privateMessages(
    [
      { role: 'user', content: 'private screen contents', _privacy: 'screen' },
      {
        role: 'assistant',
        content: 'paraphrased private data',
        _native: { nvidia: { content: 'private' } },
      },
    ],
    c,
    false,
  );
  assert.ok(!JSON.stringify(redacted).includes('private screen contents'));
  assert.equal(redacted[1].content, '');
  let cloudCalls = 0;
  const r = new ProviderRouter({
    config: () =>
      config({ provider: 'gemini', geminiModel: 'unknown-paid-model', routerMode: 'force-model' }),
    providers: {
      gemini: {
        chat: async () => {
          cloudCalls++;
        },
      },
      ollama: { capabilities: async () => ['TEXT'], chat: async () => ({ content: 'Local' }) },
    },
  });
  assert.equal((await r.chat([{ role: 'user', content: 'Hi' }])).provider, 'ollama');
  assert.equal(cloudCalls, 0);
});

test('Large structured contracts use JSON mode while host schemas remain the authority', async () => {
  let sent;
  const p = new NvidiaProvider({
    config: () => config(),
    secrets: key,
    fetcher: async (_u, init) => {
      sent = JSON.parse(init.body);
      return response('{"value":7}');
    },
  });
  await p.chat([{ role: 'user', content: 'Return JSON' }], undefined, false, undefined, undefined, {
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    schema: {
      type: 'object',
      properties: { value: { anyOf: [{ type: 'integer' }, { type: 'string' }] } },
    },
  });
  assert.equal(sent.response_format.type, 'json_object');
  assert.match(sent.messages[0].content, /contract/);
});

test('Classifier privacy guesses cannot force public tasks offline or override host private mode', async () => {
  const { defaultProfile } = require('../core/providers/task-profile.cjs');
  const c = config(),
    nv = {
      budget: new HostedBudget({ config: () => c }),
      available: () => true,
      capabilities: async () => ['TEXT', 'STRUCTURED_OUTPUT'],
      chat: async () => ({
        content: JSON.stringify({
          ...defaultProfile,
          privacy: 'local',
          complexity: 'simple',
          confidence: 1,
        }),
      }),
    };
  const r = new ProviderRouter({
    config: () => c,
    providers: {
      nvidia: nv,
      ollama: {
        capabilities: async () => ['TEXT', 'STRUCTURED_OUTPUT'],
        chat: async () => ({ content: JSON.stringify({ ...defaultProfile, privacy: 'public' }) }),
      },
    },
  });
  assert.equal((await r.beginTask('Launch an installed app')).privacy, 'public');
  assert.equal((await r.beginTask('Private task', undefined, true)).privacy, 'local');
});

test('Two provider instances share an atomic daily budget without losing reservations', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-nv-shared-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { directory, config: () => ({ nvidiaDailyCap: 2 }) };
  const a = new HostedBudget(options),
    b = new HostedBudget(options);
  a.take();
  b.take();
  assert.equal(a.snapshot().used, 2);
  assert.throws(() => a.take(), { code: 'daily_budget' });
});
