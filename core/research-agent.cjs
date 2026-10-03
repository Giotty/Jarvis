const cheerio = require('cheerio');
const {
  searchPublic,
  relevance,
  cleanUrl,
  diverse,
  terms,
  coveringLinks,
} = require('./research-search.cjs');
const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
function publicAddress(address) {
  if (address.includes(':')) return /^2[0-9a-f]{3}:/i.test(address); // Global unicast only; no loopback, mapped IPv4 or local IPv6.
  const [a, b] = address.split('.').map(Number);
  return (
    a > 0 &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && b === 168) &&
    !(a === 198 && [18, 19].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127)
  );
}
async function webGet(
  input,
  signal,
  accept = 'text/html,application/xhtml+xml,application/rss+xml,text/plain',
  binary = false,
) {
  let url = new URL(input);
  for (let redirect = 0; redirect < 4; redirect++) {
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && !['80', '443'].includes(url.port))
    )
      throw Error('Research only reads ordinary public web pages.');
    const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw Error('Research cannot read local or private network addresses.');
    const deadline = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000);
    // Pin the validated addresses, including on redirects. A second DNS lookup
    // must not let a public image/page redirect the connection into a private LAN.
    const response = await new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).get(
        url,
        {
          signal: deadline,
          lookup: (_hostname, options, callback) =>
            options.all
              ? callback(null, addresses)
              : callback(null, addresses[0].address, addresses[0].family),
          headers: {
            'User-Agent': 'Mozilla/5.0 JARVIS-Research/1.0',
            Accept: accept,
          },
        },
        (incoming) =>
          resolve({
            status: incoming.statusCode,
            ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
            headers: { get: (name) => incoming.headers[name] },
            body: incoming,
          }),
      );
      request.on('error', (error) => reject(deadline.aborted ? deadline.reason : error));
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.get('location')) throw Error('Incomplete page redirect.');
      url = new URL(response.headers.get('location'), url);
      response.body.destroy();
      continue;
    }
    if (!response.ok) throw Error(`Research page returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (
      binary
        ? !/^image\/(?:png|jpeg|webp|gif|avif)(?:;|$)/i.test(contentType)
        : !/text|html|xml|json/.test(contentType)
    ) {
      response.body.destroy();
      throw Error('This page is not readable web text.');
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2000000) {
        response.body.destroy();
        throw Error('Page exceeds the text extraction limit.');
      }
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    return binary
      ? { url: url.href, data, mime: contentType.split(';')[0] }
      : { url: url.href, html: data.toString('utf8') };
  }
  throw Error('Too many page redirects.');
}
function structuredText($) {
  const lines = [];
  let visited = 0;
  const useful =
    /^(name|firstName|lastName|fullName|headline|description|articleBody|text|birthDate|birthPlace|jobTitle|position|positionCode|datePublished|dateModified|startDate|endDate|value|unitText|price|priceCurrency|ratingValue|ratingCount|teamName|title|label|caption|addressLocality|addressCountry)$/i;
  const walk = (value, path, depth = 0) => {
    if (++visited > 6000 || depth > 12 || lines.join('').length > 12000) return;
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value))
        walk(child, [...path.slice(-3), key], depth + 1);
    } else if (useful.test(path.at(-1) || '') && ['string', 'number'].includes(typeof value))
      lines.push(path.join('.') + ': ' + String(value).slice(0, 2500));
  };
  $('script[type="application/ld+json"],script[type="application/json"],script#__NEXT_DATA__')
    .slice(0, 12)
    .each((_, node) => {
      try {
        walk(JSON.parse($(node).text()), []);
      } catch {
        /* Malformed data is not executable content. */
      }
    });
  return lines.join('\n');
}
function excerpt(text, query, limit = 12000) {
  if (!query || text.length <= limit) return text.slice(0, limit);
  const blocks = text.split('\n').filter(Boolean);
  const wanted = terms(query),
    tokens = blocks.map((b) => new Set(terms(b)));
  const weights = new Map(
    wanted.map((t) => [
      t,
      Math.log(1 + blocks.length / (1 + tokens.filter((b) => b.has(t)).length)),
    ]),
  );
  const scored = blocks
    .map((body, i) => ({
      body,
      i,
      score: wanted.reduce((sum, t) => sum + (tokens[i].has(t) ? weights.get(t) : 0), 0),
    }))
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score);
  const selected = new Set([0]);
  let size = blocks[0]?.length || 0;
  for (const b of scored) {
    if (size + b.body.length > limit - 500) continue;
    for (const i of [b.i - 1, b.i, b.i + 1])
      if (i >= 0 && i < blocks.length && !selected.has(i) && size + blocks[i].length <= limit) {
        selected.add(i);
        size += blocks[i].length;
      }
  }
  return [...selected]
    .sort((a, b) => a - b)
    .map((i) => blocks[i])
    .join('\n')
    .slice(0, limit);
}
function extract(html, url, query = '') {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const images = [];
  $('meta[property="og:image"],meta[name="twitter:image"]').each((_, node) => {
    try {
      const target = new URL($(node).attr('content'), url);
      if (target.protocol === 'https:' && !images.some((i) => i.url === target.href))
        images.push({ url: target.href, title, sourceUrl: url });
    } catch {}
  });
  const publishedAt =
    $('meta[property="article:published_time"],meta[name="date"],meta[itemprop="datePublished"]')
      .first()
      .attr('content') ||
    $('time[datetime]').first().attr('datetime') ||
    null;
  const structured = structuredText($);
  $('script,style,noscript,iframe,form,nav,footer,header,aside,svg,[hidden]').remove();
  const main = $('article,main,[role=main]').first();
  const content = main.length && main.text().trim().length >= 100 ? main : $('body');
  const links = [];
  if (query)
    content.find('a[href]').each((_, node) => {
      const target = cleanUrl($(node).attr('href'), url),
        label = $(node).text().trim();
      if (
        !target ||
        !label ||
        /login|sign in|privacy|cookie|subscribe|shop|tickets/i.test(label) ||
        /^(view|talk|edit|archived|quizzes|print)$/i.test(label) ||
        /\/wiki\/(?:Talk|Template_talk|File|Special|Help):/.test(target)
      )
        return;
      const score = relevance({ title: label, url: target }, query);
      if (score > 0)
        links.push({
          id: require('node:crypto').randomUUID(),
          title: label,
          url: target,
          relevance: score,
          source: new URL(target).hostname,
          fetchedAt: Date.now(),
        });
    });
  // Preserve table/section boundaries instead of merging roster names and cells.
  content.find('tr,h1,h2,h3,p,li').append('\n');
  content.find('td,th').each((_, n) => {
    $(n).html($(n).text().replace(/\s+/g, ' ').trim() + ' | ');
  });
  const body = content
    .text()
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
  const text = excerpt(
    body + (structured ? '\nPublic structured page data:\n' + structured : ''),
    query,
    query ? 4500 : 12000,
  );
  return {
    url,
    title,
    text,
    publishedAt,
    images: images.slice(0, 3),
    links: diverse(
      links.sort((a, b) => b.relevance - a.relevance),
      8,
    ),
    untrusted: true,
    fetchedAt: Date.now(),
  };
}
function publicCount(value) {
  if (!/^\d+$/.test(String(value ?? ''))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : null;
}
function watchMetadata(html) {
  const $ = cheerio.load(html);
  let viewCount = null;
  // LikeAction and WatchAction both have userInteractionCount. Only views count.
  $('[itemprop="interactionStatistic"]').each((_, node) => {
    if (/\/WatchAction$/.test($(node).find('[itemprop="interactionType"]').attr('content') || ''))
      viewCount = publicCount($(node).find('[itemprop="userInteractionCount"]').attr('content'));
  });
  return {
    viewCount,
    publishedAt: $('meta[itemprop="datePublished"]').attr('content') || null,
  };
}
class ResearchAgent {
  constructor({ get = webGet } = {}) {
    this.results = new Map();
    this.images = new Map();
    this.imageCache = new Map();
    this.get = get;
  }
  async research(query, signal, topic = 'general', alternatives = []) {
    const deadline = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(22000)])
      : AbortSignal.timeout(22000);
    const found = await this.search(
      topic === 'video' ? query + ' YouTube' : query,
      deadline,
      false,
      alternatives,
    );
    if (!found.success) return found;
    const read = async (items) =>
      Promise.all(
        items.map(async (item) => {
          try {
            const page = await this.page(item.url, deadline, query);
            return {
              ...item,
              ...page,
              text: page.videos?.length
                ? 'Public channel uploads, publication dates and available view counts are listed in videos below. Shorts are identified separately. Counts are snapshots, not guaranteed live.'
                : page.text.slice(0, 4500),
              ...(page.videos ? { videos: page.videos.slice(0, 8) } : {}),
              readable: Boolean(
                page.text && (page.text.length >= 200 || page.video || page.videos?.length),
              ),
            };
          } catch (error) {
            if (signal?.aborted) throw error;
            return {
              ...item,
              readable: false,
              message: 'Source could not be read; this result only has a search snippet.',
            };
          }
        }),
      );
    const fetched = await read(found.results.slice(0, 6));
    // Read up to four useful links discovered inside source pages (including
    // smaller sites linked by an encyclopedia or official page). Never execute JS.
    const seen = new Set(fetched.map((s) => s.url));
    const links = coveringLinks(
      fetched
        .flatMap((s) => s.links || [])
        .filter((l) => !seen.has(l.url))
        .sort((a, b) => b.relevance - a.relevance),
      query,
      4,
    );
    const deeper = deadline.aborted ? [] : await read(links);
    const sources = diverse(
      [
        ...[...deeper, ...fetched].filter((s) => s.readable),
        ...[...fetched, ...deeper].filter((s) => !s.readable),
      ],
      6,
    );
    const { results: _results, ...searchInfo } = found;
    return {
      ...searchInfo,
      // Do not repeat the same search snippets alongside full source observations.
      results: sources.map(({ id, title, url }) => ({ id, title, url })),
      sources,
      message:
        'Background research completed. Answer the user directly with actual source links. Distinguish snippets from read pages. For YouTube, latest regular video and latest Short can differ: identify which you mean using isShort and publishedAt. viewCount is a retrieved public snapshot; fetchedAt is retrieval time, not publication time or a guarantee of live statistics. Missing counts mean unavailable, never zero. For stocks verify company, exchange, currency and quote timestamp; report delayed data honestly. If sources are blocked or incomplete, try another background source or say what could not be verified. Do not open a browser or ask the user to read their screen.',
    };
  }
  async search(query, signal, video = false, alternatives = []) {
    if (!query?.trim()) throw Error('A search phrase is required.');
    signal?.throwIfAborted();
    const found = await searchPublic(
      this.get,
      video ? query + ' YouTube video' : query,
      signal,
      alternatives,
    );
    const results = found.results.filter((r) => !video || videoId(new URL(r.url)));
    for (const result of results) this.results.set(result.id, result);
    while (this.results.size > 72) this.results.delete(this.results.keys().next().value);
    return {
      success: results.length > 0,
      verified: results.length > 0,
      ...found,
      results,
      untrusted: true,
      message: results.length
        ? 'Relevant sources from multiple public indexes are ready. Check source dates before claiming current facts.'
        : 'Public indexes returned no relevant results. Refine the subject or read a known public source; do not substitute unrelated results.',
      retryable: false,
    };
  }
  async page(url, signal, query = '') {
    const parsed = new URL(url),
      id = videoId(parsed);
    if (id) {
      const canonical = 'https://www.youtube.com/watch?v=' + id;
      const [metadata, watch] = await Promise.allSettled([
        this.get(
          'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(canonical),
          signal,
          'application/json',
        ),
        this.get(canonical, signal),
      ]);
      signal?.throwIfAborted();
      if (metadata.status === 'rejected' && watch.status === 'rejected') throw metadata.reason;
      const data = metadata.status === 'fulfilled' ? JSON.parse(metadata.value.html) : {};
      const statistics =
        watch.status === 'fulfilled'
          ? watchMetadata(watch.value.html)
          : { viewCount: null, publishedAt: null };
      const title =
        data.title ||
        (watch.status === 'fulfilled' ? extract(watch.value.html, canonical).title : '');
      return this.registerImages({
        success: Boolean(title),
        verified: Boolean(title),
        url: canonical,
        title,
        text: `${title}${data.author_name ? ' — by ' + data.author_name : ''}. Public video metadata only, not a transcript. ${statistics.viewCount === null ? 'The public view count could not be verified; do not invent one.' : 'Public view-count snapshot: ' + statistics.viewCount + '.'}`,
        ...(statistics.publishedAt ? { publishedAt: statistics.publishedAt } : {}),
        video: { id, title, author: data.author_name, authorUrl: data.author_url, ...statistics },
        images: data.thumbnail_url
          ? [{ url: data.thumbnail_url, title, sourceUrl: canonical }]
          : [],
        fetchedAt: Date.now(),
        untrusted: true,
      });
    }
    const page = await this.get(url, signal);
    const output = { success: true, verified: true, ...extract(page.html, page.url, query) };
    if (
      ['www.youtube.com', 'youtube.com'].includes(parsed.hostname) &&
      /^(?:\/@|\/channel\/)/.test(parsed.pathname)
    ) {
      const channelId =
        page.html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] ||
        page.html.match(/feeds\/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})/)?.[1];
      if (channelId) {
        try {
          const feed = await this.get(
            'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId,
            signal,
          );
          const xml = cheerio.load(feed.html, { xmlMode: true });
          output.videos = xml('entry')
            .toArray()
            .slice(0, 15)
            .map((node) => ({
              title: xml(node).find('title').text(),
              url: xml(node).find('link[rel="alternate"]').attr('href'),
              publishedAt: xml(node).find('published').text(),
              author: xml(node).find('author name').text(),
              isShort: /\/shorts\//.test(
                xml(node).find('link[rel="alternate"]').attr('href') || '',
              ),
              viewCount: publicCount(xml(node).find('media\\:statistics').attr('views')),
              sourceUpdatedAt: xml(node).find('updated').text() || null,
            }))
            .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
          output.statisticsSource =
            feed.url || 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
          output.text = JSON.stringify({
            channel: output.title,
            recentPublicUploads: output.videos,
          });
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
    }
    return this.registerImages(output);
  }
  registerImages(page) {
    const seen = new Set();
    page.images = (page.images || [])
      .filter((item) => {
        if (
          !item.url ||
          seen.has(item.url) ||
          /watermark|\/favicon|\/sprite|\/pixel\b/i.test(item.url) ||
          (item.width && item.width < 200) ||
          (item.height && item.height < 150)
        )
          return false;
        seen.add(item.url);
        return true;
      })
      .slice(0, 3)
      .map((item) => {
        const existing = [...this.images.values()].find(
          (i) => i.url === item.url && i.sourceUrl === item.sourceUrl,
        );
        const image = {
          ...item,
          id: existing?.id || require('node:crypto').randomUUID(),
          registeredAt: Date.now(),
        };
        this.images.set(image.id, image);
        return image;
      });
    while (this.images.size > 60) this.images.delete(this.images.keys().next().value);
    return page;
  }
  restoreImages(sources) {
    for (const source of sources)
      for (const image of source.images || [])
        this.images.set(image.id, { ...image, registeredAt: Date.now() });
    while (this.images.size > 60) this.images.delete(this.images.keys().next().value);
  }
  async image(id, signal) {
    const item = this.images.get(id);
    if (!item || Date.now() - item.registeredAt > 1800000)
      throw Error('Image source expired. Research again.');
    const cached = this.imageCache.get(id);
    if (cached) return cached;
    const response = await webGet(
      item.url,
      signal,
      'image/png,image/jpeg,image/webp,image/gif,image/avif',
      true,
    );
    const result = {
      dataUrl: 'data:' + response.mime + ';base64,' + response.data.toString('base64'),
      sourceUrl: item.sourceUrl,
      title: item.title,
    };
    this.imageCache.set(id, result);
    while (this.imageCache.size > 12) this.imageCache.delete(this.imageCache.keys().next().value);
    return result;
  }
  selected(id) {
    const item = this.results.get(id);
    if (!item || Date.now() - item.fetchedAt > 600000)
      throw Error('Search result expired. Search again.');
    return item;
  }
}
function videoId(url) {
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(?:shorts|embed)\//.test(url.pathname)) id = url.pathname.split('/')[2];
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
}
module.exports = {
  ResearchAgent,
  extract,
  publicAddress,
  webGet,
  videoId,
  publicCount,
  watchMetadata,
  excerpt,
};
