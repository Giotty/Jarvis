const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FileSearch } = require('../core/file-search.cjs');
const { weather } = require('../core/weather.cjs');
const {
  ResearchAgent,
  extract,
  publicCount,
  watchMetadata,
} = require('../core/research-agent.cjs');
const { PluginRegistry } = require('../core/plugins/registry.cjs');
const { schema } = require('../core/config.cjs');
const { capabilityCorrection } = require('../core/agent/response-generator.cjs');
const { safeResponse } = require('../core/agent/response-generator.cjs');

test('successful filename search pages use unique single-use cursors and empty pages cannot invent new paths', async () => {
  const root = path.resolve('tmp/virtual-pagination');
  const io = {
    readdir: async () =>
      Array.from({ length: 8 }, (_, i) => ({
        name: 'file' + i,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      })),
  };
  const search = new FileSearch({ io, maxEntries: 1 });
  let page = await search.search({ query: 'absent', roots: [root], scope: 'computer' });
  const used = new Set();
  for (let i = 0; i < 6; i++) {
    const cursor = page.cursor;
    assert.ok(!used.has(cursor));
    used.add(cursor);
    page = await search.search({ query: 'absent', roots: [root], scope: 'computer', cursor });
    assert.notEqual(page.cursor, cursor);
    await assert.rejects(
      search.search({ query: 'absent', roots: [root], scope: 'computer', cursor }),
      /expired/,
    );
  }
  assert.match(
    safeResponse('Found C:\\invented.txt', [{ tool: 'search_files', result: page }]),
    /No additional/,
  );
});
const { targetWindow } = require('../core/window-target.cjs');
const { Ollama } = require('../core/ollama.cjs');
const { ContextManager } = require('../core/agent/context-manager.cjs');

test('file search continuation survives follow-up turns without leaking private names to cloud planning', () => {
  const context = new ContextManager();
  const config = {
    filesystem: true,
    fileAccess: 'computer',
    fileRoot: 'C:\\Users\\Fixture',
    provider: 'openai',
    cloudEnabled: false,
    cloudFiles: false,
  };
  context.record({
    tool: 'search_files',
    args: { query: 'private filename' },
    result: {
      success: true,
      cursor: 'fixture-cursor',
      scope: JSON.stringify([config.fileAccess, config.fileRoot, null]),
    },
  });
  const local = context.begin('Continue the search.', config, [], null)[0].content;
  assert.match(local, /fixture-cursor/);
  assert.match(local, /private filename/);
  const cloud = context.begin(
    'Continue the search.',
    { ...config, cloudEnabled: true },
    [],
    null,
  )[0].content;
  assert.doesNotMatch(cloud, /private filename|fixture-cursor/);
  const changed = context.begin(
    'Continue the search.',
    { ...config, fileAccess: 'selected' },
    [],
    null,
  )[0].content;
  assert.doesNotMatch(changed, /fixture-cursor/);
});

test('local answers retain their completion reason and have room for a complete sourced reply', async () => {
  const local = new Ollama(() => ({ model: 'fixture', temperature: 0.2, context: 8192 }));
  let request;
  local.request = async (_route, body) => {
    request = body;
    return { message: { content: 'Complete answer.' }, done_reason: 'stop' };
  };
  const reply = await local.chat([{ role: 'user', content: 'Give two sourced updates.' }]);
  assert.equal(request.options.num_predict, 1024);
  assert.equal(reply.finishReason, 'stop');
});

test('read-only screen observation can hide and restore the HUD without a forced focus change', async () => {
  let prepared = 0,
    restored = 0;
  const target = targetWindow(
    () => ({
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      hide: () => {},
      showInactive: () => restored++,
    }),
    async () => {},
    async () => {
      prepared++;
      throw Error('Focus denied');
    },
  );
  assert.equal(await target(async () => 'captured', { focus: false }), 'captured');
  assert.equal(prepared, 0);
  assert.equal(restored, 1);
  await assert.rejects(
    target(async () => 'unsafe action'),
    /Focus denied/,
  );
  assert.equal(prepared, 1);
  assert.equal(restored, 2);
});

test('search resumes within folders, crosses roots and searches hidden/deep folders without gaps', async () => {
  const parent = path.resolve(__dirname, '../tmp');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'search-test-'));
  assert.equal(path.dirname(root), parent);
  try {
    const first = path.join(root, 'home'),
      second = path.join(root, 'drive');
    const deep = path.join(first, 'AppData', ...Array.from({ length: 14 }, (_, i) => 'level' + i));
    await fs.mkdir(deep, { recursive: true });
    await fs.mkdir(second);
    const expected = [];
    for (let i = 0; i < 8; i++) {
      const file = path.join(i < 4 ? deep : second, `jarvis-${i}.txt`);
      await fs.writeFile(file, 'fixture');
      expected.push(file);
    }
    const search = new FileSearch({ maxEntries: 3, pageSize: 2 });
    const found = [];
    let cursor,
      complete = false;
    for (let round = 0; round < 40 && !complete; round++) {
      const page = await search.search({
        query: 'jarvis',
        roots: [first, second],
        scope: 'computer',
        cursor,
      });
      found.push(...page.matches);
      cursor = page.cursor;
      complete = page.complete;
      assert.equal(page.truncated, !page.complete);
    }
    assert.ok(complete);
    assert.deepEqual(found.sort(), expected.sort());
    assert.equal(new Set(found).size, expected.length);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('inaccessible directories and links are reported and continuation cannot expand a changed scope', async () => {
  const dir = (name) => ({ name, isDirectory: () => true, isSymbolicLink: () => false });
  const link = { name: 'loop', isDirectory: () => true, isSymbolicLink: () => true };
  const root = path.resolve('tmp/virtual-home');
  const io = {
    readdir: async (folder) => {
      if (folder === root) return [dir('blocked'), link, dir('more')];
      if (folder.endsWith('blocked')) throw Error('Access denied');
      return [];
    },
  };
  const search = new FileSearch({ io, maxEntries: 1 });
  const page = await search.search({ query: 'loop', roots: [root], scope: 'selected' });
  assert.ok(page.cursor);
  await assert.rejects(
    search.search({ query: 'loop', roots: [root], scope: 'computer', cursor: page.cursor }),
    /scope changed/,
  );
  let next = page;
  while (!next.complete)
    next = await search.search({
      query: 'loop',
      roots: [root],
      scope: 'selected',
      cursor: next.cursor,
    });
  assert.equal(next.skippedDirectories, 1);
  assert.equal(next.skippedLinks, 1);
  await assert.rejects(
    search.search({ query: 'test', roots: [root], scope: 'selected', signal: AbortSignal.abort() }),
  );
});

test('weather asks for missing/ambiguous cities and preserves source time, units and forecast', async () => {
  assert.equal((await weather('')).success, false);
  const calls = [];
  const get = async (url) => {
    calls.push(new URL(url));
    return {
      html: JSON.stringify(
        url.includes('geocoding')
          ? {
              results: [
                {
                  name: 'Toronto',
                  admin1: 'Ontario',
                  country: 'Canada',
                  latitude: 43.65,
                  longitude: -79.38,
                  population: 2800000,
                },
              ],
            }
          : {
              current: { time: '2026-10-02T02:00', temperature_2m: 12, weather_code: 3 },
              current_units: { temperature_2m: '°C' },
              daily: { time: ['2026-10-02'], temperature_2m_max: [19] },
              daily_units: { temperature_2m_max: '°C' },
              timezone: 'America/Toronto',
            },
      ),
    };
  };
  const result = await weather('Toronto, Canada', 3, undefined, get);
  assert.equal(result.verified, true);
  assert.equal(result.current.temperature_2m, 12);
  assert.equal(result.current.time, '2026-10-02T02:00');
  assert.equal(result.units.temperature_2m, '°C');
  assert.equal(calls[0].searchParams.get('name'), 'Toronto, Canada');
  assert.equal(calls[1].searchParams.get('forecast_days'), '3');
  const ambiguous = await weather('Springfield', 3, undefined, async () => ({
    html: JSON.stringify({
      results: [
        { name: 'Springfield', population: 100 },
        { name: 'Springfield', population: 90 },
      ],
    }),
  }));
  assert.equal(ambiguous.success, false);
  assert.ok(ambiguous.choices);
});

test('general research reads public sources in the background and marks blocked sources honestly', async () => {
  const agent = new ResearchAgent();
  agent.search = async () => ({
    success: true,
    verified: true,
    results: [
      { url: 'https://example.com/news', snippet: 'headline' },
      { url: 'https://example.com/blocked', snippet: 'snippet only' },
    ],
  });
  agent.page = async (url) => {
    if (url.endsWith('blocked')) throw Error('blocked');
    return extract(
      '<html><head><title>Update</title><meta property="article:published_time" content="2026-10-01"></head><body><main>New release details</main><script>untrusted code</script></body></html>',
      url,
    );
  };
  const result = await agent.research('latest release');
  assert.equal(result.sources[0].publishedAt, '2026-10-01');
  assert.equal(result.sources[0].text, 'New release details');
  assert.equal(result.sources[1].readable, false);
  assert.equal(result.sources[1].snippet, 'snippet only');
  assert.match(result.message, /answer the user directly/i);
});

test('weather/research/file tools are immediately discoverable and false access denials get one correction', () => {
  const c = schema.parse({ browser: true, filesystem: true, fileAccess: 'computer' });
  const registry = new PluginRegistry({ config: () => c, executor: {}, store: {} });
  const tools = registry.schemas(new Set());
  for (const name of ['get_weather', 'web_search', 'search_files', 'list_drives', 'list_directory'])
    assert.ok(
      tools.some((t) => t.function.name === name),
      name,
    );
  assert.ok(capabilityCorrection("I don't have access to your files.", [], tools, c));
  assert.equal(
    capabilityCorrection(
      "I don't have access to your files.",
      [{ tool: 'search_files' }],
      tools,
      c,
    ),
    null,
  );
  assert.equal(
    capabilityCorrection("I don't have access to your files.", [], [], { filesystem: false }),
    null,
  );
  assert.equal(capabilityCorrection('Hello, sir.', [], tools, c), null);
});

test('research tries alternate sources after blocked first results', async () => {
  const agent = new ResearchAgent();
  agent.search = async () => ({
    success: true,
    results: Array.from({ length: 4 }, (_, i) => ({ url: 'https://example.com/' + i })),
  });
  agent.page = async (url) => {
    if (!url.endsWith('/3')) throw Error('blocked');
    return { url, text: 'Verified source text. '.repeat(20), fetchedAt: 123 };
  };
  const result = await agent.research('a quote');
  assert.equal(result.sources[0].url, 'https://example.com/3');
  assert.ok(result.sources[0].readable);
});

test('YouTube pages use verified public video metadata and channel feed publication dates', async () => {
  const get = async (url) => {
    if (url.includes('/oembed'))
      return {
        html: JSON.stringify({
          title: 'Fixture tutorial',
          author_name: 'Fixture creator',
          author_url: 'https://www.youtube.com/@fixture',
        }),
      };
    if (url.includes('/feeds/'))
      return {
        html: '<feed><entry><title>New tutorial</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-10-02T01:00:00Z</published><author><name>Fixture creator</name></author></entry></feed>',
      };
    return {
      html: '<html><title>Fixture channel</title><body><script>{"externalId":"UCabcdefghijklmnopqrstuv"}</script></body></html>',
      url,
    };
  };
  const agent = new ResearchAgent({ get });
  const video = await agent.page('https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(video.video.author, 'Fixture creator');
  assert.equal(video.publishedAt, undefined);
  const channel = await agent.page('https://www.youtube.com/@fixture');
  assert.equal(channel.videos[0].publishedAt, '2026-10-02T01:00:00Z');
  assert.match(channel.text, /New tutorial/);
});

test('YouTube public counts distinguish views from likes and missing statistics from zero', async () => {
  assert.equal(publicCount('0'), 0);
  for (const value of [undefined, '', '-1', '123 views', '9007199254740992'])
    assert.equal(publicCount(value), null);
  const html = `<meta itemprop="datePublished" content="2026-10-01">
    <div itemprop="interactionStatistic"><meta itemprop="interactionType" content="https://schema.org/LikeAction"><meta itemprop="userInteractionCount" content="17"></div>
    <div itemprop="interactionStatistic"><meta itemprop="interactionType" content="https://schema.org/WatchAction"><meta itemprop="userInteractionCount" content="2345678"></div>`;
  assert.deepEqual(watchMetadata(html), { viewCount: 2345678, publishedAt: '2026-10-01' });
  assert.equal(watchMetadata('<title>Consent required</title>').viewCount, null);
  const get = async (url) => {
    if (url.includes('oembed'))
      return { html: JSON.stringify({ title: 'Video', author_name: 'Creator' }) };
    if (url.includes('/watch')) return { html };
    if (url.includes('/feeds/'))
      return {
        url,
        html: `<feed xmlns:media="http://search.yahoo.com/mrss/">
      <entry><title>Older regular video</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-09-30T00:00:00Z</published><updated>2026-10-02T00:00:00Z</updated><media:group><media:community><media:starRating count="99"/><media:statistics views="1234567"/></media:community></media:group></entry>
      <entry><title>New Short</title><link rel="alternate" href="https://www.youtube.com/shorts/lmnopqrstuv"/><published>2026-10-01T00:00:00Z</published><media:group><media:community><media:statistics views="0"/></media:community></media:group></entry>
      <entry><title>Missing count</title><link rel="alternate" href="https://www.youtube.com/watch?v=12345678901"/><published>2026-09-29T00:00:00Z</published></entry></feed>`,
      };
    return {
      url,
      html: '<title>Channel</title><script>{"externalId":"UCabcdefghijklmnopqrstuv"}</script>',
    };
  };
  const agent = new ResearchAgent({ get });
  const video = await agent.page('https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(video.video.viewCount, 2345678);
  assert.equal(video.publishedAt, '2026-10-01');
  const channel = await agent.page('https://www.youtube.com/@creator');
  assert.equal(channel.videos[0].isShort, true);
  assert.equal(channel.videos[0].viewCount, 0);
  assert.equal(channel.videos[1].viewCount, 1234567);
  assert.equal(channel.videos[1].sourceUpdatedAt, '2026-10-02T00:00:00Z');
  assert.equal(channel.videos[2].viewCount, null);
  assert.match(channel.statisticsSource, /feeds\/videos.xml/);
});

test('blocked YouTube watch pages retain only verified metadata without inventing counts', async () => {
  const get = async (url) => {
    if (url.includes('oembed'))
      return { html: JSON.stringify({ title: 'Public title', author_name: 'Creator' }) };
    throw Error('Page blocked');
  };
  const result = await new ResearchAgent({ get }).page(
    'https://www.youtube.com/watch?v=abcdefghijk',
  );
  assert.equal(result.video.viewCount, null);
  assert.match(result.text, /could not be verified/);
  await assert.rejects(
    new ResearchAgent({
      get: async () => {
        throw Error('blocked');
      },
    }).page('https://www.youtube.com/watch?v=abcdefghijk'),
    /blocked/,
  );
});

test('context compression preserves actual counts, URLs and complete tool pairs without changing stored evidence', () => {
  const context = new ContextManager();
  const observation = JSON.stringify({
    success: true,
    sources: [
      {
        url: 'https://www.youtube.com/@creator',
        text: 'Long description. '.repeat(2000),
        videos: [
          {
            title: 'Latest video',
            url: 'https://www.youtube.com/watch?v=abcdefghijk',
            viewCount: 1234567,
            publishedAt: '2026-10-01',
            isShort: false,
          },
        ],
      },
    ],
  });
  const messages = [
    { role: 'system', content: 'S'.repeat(1000) },
    { role: 'user', content: 'How many views on the latest video?', _request: true },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'a', function: { name: 'web_search', arguments: { query: 'creator latest video' } } },
      ],
    },
    { role: 'tool', tool_call_id: 'a', content: observation },
    { role: 'user', content: 'Answer from the observations.' },
  ];
  const selected = context.select(messages, 3500);
  const tool = selected.find((m) => m.role === 'tool');
  const data = JSON.parse(tool.content);
  assert.ok(tool.content.length < 2300);
  assert.equal(data.sources[0].videos[0].viewCount, 1234567);
  assert.equal(data.sources[0].videos[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(data.contextTruncated, true);
  assert.equal(messages[3].content, observation);
  assert.ok(selected.some((m) => m._request));
  assert.ok(selected.some((m) => m.tool_calls?.[0].id === tool.tool_call_id));
});
