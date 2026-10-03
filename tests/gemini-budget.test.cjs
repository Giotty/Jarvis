const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { schema } = require('../core/config.cjs');
const { GeminiBudget, localDay } = require('../core/providers/gemini-budget.cjs');
const { ProviderRouter } = require('../core/providers/router.cjs');
const { groundedSources, searchWidget } = require('../core/providers/google-grounding.cjs');
const { ResearchAgent } = require('../core/research-agent.cjs');
const messages = [{ role: 'user', content: 'Hello' }];
const secrets = { get: () => 'synthetic-test-key' };
const config = (extra) =>
  schema.parse({
    provider: 'gemini',
    cloudEnabled: true,
    geminiModel: 'gemini-2.5-flash',
    geminiVisionModel: 'gemini-2.5-flash',
    fallbackProvider: 'ollama',
    preferLocalSimple: false,
    cloudScreen: true,
    cloudVision: 'manual',
    ...extra,
  });
const cloudReply = () =>
  new Response(
    JSON.stringify({
      candidates: [
        { content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' },
      ],
    }),
  );
const local = {
  capabilities: async () => ['TEXT', 'TOOLS', 'VISION', 'STREAMING', 'STRUCTURED_OUTPUT'],
  chat: async () => ({ content: 'Local response' }),
  models: async () => ({ online: true, models: ['local'] }),
};
test('Gemini defaults to a configurable positive integer safety cap of 100', () => {
  assert.equal(schema.parse({}).geminiDailyCap, 100);
  for (const value of [0, -1, 1.5, 100001])
    assert.equal(schema.safeParse({ geminiDailyCap: value }).success, false);
  assert.equal(config({ geminiDailyCap: 250 }).geminiDailyCap, 250);
});
test('Budget warns once at 80%, persists across restarts and resets at LOCAL midnight', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-budget-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = new Date(2026, 9, 3, 23, 59, 59),
    c = config();
  const events = [];
  const options = {
    directory,
    clock: () => now,
    config: () => c,
    emit: (type, data) => events.push({ type, data }),
  };
  const b = new GeminiBudget(options);
  for (let i = 0; i < 79; i++) b.take();
  assert.equal(events.filter((e) => e.type === 'progress').length, 0);
  b.take();
  b.take();
  assert.equal(events.filter((e) => e.type === 'progress').length, 1);
  assert.equal(b.snapshot().warning, true);
  const restored = new GeminiBudget(options);
  assert.equal(restored.snapshot().used, 81);
  assert.equal(restored.snapshot().resetAt, new Date(2026, 9, 4).getTime());
  c = config({ geminiDailyCap: 80 });
  assert.equal(restored.snapshot().limited, true);
  c = config({ geminiDailyCap: 200 });
  assert.equal(restored.snapshot().limited, false);
  now = new Date(2026, 9, 4, 0, 0, 0);
  assert.equal(restored.snapshot().used, 0);
  assert.equal(restored.snapshot().day, localDay(now));
  assert.equal(restored.snapshot().warning, false);
  restored.take();
  assert.equal(new GeminiBudget(options).snapshot().used, 1);
});
test('Parallel calls cannot exceed cap and later requests use Ollama without a Gemini fetch', async () => {
  let fetches = 0;
  const r = new ProviderRouter({
    config: () => config(),
    secrets,
    fetcher: async () => {
      fetches++;
      return cloudReply();
    },
  });
  r.providers.ollama = local;
  r.geminiBudget.snapshot();
  r.geminiBudget.data.used = 99;
  const replies = await Promise.all(Array.from({ length: 8 }, () => r.chat(messages)));
  assert.equal(fetches, 1);
  assert.equal(r.usageSnapshot().geminiBudget.used, 100);
  assert.equal(replies.filter((v) => v.provider === 'gemini').length, 1);
  assert.equal(replies.filter((v) => v.provider === 'ollama').length, 7);
  await r.chat(messages);
  assert.equal(fetches, 1);
});
test('A capped Gemini always uses LOCAL fallback even when another cloud fallback is selected', async () => {
  let cloud = 0;
  const r = new ProviderRouter({
    config: () => config({ fallbackProvider: 'openai' }),
    secrets,
    fetcher: async () => {
      cloud++;
      return cloudReply();
    },
  });
  r.providers.ollama = local;
  r.geminiBudget.snapshot();
  r.geminiBudget.data.used = 100;
  assert.equal((await r.chat(messages)).provider, 'ollama');
  assert.equal(cloud, 0);
});
test('Gemini 3.8 supports real tool/vision routing and low thinking; free web mode never requests Google grounding', async () => {
  let calls = 0,
    body;
  const r = new ProviderRouter({
    config: () =>
      config({
        geminiModel: 'gemini-3.8-flash',
        geminiVisionModel: 'gemini-3.8-flash',
        geminiGrounding: false,
      }),
    secrets,
    fetcher: async (_, init) => {
      calls++;
      body = JSON.parse(init.body);
      return cloudReply();
    },
  });
  r.providers.ollama = local;
  await assert.rejects(r.groundedResearch('fixture'), (e) => e.code === 'grounding_disabled');
  assert.equal(calls, 0);
  await r.chat(messages);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.ok((await r.capabilities('gemini', 'gemini-3.8-flash')).includes('TOOLS'));
});
test('Streaming attempts and failures count; model discovery and pre-aborted calls do not', async () => {
  const r = new ProviderRouter({
    config: () => config(),
    secrets,
    fetcher: async (url) => {
      if (url.includes('?pageSize=')) return new Response(JSON.stringify({ models: [] }));
      throw Error('Synthetic transport failure');
    },
  });
  r.providers.ollama = local;
  await r.models('gemini');
  assert.equal(r.geminiBudget.snapshot().used, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(r.chat(messages, undefined, false, controller.signal));
  assert.equal(r.geminiBudget.snapshot().used, 0);
  await r.chat(messages, undefined, false, undefined, () => {});
  assert.equal(r.geminiBudget.snapshot().used, 1);
});
test('Google 429 invokes local fallback and suppresses new attempts during server cooldown', async () => {
  let now = new Date(2026, 9, 3, 12),
    calls = 0;
  const r = new ProviderRouter({
    config: () => config(),
    secrets,
    budgetClock: () => now,
    fetcher: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          error: {
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '120s' }],
          },
        }),
        { status: 429 },
      );
    },
  });
  r.providers.ollama = local;
  assert.equal((await r.chat(messages)).provider, 'ollama');
  assert.equal(r.geminiBudget.snapshot().reason, 'google_rate_limit');
  await r.chat(messages);
  assert.equal(calls, 1);
  assert.equal(r.geminiBudget.snapshot().used, 1);
  now = new Date(now.getTime() + 121000);
  await r.chat(messages);
  assert.equal(calls, 2);
});
test('Damaged budget ledger fails closed today and recovers next local day', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-budget-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'gemini-budget.json'), 'broken');
  let now = new Date(2026, 9, 3);
  const b = new GeminiBudget({ directory, clock: () => now, config: () => config() });
  assert.throws(() => b.take());
  now = new Date(2026, 9, 4);
  assert.equal(b.take().used, 1);
});
test('Background screen inference stays local; explicitly requested cloud vision counts', async () => {
  let fetches = 0;
  const r = new ProviderRouter({
    config: () => config(),
    secrets,
    fetcher: async () => {
      fetches++;
      return cloudReply();
    },
  });
  r.providers.ollama = local;
  const image = [{ role: 'user', content: 'Look', images: ['data:image/png;base64,c2NyZWVu'] }];
  await r.chat(image, undefined, true, undefined, undefined, { localOnly: true });
  assert.equal(fetches, 0);
  await r.chat(image, undefined, true, undefined, undefined, { manualVision: true });
  assert.equal(fetches, 1);
  assert.equal(r.geminiBudget.snapshot().used, 1);
});
const grounding = {
  groundingChunks: [
    { web: { uri: 'https://example.org/one', title: 'One' } },
    { web: { uri: 'https://example.org/two', title: 'Two' } },
  ],
  groundingSupports: [{ segment: { text: 'Observed fact one.' }, groundingChunkIndices: [0] }],
  searchEntryPoint: {
    renderedContent:
      '<style>.search{color:black}</style><div class="search"><a href="https://google.com/search?q=fixture">Search</a></div>',
  },
  webSearchQueries: ['fixture'],
};
test('Research uses Google Search separately from action tools and counts its request', async () => {
  let body;
  const r = new ProviderRouter({
    config: () => config(),
    secrets,
    fetcher: async (_, init) => {
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Observed fact one.' }] },
              finishReason: 'STOP',
              groundingMetadata: grounding,
            },
          ],
        }),
      );
    },
  });
  r.providers.ollama = local;
  const result = await r.groundedResearch('fixture');
  assert.equal(result.success, true);
  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(r.geminiBudget.snapshot().used, 1);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].text, 'Observed fact one.');
  assert.equal(result.sources[0].readable, false);
  assert.match(result.googleGrounding.searchHtml, /<style>/);
});
test('Grounding is not invented without supports and unsafe widget content is removed', () => {
  assert.equal(
    groundedSources({
      content: 'Unverified',
      grounding: { groundingChunks: grounding.groundingChunks },
    }).success,
    false,
  );
  const widget = searchWidget(
    '<script>bad()</script><iframe src="https://evil.test"></iframe><a onclick="bad()" href="javascript:bad()">bad</a><a href="https://example.org">good</a>',
  );
  assert.doesNotMatch(widget.html, /script|iframe|onclick|javascript/);
  assert.deepEqual(widget.links, ['https://example.org/']);
});
test('Grounded source attribution survives unreadable publisher pages without opening a browser', async () => {
  const result = groundedSources({ content: 'Observed fact one.', grounding });
  const emitted = [];
  const r = new ResearchAgent({
    ground: async () => result,
    get: async () => {
      throw Error('Publisher blocked');
    },
    emit: (type, data) => emitted.push({ type, data }),
  });
  const researched = await r.research('fixture');
  assert.equal(researched.sources[0].text, 'Observed fact one.');
  assert.equal(researched.sources[0].readable, false);
  assert.equal(emitted[0].type, 'google-grounding');
  assert.equal(r.selected(researched.sources[0].id).grounded, true);
});
