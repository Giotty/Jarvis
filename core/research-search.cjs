const cheerio = require('cheerio');
const { randomUUID } = require('node:crypto');

// Remove conversational/search filler, not entities. Accents and plurals should
// keep arbitrary multilingual names relevant.
const filler = new Set(
  'a an the on in at of for to and or with from by is are was be it its my me you your please hey jarvis give tell all info information got about how what who which can could would should latest current news update updates movie movies film films video videos first second three players people biographies biography details search find website official images image'.split(
    ' ',
  ),
);
function terms(value) {
  return [
    ...new Set(
      String(value)
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .match(/[a-z0-9]{2,}/g)
        ?.filter((t) => !filler.has(t))
        .map((t) => (t.length > 4 ? t.replace(/s$/, '') : t)) || [],
    ),
  ];
}
function relevance(item, query) {
  const wanted = terms(query),
    text = new Set(terms(`${item.title} ${item.snippet || ''} ${item.url}`));
  if (!wanted.length) return 1;
  // Preserve precise product identifiers: a shared vendor/tier name cannot
  // substitute a different CPU, GPU, monitor or software release number.
  const identifiers = productIdentifiers(query);
  if (identifiers.some((t) => !text.has(t))) return 0;
  const matched = wanted.filter((t) => text.has(t)).length;
  // A city-only hit must not satisfy a multiword team/person/product query.
  if (wanted.length >= 2 && matched < 2) return 0;
  return matched / wanted.length;
}
// Preserve precise identifiers for arbitrary entities, including quoted names.
function productIdentifiers(query) {
  return [...new Set(String(query).match(/\b[a-z]*\d{3,}[a-z]*\b/gi) || [])].map((s) =>
    s.toLowerCase(),
  );
}
function authority(item) {
  return item.sourceType === 'primary' || item.official === true ? 1 : 0;
}
function cleanUrl(raw, base) {
  try {
    let url = new URL(raw, base);
    if (url.searchParams.get('uddg')) url = new URL(url.searchParams.get('uddg'));
    if (
      /(^|\.)bing\.com$/.test(url.hostname) &&
      url.pathname === '/news/apiclick.aspx' &&
      url.searchParams.get('url')
    )
      url = new URL(url.searchParams.get('url'));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (/(^|\.)(duckduckgo\.com|bing\.com)$/.test(url.hostname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$|tag$|ascsubtag$|affiliate|ref$)/.test(key))
        url.searchParams.delete(key);
    return url.href;
  } catch {
    return null;
  }
}
function item(title, url, snippet, base, provider) {
  const target = cleanUrl(url, base);
  if (!target || !title?.trim()) return null;
  return {
    id: randomUUID(),
    title: title.trim(),
    url: target,
    snippet: snippet?.trim().slice(0, 600) || '',
    source: new URL(target).hostname,
    searchProvider: provider,
    fetchedAt: Date.now(),
  };
}
function parseSearch(page, provider) {
  const out = [];
  if (provider === 'wikipedia') {
    const data = JSON.parse(page.html);
    for (const row of data.query?.search || []) {
      const snippet = cheerio.load(row.snippet || '').text();
      out.push(
        item(
          row.title,
          'https://en.wikipedia.org/wiki/' + encodeURIComponent(row.title.replace(/ /g, '_')),
          snippet,
          page.url,
          provider,
        ),
      );
    }
  } else {
    const $ = cheerio.load(page.html, { xmlMode: provider.startsWith('bing') });
    if (provider.startsWith('bing'))
      $('item').each((_, n) =>
        out.push(
          item(
            $(n).find('title').text(),
            $(n).find('link').text(),
            $(n).find('description').text(),
            page.url,
            provider,
          ),
        ),
      );
    else
      $('.result').each((_, n) => {
        const a = $(n).find('.result__a').first();
        out.push(
          item(a.text(), a.attr('href'), $(n).find('.result__snippet').text(), page.url, provider),
        );
      });
  }
  return out.filter(Boolean).slice(0, 12);
}
function diverse(items, limit = 12) {
  const selected = [],
    counts = new Map(),
    seen = new Set();
  for (const entry of items) {
    const key = entry.url.replace(/\/$/, '');
    const host = new URL(entry.url).hostname.replace(/^www\./, '');
    if (seen.has(key) || (counts.get(host) || 0) >= 2) continue;
    selected.push(entry);
    seen.add(key);
    counts.set(host, (counts.get(host) || 0) + 1);
    if (selected.length === limit) break;
  }
  return selected;
}
function coveringLinks(items, query, limit = 4) {
  const remaining = diverse(items, 30),
    wanted = new Set(terms(query)),
    selected = [];
  while (remaining.length && selected.length < limit) {
    remaining.sort((a, b) => {
      const score = (r) =>
        terms(r.title + ' ' + r.url).filter((t) => wanted.has(t)).length * 2 + r.relevance;
      return score(b) - score(a);
    });
    const next = remaining.shift();
    if (diverse([...selected, next], limit).length <= selected.length) continue;
    selected.push(next);
    for (const term of terms(next.title + ' ' + next.url)) wanted.delete(term);
  }
  return selected;
}
async function searchPublic(get, query, signal, alternatives = []) {
  const focused = alternatives
    .filter((q) => typeof q === 'string' && q.trim())
    .map((q) => q.trim().slice(0, 500));
  const words = query.trim().split(/\s+/);
  // A second word can disambiguate a leading city/generic name when an engine
  // silently broadens the query. No command/team/site-specific rules.
  const rotated = words.length > 1 ? [words[1], words[0], ...words.slice(2)].join(' ') : query;
  const queries = [...new Set([query, ...focused, rotated])].slice(0, 3);
  const jobs = queries.map((q) => [
    'bing',
    'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(q),
  ]);
  for (const q of queries)
    jobs.push([
      'bing-news',
      'https://www.bing.com/news/search?format=rss&q=' + encodeURIComponent(q),
    ]);
  jobs.push(['duckduckgo', 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)]);
  jobs.push([
    'wikipedia',
    'https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=6&format=json&srsearch=' +
      encodeURIComponent(focused[0] || query),
  ]);
  const failures = [];
  const batches = await Promise.all(
    jobs.map(async ([provider, url]) => {
      try {
        const deadline = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(4500)])
          : AbortSignal.timeout(4500);
        return parseSearch(await get(url, deadline), provider);
      } catch {
        signal?.throwIfAborted();
        failures.push(provider + ': unavailable');
        return [];
      }
    }),
  );
  const timeSensitive = /\b(latest|current|today|recent|news|updates?)\b/i.test(query);
  const restricted = [...query.matchAll(/\bsite:([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  const ranked = batches
    .flat()
    .map((r) => ({ ...r, relevance: relevance(r, query) }))
    .filter((r) => r.relevance > 0)
    .filter(
      (r) =>
        !restricted.length ||
        restricted.some(
          (h) => new URL(r.url).hostname === h || new URL(r.url).hostname.endsWith('.' + h),
        ),
    )
    .sort(
      (a, b) =>
        b.relevance +
        (timeSensitive && b.searchProvider === 'bing-news' ? 0.1 : 0) -
        (a.relevance + (timeSensitive && a.searchProvider === 'bing-news' ? 0.1 : 0)),
    );
  return {
    results: diverse(ranked),
    queries,
    providers: [...new Set(jobs.map(([p]) => p))],
    failures,
  };
}
module.exports = {
  terms,
  relevance,
  cleanUrl,
  diverse,
  coveringLinks,
  parseSearch,
  searchPublic,
  productIdentifiers,
  authority,
};
