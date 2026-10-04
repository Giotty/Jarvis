const test = require('node:test');
const assert = require('node:assert/strict');
const { ResearchAgent, extract } = require('../core/research-agent.cjs');
const { cleanUrl, coveringLinks, searchPublic } = require('../core/research-search.cjs');
const { BriefingEngine } = require('../core/briefing.cjs');
const { ResearchWorkspace } = require('../core/workspace.cjs');
const rss = (items) =>
  '<rss><channel>' +
  items
    .map(
      ([title, url, snippet]) =>
        `<item><title>${title}</title><link>${url}</link><description>${snippet}</description></item>`,
    )
    .join('') +
  '</channel></rss>';

test('search merges public indexes, disambiguates broad results and keeps source diversity', async () => {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname.includes('duckduckgo'))
      return {
        url,
        html: `<div class="result"><a class="result__a" href="https://sports.example/analysis?utm_source=x">Montreal Canadiens lines</a><div class="result__snippet">Roster news</div></div>`,
      };
    if (u.hostname.includes('wikipedia'))
      return {
        url,
        html: JSON.stringify({
          query: { search: [{ title: 'Montreal Canadiens', snippet: 'Roster and lines' }] },
        }),
      };
    if (u.pathname.includes('/news/'))
      return {
        url,
        html: rss([
          ['Canadiens Montreal lineup', 'https://local-paper.example/roster', 'First line updates'],
        ]),
      };
    if (u.searchParams.get('q').startsWith('Canadiens'))
      return {
        url,
        html: rss([
          ['Montreal Canadiens roster', 'https://official.example/roster', 'Current lineup'],
          ['Montreal Canadiens', 'https://sports.example/summary', 'Roster news'],
        ]),
      };
    return {
      url,
      html: rss([['Montreal tourism', 'https://city.example/tourism', 'Visit Montreal parks']]),
    };
  };
  const r = await searchPublic(get, 'Montreal Canadiens first line roster', undefined, [
    'Canadiens roster',
  ]);
  assert.ok(calls.some((u) => new URL(u).searchParams.get('q')?.startsWith('Canadiens Montreal')));
  assert.ok(r.results.length >= 4);
  assert.ok(!r.results.some((r) => r.url.includes('city.example')));
  assert.equal(r.results.filter((r) => r.url.includes('sports.example/analysis')).length, 1);
  assert.ok(r.results.every((r) => r.relevance > 0));
  assert.equal(new Set(r.results.map((r) => r.searchProvider)).size, 4);
});

test('all blocked providers return an honest empty result and cancellation is never swallowed', async () => {
  const agent = new ResearchAgent({
    get: async () => {
      throw Error('blocked');
    },
  });
  const r = await agent.search('distinct product facts');
  assert.equal(r.success, false);
  assert.equal(r.results.length, 0);
  assert.ok(r.failures.length >= 4);
  await assert.rejects(agent.search('topic', AbortSignal.abort()), { name: 'AbortError' });
});

test('news links are unwrapped into attributed publisher URLs without allowing credentials or unsafe protocols', () => {
  assert.equal(
    cleanUrl(
      'https://www.bing.com/news/apiclick.aspx?url=' +
        encodeURIComponent('https://small-paper.example/story?utm_medium=rss'),
      'https://www.bing.com/',
    ),
    'https://small-paper.example/story',
  );
  assert.equal(cleanUrl('javascript:alert(1)', 'https://example.org'), null);
  assert.equal(cleanUrl('https://user:password@example.org/private', 'https://example.org'), null);
});

test('deeper discovery covers missing aspects instead of following several copies of the same roster', () => {
  const link = (title, url, relevance) => ({ title, url, relevance });
  const r = coveringLinks(
    [
      link('Montreal Canadiens roster', 'https://official.example/canadiens/roster', 0.75),
      link(
        'Montreal Canadiens roster transactions',
        'https://paper.example/canadiens/roster',
        0.75,
      ),
      link('Lines at practice', 'https://official.example/canadiens/lines', 0.5),
    ],
    'Montreal Canadiens line roster',
    2,
  );
  assert.ok(r.some((r) => r.url.endsWith('/lines')));
});

test('research returns newly discovered readable pages before homepages and tries blocked alternatives', async () => {
  const agent = new ResearchAgent();
  agent.search = async () => ({
    success: true,
    results: Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      url: `https://host${i}.example/`,
      title: 'Homepage',
    })),
  });
  const calls = [];
  agent.page = async (url) => {
    calls.push(url);
    if (url.includes('host1')) throw Error('blocked');
    return {
      url,
      title: 'Source',
      text: 'Supported roster data. '.repeat(30),
      links: url.includes('host0')
        ? [{ id: 'deep', url: 'https://specialist.example/roster', title: 'Roster', relevance: 1 }]
        : [],
    };
  };
  const r = await agent.research('Example roster');
  assert.ok(calls.includes('https://specialist.example/roster'));
  assert.equal(r.sources[0].url, 'https://specialist.example/roster');
  assert.equal(r.sources.length, 6);
  assert.ok(r.sources.every((s) => s.readable));
});

test('public structured records and table rows survive extraction; scripts never execute', () => {
  const page = extract(
    `<title>Team roster</title><main><table><tr><th>Player</th><th>Position</th></tr><tr><td>Fixture Person</td><td>Centre</td></tr></table></main>
  <script>throw new Error('execute')</script><script type="application/ld+json">{"@type":"Person","name":"Fixture Person","birthPlace":{"name":"Fixture Town"},"position":"Centre"}</script>`,
    'https://example.org/roster',
  );
  assert.match(page.text, /Fixture Person \| Centre \|/);
  assert.match(page.text, /birthPlace.name: Fixture Town/);
  assert.doesNotMatch(page.text, /throw new Error/);
  assert.equal(page.untrusted, true);
});
test('Public review page navigation discovers conclusion URLs without submitting forms', () => {
  const page = extract(
    '<title>Processor A review</title><form><select><option value="/reviews/processor-a/conclusion.html">Conclusion</option><option value="javascript:bad">Ignore</option></select></form><article><p>Processor A review discusses a compact and efficient product with detailed measurements.</p><a href="/reviews/processor-a/architecture.html">Architecture</a></article>',
    'https://example.org/reviews/processor-a/',
    'Processor A review',
  );
  assert.equal(page.links[0].url, 'https://example.org/reviews/processor-a/conclusion.html');
  assert.ok(page.links.every((l) => l.url.startsWith('https://example.org/')));
  assert.doesNotMatch(page.text, /Ignore|Conclusion/);
});

test('relevant sections past the old truncation limit remain readable with their heading context', () => {
  const long =
    '<main><p>Introduction.</p>' +
    Array.from(
      { length: 180 },
      () => '<p>Repeated unrelated history paragraph with many words.</p>',
    ).join('') +
    '<h2>Example roster</h2><p>Fixture Person is the starting Centre.</p></main>';
  const r = extract(long, 'https://example.org/', 'Example roster');
  assert.match(r.text, /Fixture Person is the starting Centre/);
  assert.ok(r.text.length <= 4500);
});

test('broader research does not fill the workspace with uncited sources and keeps useful roster evidence', () => {
  const workspace = new ResearchWorkspace({}),
    briefing = new BriefingEngine({ workspace });
  briefing.begin('Roster research');
  for (let i = 0; i < 45; i++)
    briefing.observe({
      tool: 'extract_page_text',
      result: {
        success: true,
        url: `https://example.org/${i}`,
        title: 'Source ' + i,
        text: 'Actual roster row. '.repeat(95),
      },
    });
  const source = [...briefing.sources.values()][0];
  assert.ok(briefing.evidence(new Set([source.id]))[0].excerpt.length > 700);
  const result = briefing.present({
    title: 'Selected facts',
    scenes: [
      {
        title: 'Fact',
        panels: [
          { type: 'text', title: 'Observed', body: 'Actual roster row.', sourceIds: [source.id] },
        ],
      },
    ],
  });
  assert.equal(result.success, true);
  assert.equal(workspace.current.sources.length, 1);
  assert.equal(briefing.sources.size, 45);
});
