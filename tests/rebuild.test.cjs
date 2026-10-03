const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { schema } = require('../core/config.cjs');
const { GeminiProvider } = require('../core/providers/gemini.cjs');
const { ProviderRouter } = require('../core/providers/router.cjs');
const { BriefingEngine } = require('../core/briefing.cjs');
const { ResearchAgent } = require('../core/research-agent.cjs');
const { validate } = require('../core/tools.cjs');
const { publicError } = require('../core/agent-errors.cjs');
const config = () =>
  schema.parse({ geminiModel: 'selected-model', geminiVisionModel: 'vision-model' });
const messages = [
  { role: 'system', content: 'JARVIS' },
  { role: 'user', content: 'Inspect this' },
];
const key = { get: () => 'mock-only-not-an-account-key' };
const json = (data) => new Response(JSON.stringify(data));
const reply = (parts, extra = {}) => ({
  candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
  ...extra,
});
const tools = [
  {
    type: 'function',
    function: {
      name: 'inspect',
      description: 'Inspect',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
];

test('Gemini uses configured models, header credentials, native calls, images and exact thought signatures', async () => {
  const requests = [];
  const provider = new GeminiProvider({
    config,
    secrets: key,
    fetcher: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return json(
        reply(
          [
            {
              functionCall: { id: 'native-call', name: 'inspect', args: {} },
              thoughtSignature: 'opaque-signature',
            },
            { text: '', thoughtSignature: 'empty-text-signature' },
          ],
          {
            usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, thoughtsTokenCount: 4 },
          },
        ),
      );
    },
  });
  const result = await provider.chat(
    [...messages, { role: 'user', content: 'Image', images: ['data:image/png;base64,ZmFrZQ=='] }],
    tools,
    true,
  );
  assert.match(requests[0].url, /models\/vision-model:generateContent$/);
  assert.ok(!requests[0].url.includes('mock-only'));
  assert.equal(requests[0].init.headers['x-goog-api-key'], key.get());
  assert.equal(requests[0].body.contents.at(-1).parts.at(-1).inlineData.mimeType, 'image/png');
  assert.deepEqual(result.usage, { input: 9, output: 6 });
  await provider.chat(
    [
      ...messages,
      result,
      { role: 'tool', tool_call_id: 'native-call', content: '{"success":true}' },
    ],
    tools,
  );
  const native = requests[1].body.contents.find((c) => c.role === 'model');
  assert.equal(native.parts[0].thoughtSignature, 'opaque-signature');
  assert.equal(native.parts[1].thoughtSignature, 'empty-text-signature');
  assert.equal(requests[1].body.contents.at(-1).parts[0].functionResponse.id, 'native-call');
});
test('Gemini streaming preserves empty signature chunks, reports usage, and supports structured output', async () => {
  let sent;
  const provider = new GeminiProvider({
    config,
    secrets: key,
    fetcher: async (_, init) => {
      sent = JSON.parse(init.body);
      return new Response(
        [
          reply([{ text: '{"ok":' }]),
          reply([{ text: 'true}' }]),
          reply([{ text: '', thoughtSignature: 'last-signature' }], {
            usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 },
          }),
        ]
          .map((r) => 'data: ' + JSON.stringify(r) + '\n\n')
          .join(''),
      );
    },
  });
  let text = '';
  const result = await provider.chat(messages, undefined, false, undefined, (c) => (text += c), {
    schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  });
  assert.equal(text, '{"ok":true}');
  assert.equal(result.content, text);
  assert.equal(result._native.gemini.parts.at(-1).thoughtSignature, 'last-signature');
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.equal(result.usage.input, 4);
});
test('Gemini discovers paged model IDs and defaults unknown capabilities conservatively', async () => {
  const urls = [];
  const provider = new GeminiProvider({
    config,
    secrets: key,
    fetcher: async (url) => {
      urls.push(url);
      return json(
        url.includes('pageToken')
          ? { models: [{ name: 'models/second', supportedGenerationMethods: ['generateContent'] }] }
          : {
              models: [
                { name: 'models/first', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
              ],
              nextPageToken: 'next token',
            },
      );
    },
  });
  assert.deepEqual((await provider.models()).models, ['first', 'second']);
  assert.match(urls[1], /pageToken=next%20token/);
  assert.deepEqual(await provider.capabilities('first'), ['TEXT', 'STREAMING']);
});
test('Gemini rejects missing keys, invalid models, malformed/blocked output and aborted streams without exposing server text', async () => {
  let requests = 0;
  const missing = new GeminiProvider({
    config,
    secrets: { get: () => '' },
    fetcher: async () => {
      requests++;
      return json({});
    },
  });
  await assert.rejects(missing.chat(messages), (e) => e.code === 'missing_key');
  assert.equal(requests, 0);
  const invalid = new GeminiProvider({
    config: () => ({ ...config(), geminiModel: '../bad?key=secret' }),
    secrets: key,
  });
  await assert.rejects(invalid.chat(messages), (e) => e.code === 'missing_model');
  for (const response of [
    new Response('not json'),
    json({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    new Response('secret body', { status: 429 }),
  ]) {
    const p = new GeminiProvider({ config, secrets: key, fetcher: async () => response });
    await assert.rejects(p.chat(messages), (e) => !e.message.includes('secret body'));
  }
  const control = new AbortController();
  const streamed = new GeminiProvider({
    config,
    secrets: key,
    fetcher: async () =>
      new Response('data: ' + JSON.stringify(reply([{ text: 'first' }])) + '\n\n'),
  });
  await assert.rejects(
    streamed.chat(messages, undefined, false, control.signal, () => control.abort()),
  );
});
test('Gemini timeout and missing tools capability can fall back, while local-only vision cannot route cloud', async () => {
  const timed = new GeminiProvider({
    config: () => ({ ...config(), providerTimeout: 10 }),
    secrets: key,
    fetcher: async (_, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }),
      ),
  });
  await assert.rejects(timed.chat(messages), (e) => e.code === 'timeout');
  const selected = [];
  const mock = (id) => ({
    capabilities: async () => (id === 'gemini' ? ['TEXT'] : ['TEXT', 'VISION', 'TOOLS']),
    chat: async () => {
      selected.push(id);
      return { content: 'Local answer', role: 'assistant' };
    },
  });
  const router = new ProviderRouter({
    config: () => ({
      ...config(),
      cloudEnabled: true,
      provider: 'gemini',
      visionProvider: 'gemini',
      cloudScreen: true,
      cloudVision: 'when-needed',
    }),
    secrets: key,
    providers: { gemini: mock('gemini'), ollama: mock('ollama') },
  });
  assert.equal((await router.chat(messages, tools)).provider, 'ollama');
  assert.equal(
    (
      await router.chat(
        [...messages, { role: 'user', content: 'look', images: ['fixture'] }],
        undefined,
        true,
        undefined,
        undefined,
        { localOnly: true },
      )
    ).provider,
    'ollama',
  );
  assert.deepEqual(selected, ['ollama', 'ollama']);
});
function research() {
  const engine = new BriefingEngine();
  engine.begin('An unfamiliar engineering topic');
  const ids = engine.observe({
    tool: 'extract_page_text',
    result: {
      success: true,
      url: 'https://example.org/report',
      title: 'Source report',
      text: 'Observed measurements: 12 and 24 units.',
      fetchedAt: Date.now(),
      images: [
        {
          id: '06a2f127-8c52-4881-a2cd-6e0eb3d3736a',
          title: 'Measurement',
          url: 'https://example.org/image.png',
        },
      ],
    },
  });
  return { engine, id: ids[0].id };
}
const visual = (id) => ({
  title: 'Engineering research',
  scenes: [
    {
      title: 'Measurements',
      narration: 'Two measured values.',
      panels: [
        {
          type: 'bar',
          title: 'Measurements',
          sourceIds: [id],
          data: [
            { label: 'A', value: 12 },
            { label: 'B', value: 24 },
          ],
          unit: 'units',
        },
      ],
    },
  ],
});
test('Generic briefings validate sources and numbers, emit safe scenes and reject code or invented data', () => {
  const { engine, id } = research();
  const output = engine.present(visual(id));
  assert.equal(output.verified, true);
  assert.equal(engine.last.scenes[0].panels[0].data[1].value, 24);
  assert.throws(() => engine.present(visual('invented-source')), /source/);
  const fake = visual(id);
  fake.scenes[0].panels[0].data[0].value = 999;
  assert.throws(() => engine.present(fake), /Chart values/);
  const code = visual(id);
  code.scenes[0].panels[0].code = 'alert(1)';
  assert.throws(() => engine.present(code));
  const image = visual(id);
  image.scenes[0].panels[0].imageIds = ['767da13b-008a-45af-a339-cd5a27fc7fcb'];
  assert.throws(() => engine.present(image), /Image/);
  const crowded = visual(id);
  crowded.scenes[0].panels[0].items = [{ label: 'A', value: '12' }];
  assert.throws(() => engine.present(crowded), /separate panels/);
  const huge = visual(id);
  huge.scenes = Array.from({ length: 9 }, () => huge.scenes[0]);
  assert.throws(() => engine.present(huge));
});
test('Automatic weather and video scenes use actual values; snippets and invalid URLs are honest', () => {
  const e = new BriefingEngine();
  e.begin('weather');
  e.observe({
    tool: 'get_weather',
    result: {
      success: true,
      source: { url: 'https://example.org/weather' },
      location: 'Toronto',
      current: { temperature_2m: 12 },
      units: { temperature_2m: '°C' },
      fetchedAt: '2026-10-02T01:00:00Z',
    },
  });
  assert.equal(e.last.scenes[0].panels[1].items[0].value, '12');
  assert.equal(typeof e.last.sources[0].fetchedAt, 'number');
  e.begin('video');
  e.observe({
    tool: 'web_search',
    result: {
      success: true,
      sources: [
        { url: 'https://example.org/snippet', title: 'Snippet', snippet: 'Found text' },
        {
          url: 'https://example.org/channel',
          title: 'Channel',
          videos: [{ title: 'Latest', viewCount: 4500 }],
        },
      ],
    },
  });
  assert.equal(e.last.sources[0].readable, false);
  assert.equal(e.last.scenes[1].panels[1].data[0].value, 4500);
  assert.deepEqual(
    e.observe({
      tool: 'find_images',
      result: {
        success: true,
        sources: [{ url: 'https://user:password@example.org/' }, { url: 'https://' }],
      },
    }),
    [],
  );
});
test('Registered image IDs expire, missing/broken images fail safely, and briefing tools stay read-only', async () => {
  const r = new ResearchAgent();
  await assert.rejects(r.image('missing'), /expired/);
  const page = r.registerImages({
    images: [
      { url: 'http://127.0.0.1/private.png', title: 'Fixture', sourceUrl: 'https://example.org/' },
    ],
  });
  await assert.rejects(r.image(page.images[0].id));
  r.images.get(page.images[0].id).registeredAt = 0;
  await assert.rejects(r.image(page.images[0].id), /expired/);
  assert.equal(validate({ tool: 'find_images', args: { query: 'engineering images' } }).risk, 0);
  assert.throws(() => validate({ tool: 'find_images', args: { query: '' } }));
});
test('Narration completes only after final actual playback, never after interruption or partial streaming', async () => {
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../frontend/speechPlayback.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', code)(mod.exports, mod, () =>
    require('../core/speech-text.mjs'),
  );
  let finish,
    complete = 0;
  const tick = () => new Promise((r) => setImmediate(r));
  const player = new mod.exports.SpeechPlayback({
    synthesize: async (t) => t,
    play: () => ({ done: new Promise((r) => (finish = r)), stop: () => finish() }),
    state: () => {},
    error: (e) => {
      throw e;
    },
    complete: () => complete++,
  });
  player.begin();
  player.append('A streamed sentence. ');
  await tick();
  finish();
  await tick();
  assert.equal(complete, 0);
  player.append('The final sentence.');
  player.finish();
  await tick();
  assert.equal(complete, 0);
  finish();
  await tick();
  assert.equal(complete, 1);
  player.speak('A cancelled narration.');
  await tick();
  player.stop();
  await tick();
  assert.equal(complete, 1);
});
test('timeouts are explained as timeouts rather than user cancellation', () => {
  assert.match(
    publicError(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    /too long/,
  );
  assert.match(publicError(new DOMException('Aborted', 'AbortError')), /cancelled/);
});
test('a configured vision-only Gemini model captions before the tool-capable primary plans', async () => {
  const used = [];
  const p = (id, caps) => ({
    capabilities: async () => caps,
    chat: async (m, t, v) => {
      used.push({ id, tools: !!t?.length, vision: v, images: m.some((x) => x.images?.length) });
      return { content: 'Observation', role: 'assistant', usage: { input: 1, output: 1 } };
    },
  });
  const r = new ProviderRouter({
    config: () => ({
      ...config(),
      cloudEnabled: true,
      provider: 'openai',
      visionProvider: 'gemini',
      cloudScreen: true,
      cloudVision: 'when-needed',
    }),
    secrets: key,
    providers: { openai: p('openai', ['TEXT', 'TOOLS']), gemini: p('gemini', ['TEXT', 'VISION']) },
  });
  await r.chat([...messages, { role: 'user', content: 'Look', images: ['image'] }], tools, true);
  assert.deepEqual(used, [
    { id: 'gemini', tools: false, vision: true, images: true },
    { id: 'openai', tools: true, vision: false, images: false },
  ]);
  assert.equal(r.usage.requests, 2);
});
