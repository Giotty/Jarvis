const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { schema } = require('../core/config.cjs');
const { OpenAIProvider } = require('../core/providers/openai.cjs');
const { ClaudeProvider } = require('../core/providers/anthropic.cjs');
const { OllamaProvider } = require('../core/providers/ollama.cjs');
const { ProviderRouter, privateMessages } = require('../core/providers/router.cjs');
const { SecretStore } = require('../core/providers/secrets.cjs');
const config = () =>
  schema.parse({
    cloudEnabled: true,
    provider: 'openai',
    openaiModel: 'custom-chat',
    anthropicModel: 'custom-claude',
    model: 'local-chat',
    visionModel: 'local-vision',
  });
const tool = {
  type: 'function',
  function: {
    name: 'inspect',
    description: 'Inspect',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
};
const messages = [
  { role: 'system', content: 'JARVIS' },
  { role: 'user', content: 'Help me' },
];
const secret = { get: () => 'test-only-credential' };
function body(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
function stream(events) {
  return new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''));
}
function openaiReply(text = 'Hello') {
  return {
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 5, output_tokens: 3 },
  };
}
test('OpenAI uses Responses, canonical function IDs, images, no server storage, and reports usage', async () => {
  const requests = [];
  const provider = new OpenAIProvider({
    config,
    secrets: secret,
    fetcher: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return body({
        status: 'completed',
        output: [
          { type: 'reasoning', id: 'reasoning-1', summary: [] },
          { type: 'function_call', call_id: 'call-1', name: 'inspect', arguments: '{}' },
        ],
      });
    },
  });
  const r = await provider.chat(
    [...messages, { role: 'user', content: 'Look', images: ['fixture'] }],
    [tool],
  );
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].body.store, false);
  assert.equal(requests[0].body.input.at(-1).content[1].type, 'input_image');
  await provider.chat(
    [...messages, r, { role: 'tool', tool_call_id: 'call-1', content: '{"success":true}' }],
    [tool],
  );
  assert.equal(requests[1].body.input.at(-1).type, 'function_call_output');
  assert.equal(requests[1].body.input.at(-1).call_id, 'call-1');
  assert.equal(requests[1].body.input.find((i) => i.type === 'reasoning').id, 'reasoning-1');
});
test('OpenAI plain and streamed responses assemble text and tool calls', async () => {
  const final = openaiReply();
  const provider = new OpenAIProvider({
    config,
    secrets: secret,
    fetcher: async () =>
      stream([
        { type: 'response.output_text.delta', delta: 'Hel' },
        { type: 'response.output_text.delta', delta: 'lo' },
        { type: 'response.completed', response: final },
      ]),
  });
  const chunks = [],
    r = await provider.chat(messages, undefined, false, undefined, (s) => chunks.push(s));
  assert.equal(r.content, 'Hello');
  assert.equal(chunks.join(''), 'Hello');
  assert.deepEqual(r.usage, { input: 5, output: 3 });
});
test('Claude converts grouped tool results, image blocks, and native thinking blocks', async () => {
  const requests = [],
    provider = new ClaudeProvider({
      config,
      secrets: secret,
      fetcher: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return body({
          stop_reason: 'tool_use',
          content: [
            { type: 'thinking', thinking: 'Reason', signature: 'signed' },
            { type: 'tool_use', id: 'tool-1', name: 'inspect', input: {} },
          ],
          usage: { input_tokens: 4, output_tokens: 2 },
        });
      },
    });
  const r = await provider.chat(
    [...messages, { role: 'user', content: 'Look', images: ['fixture'] }],
    [tool],
  );
  assert.equal(requests[0].messages.at(-1).content.at(-1).type, 'image');
  await provider.chat(
    [...messages, r, { role: 'tool', tool_call_id: 'tool-1', content: '{"success":false}' }],
    [tool],
  );
  assert.equal(requests[1].messages.at(-1).content[0].tool_use_id, 'tool-1');
  assert.equal(requests[1].messages.at(-1).content[0].is_error, true);
  assert.equal(requests[1].messages.at(-2).content[0].signature, 'signed');
});
test('Claude streaming collects partial tool JSON and usage without leaking thinking', async () => {
  const provider = new ClaudeProvider({
    config,
    secrets: secret,
    fetcher: async () =>
      stream([
        { type: 'message_start', message: { content: [], usage: { input_tokens: 3 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking' } },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 't1', name: 'inspect', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"query":' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"RAM"}' },
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
        { type: 'message_stop' },
      ]),
  });
  const chunks = [],
    r = await provider.chat(messages, [tool], false, undefined, (s) => chunks.push(s));
  assert.equal(r.tool_calls[0].function.arguments.query, 'RAM');
  assert.equal(chunks.join(''), 'Checking');
  assert.equal(r.usage.output, 4);
});
for (const [label, Provider] of [
  ['OpenAI', OpenAIProvider],
  ['Claude', ClaudeProvider],
]) {
  test(
    label + ' rejects malformed or incomplete responses and masks server error bodies',
    async () => {
      const p = new Provider({ config, secrets: secret, fetcher: async () => body({}) });
      await assert.rejects(() => p.chat(messages), /incomplete/);
      p.fetcher = async () => new Response('private-secret-in-error', { status: 429 });
      await assert.rejects(
        () => p.chat(messages),
        (error) => error.code === 'http_429' && !error.message.includes('private-secret'),
      );
      p.fetcher = async () => new Response('not JSON');
      await assert.rejects(() => p.chat(messages), /malformed/);
    },
  );
  test(label + ' streaming cancellation stops without completion', async () => {
    const controller = new AbortController();
    const events =
      label === 'OpenAI'
        ? [
            { type: 'response.output_text.delta', delta: 'Hi' },
            { type: 'response.completed', response: openaiReply('Hi') },
          ]
        : [
            { type: 'message_start', message: { content: [], usage: {} } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
            { type: 'message_stop' },
          ];
    const p = new Provider({ config, secrets: secret, fetcher: async () => stream(events) });
    await assert.rejects(
      () => p.chat(messages, [], false, controller.signal, () => controller.abort()),
      /abort/i,
    );
  });
  test(label + ' bounds stalled requests and supports arbitrary discovered model IDs', async () => {
    const p = new Provider({
      config: () => ({ ...config(), providerTimeout: 10 }),
      secrets: secret,
      fetcher: (_url, init) =>
        new Promise((_, reject) => {
          const keepAlive = setTimeout(() => reject(Error('too slow')), 100);
          init.signal.addEventListener('abort', () => {
            clearTimeout(keepAlive);
            reject(init.signal.reason);
          });
        }),
    });
    await assert.rejects(() => p.chat(messages), /timeout/);
    p.fetcher = async () => body({ data: [{ id: 'future-user-selected-model' }] });
    assert.deepEqual((await p.models()).models, ['future-user-selected-model']);
  });
}
test('Ollama adapter normalizes calls while stripping cloud-only fields', async () => {
  let observed;
  const p = new OllamaProvider({
    config,
    local: {
      chat: async (m) => {
        observed = m;
        return { content: '', tool_calls: [{ function: { name: 'inspect', arguments: '{}' } }] };
      },
    },
  });
  const r = await p.chat([
    { role: 'user', content: 'hello', _native: { openai: ['secret'] }, _privacy: 'files' },
  ]);
  assert.equal(observed[0]._native, undefined);
  assert.equal(typeof r.tool_calls[0].id, 'string');
  assert.deepEqual(r.tool_calls[0].function.arguments, {});
});
function routerProviders() {
  const calls = [];
  const p = (id) => ({
    capabilities: async () => ['TEXT', 'TOOLS', 'VISION'],
    chat: async (m, _t, _v, _s, delta) => {
      calls.push({ id, m });
      delta?.('Hello');
      return { role: 'assistant', content: 'Hello', usage: { input: 2, output: 3 } };
    },
  });
  return {
    providers: { openai: p('openai'), anthropic: p('anthropic'), ollama: p('ollama') },
    calls,
  };
}
test('rate limits and missing cloud credentials fall back to local; explicit cancellation never falls back', async () => {
  const { providers, calls } = routerProviders();
  providers.openai.chat = async () => {
    throw Error('quota');
  };
  const router = new ProviderRouter({ config, providers });
  await router.chat(messages);
  assert.equal(calls[0].id, 'ollama');
  const controller = new AbortController();
  providers.openai.chat = async () => {
    controller.abort();
    throw Error('cancelled');
  };
  await assert.rejects(() => router.chat(messages, [], false, controller.signal));
  assert.equal(calls.length, 1);
});
test('cloud OFF, background inference, and session request limits prevent cloud requests', async () => {
  const { providers, calls } = routerProviders();
  let c = { ...config(), cloudEnabled: false };
  const router = new ProviderRouter({ config: () => c, providers });
  await router.chat(messages);
  assert.equal(calls[0].id, 'ollama');
  c = { ...config(), cloudRequestLimit: 1 };
  await router.chat(messages);
  await router.chat(messages);
  assert.deepEqual(
    calls.map((c) => c.id),
    ['ollama', 'openai', 'ollama'],
  );
  assert.equal(router.usage.cloudRequests, 1);
  await router.chat(messages, [], false, undefined, undefined, { localOnly: true });
  assert.equal(calls.at(-1).id, 'ollama');
});
test('local preference answers locally and can hand tool continuations or local outages to the primary', async () => {
  const { providers, calls } = routerProviders();
  const router = new ProviderRouter({
    config: () => ({ ...config(), preferLocalSimple: true }),
    providers,
  });
  await router.chat(messages, [tool], false, undefined, undefined, { simple: true });
  await router.chat(messages, [tool], false, undefined, undefined, { simple: false });
  assert.deepEqual(
    calls.map((c) => c.id),
    ['ollama', 'openai'],
  );
  providers.ollama.chat = async () => {
    throw Error('Local server offline');
  };
  await router.chat(messages, [tool], false, undefined, undefined, { simple: true });
  assert.equal(calls.at(-1).id, 'openai');
  await assert.rejects(() =>
    router.chat(messages, [tool], false, undefined, undefined, { simple: true, localOnly: true }),
  );
  assert.equal(calls.length, 3);
});
test('private clipboard/file results route locally and are redacted from future cloud history', async () => {
  const { providers, calls } = routerProviders();
  const router = new ProviderRouter({ config, providers });
  await router.chat([
    ...messages,
    { role: 'tool', content: 'private-file-content', _privacy: 'files' },
  ]);
  assert.equal(calls[0].id, 'ollama');
  const filtered = privateMessages(
    [
      { role: 'tool', content: 'private-file', _privacy: 'files' },
      {
        role: 'assistant',
        content: 'private-summary',
        _native: { openai: ['private-reasoning'] },
        tool_calls: [
          { id: 'id1', function: { name: 'inspect', arguments: { text: 'private-file' } } },
        ],
      },
    ],
    config(),
    false,
  );
  assert.equal(JSON.stringify(filtered).includes('private-file'), false);
  assert.equal(JSON.stringify(filtered).includes('private-summary'), false);
  assert.equal(filtered[1]._native, undefined);
});
test('cloud screen settings and manual mode keep background images local', async () => {
  const { providers, calls } = routerProviders();
  let c = config();
  const router = new ProviderRouter({ config: () => c, providers });
  const image = [...messages, { role: 'user', content: 'Look', images: ['private-pixels'] }];
  await router.chat(image, [], true);
  assert.equal(calls[0].id, 'ollama');
  c = { ...c, cloudScreen: true, cloudVision: 'manual' };
  await router.chat(image, [], true);
  assert.equal(calls.at(-1).id, 'ollama');
  await router.chat(image, [], true, undefined, undefined, { manualVision: true });
  assert.equal(calls.at(-1).id, 'openai');
});
test('capability overrides route non-vision models through local captioning', async () => {
  const { providers, calls } = routerProviders();
  providers.openai.capabilities = async () => ['TEXT', 'TOOLS'];
  const router = new ProviderRouter({
    config: () => ({ ...config(), cloudScreen: true, cloudVision: 'when-needed' }),
    providers,
  });
  await router.chat(
    [...messages, { role: 'user', content: 'Look', images: ['fixture'] }],
    [tool],
    true,
  );
  assert.deepEqual(
    calls.map((c) => c.id),
    ['ollama', 'openai'],
  );
  assert.equal(
    calls[1].m.some((m) => m.images),
    false,
  );
});
test('partial spoken responses do not concatenate another provider answer', async () => {
  const { providers, calls } = routerProviders();
  providers.openai.chat = async (_m, _t, _v, _s, delta) => {
    delta('partial');
    throw Error('lost stream');
  };
  const router = new ProviderRouter({ config, providers });
  await assert.rejects(() => router.chat(messages, [], false, undefined, () => {}));
  assert.equal(calls.length, 0);
});
test('credentials use encrypted storage and never return full keys; encryption failure has no plaintext fallback', () => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'secrets-test-'));
  try {
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s.split('').reverse().join('')),
      decryptString: (b) => b.toString().split('').reverse().join(''),
    };
    const store = new SecretStore(dir, encryption);
    assert.deepEqual(store.set('openai', 'never-log-this-key'), { openai: true });
    assert.equal(store.get('openai'), 'never-log-this-key');
    assert.equal(fs.readFileSync(store.file, 'utf8').includes('never-log-this-key'), false);
    encryption.isEncryptionAvailable = () => false;
    assert.throws(() => store.set('anthropic', 'another-key'), /encryption/);
    encryption.isEncryptionAvailable = () => true;
    assert.deepEqual(store.set('openai', ''), {});
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(__dirname));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
