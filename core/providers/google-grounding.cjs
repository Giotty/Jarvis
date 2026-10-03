const cheerio = require('cheerio');
const { randomUUID } = require('node:crypto');
function publicLink(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
function searchWidget(html) {
  const $ = cheerio.load(String(html || '').slice(0, 80000));
  $('script,iframe,object,embed,form,input,button,link,meta,base').remove();
  const links = [];
  $('*').each((_, n) => {
    for (const k of Object.keys(n.attribs || {})) if (/^on/i.test(k)) $(n).removeAttr(k);
  });
  $('a').each((_, n) => {
    const url = publicLink($(n).attr('href'));
    if (!url) {
      $(n).remove();
      return;
    }
    $(n).attr('href', url).attr('target', '_blank').attr('rel', 'noreferrer noopener');
    links.push(url);
  });
  return {
    html:
      $('head style')
        .toArray()
        .map((n) => $.html(n))
        .join('') + ($('body').html() || ''),
    links: [...new Set(links)].slice(0, 20),
  };
}
function groundedSources(reply) {
  const g = reply.grounding || {},
    chunks = g.groundingChunks || [],
    supports = g.groundingSupports || [],
    text = reply.content || '';
  const sources = chunks.slice(0, 12).flatMap((chunk, index) => {
    const url = publicLink(chunk.web?.uri);
    if (!url) return [];
    const claims = supports
      .filter((s) => s.groundingChunkIndices?.includes(index))
      .map((s) => s.segment?.text || '')
      .filter(Boolean);
    // Do not attribute an entire generated answer to every citation.
    if (!claims.length) return [];
    return [
      {
        id: randomUUID(),
        chunkIndex: index,
        url,
        title: chunk.web.title || new URL(url).hostname,
        text: claims.join('\n').slice(0, 4500),
        readable: false,
        grounded: true,
        untrusted: true,
        fetchedAt: Date.now(),
        images: [],
        message: 'Google-grounded cited segments; the publisher page has not yet been read.',
      },
    ];
  });
  const indices = new Map(sources.map((source, index) => [source.chunkIndex, index + 1]));
  let cited = text;
  const insertions = new Map();
  for (const support of supports) {
    const end = support.segment?.endIndex;
    if (!Number.isInteger(end) || end < 0 || end > text.length) continue;
    const numbers = (support.groundingChunkIndices || [])
      .map((index) => indices.get(index))
      .filter(Boolean);
    if (numbers.length)
      insertions.set(end, [...new Set([...(insertions.get(end) || []), ...numbers])]);
  }
  for (const [end, numbers] of [...insertions].sort((a, b) => b[0] - a[0]))
    cited = cited.slice(0, end) + numbers.map((n) => '[' + n + ']').join('') + cited.slice(end);
  const widget = searchWidget(g.searchEntryPoint?.renderedContent);
  return {
    success: sources.length > 0,
    sources,
    groundedAnswer: cited.slice(0, 16000),
    googleGrounding: {
      answer: cited.slice(0, 16000),
      sources: sources.map(({ id, title, url }) => ({ id, title, url })),
      searchHtml: widget.html,
      allowedLinks: [...new Set([...widget.links, ...sources.map((s) => s.url)])],
      queries: (g.webSearchQueries || []).slice(0, 8),
    },
  };
}
module.exports = { groundedSources, searchWidget };
