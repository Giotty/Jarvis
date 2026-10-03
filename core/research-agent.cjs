const cheerio = require('cheerio');
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
function extract(html, url) {
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
  $('script,style,noscript,iframe,form,nav,footer,header,aside,svg,[hidden]').remove();
  const main = $('article,main,[role=main]').first();
  const text = (main.length ? main : $('body')).text().replace(/\s+/g, ' ').trim().slice(0, 12000);
  return {
    url,
    title,
    text,
    publishedAt,
    images: images.slice(0, 3),
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
  async research(query, signal, topic = 'general') {
    const found = await this.search(topic === 'video' ? query + ' YouTube' : query, signal);
    if (!found.success) return found;
    const read = async (items) =>
      Promise.all(
        items.map(async (item) => {
          try {
            const page = await this.page(item.url, signal);
            return {
              ...item,
              ...page,
              text: page.videos?.length
                ? 'Public channel uploads, publication dates and available view counts are listed in videos below. Shorts are identified separately. Counts are snapshots, not guaranteed live.'
                : page.text.slice(0, 3000),
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
    const sources = [
      ...fetched.filter((s) => s.readable),
      ...fetched.filter((s) => !s.readable),
    ].slice(0, 3);
    return {
      ...found,
      // Do not repeat the same search snippets alongside full source observations.
      results: sources.map(({ id, title, url }) => ({ id, title, url })),
      sources,
      message:
        'Background research completed. Answer the user directly with actual source links. Distinguish snippets from read pages. For YouTube, latest regular video and latest Short can differ: identify which you mean using isShort and publishedAt. viewCount is a retrieved public snapshot; fetchedAt is retrieval time, not publication time or a guarantee of live statistics. Missing counts mean unavailable, never zero. For stocks verify company, exchange, currency and quote timestamp; report delayed data honestly. If sources are blocked or incomplete, try another background source or say what could not be verified. Do not open a browser or ask the user to read their screen.',
    };
  }
  async search(query, signal, video = false) {
    if (!query?.trim()) throw Error('A search phrase is required.');
    const phrase = video ? query + ' YouTube video' : query;
    let page;
    try {
      page = await this.get(
        'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(phrase),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      page = { html: '', url: 'https://html.duckduckgo.com/' };
    }
    const $ = cheerio.load(page.html);
    const results = [];
    $('.result').each((_, node) => {
      const link = $(node).find('.result__a').first();
      let target;
      try {
        const raw = new URL(link.attr('href'), page.url);
        target = new URL(raw.searchParams.get('uddg') || raw.href);
      } catch {
        return;
      }
      if (
        !['http:', 'https:'].includes(target.protocol) ||
        target.hostname.endsWith('duckduckgo.com')
      )
        return;
      if (video && !videoId(target)) return;
      const title = link.text().trim();
      if (!title || results.some((r) => r.url === target.href)) return;
      const item = {
        id: require('node:crypto').randomUUID(),
        title,
        url: target.href,
        snippet: $(node).find('.result__snippet').text().trim().slice(0, 600),
        source: target.hostname,
        fetchedAt: Date.now(),
      };
      results.push(item);
    });
    if (!results.length) {
      const alternate = await this.get(
        'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(phrase),
        signal,
      );
      const xml = cheerio.load(alternate.html, { xmlMode: true });
      xml('item')
        .slice(0, 6)
        .each((_, node) => {
          const url = xml(node).find('link').text().trim(),
            title = xml(node).find('title').text().trim();
          try {
            const parsed = new URL(url);
            if (!['https:', 'http:'].includes(parsed.protocol) || !title) return;
            if (video && !videoId(parsed)) return;
            results.push({
              id: require('node:crypto').randomUUID(),
              title,
              url,
              snippet: xml(node).find('description').text().trim().slice(0, 600),
              source: parsed.hostname,
              fetchedAt: Date.now(),
            });
          } catch {}
        });
    }
    for (const item of results.slice(0, 6)) this.results.set(item.id, item);
    while (this.results.size > 36) this.results.delete(this.results.keys().next().value);
    return {
      success: results.length > 0,
      verified: results.length > 0,
      results: results.slice(0, 6),
      untrusted: true,
      message: results.length
        ? 'Search results are ready. Check the sources before relying on their claims.'
        : 'The free search provider returned no readable results. Try a different search or give me a link.',
      retryable: false,
    };
  }
  async page(url, signal) {
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
    const output = { success: true, verified: true, ...extract(page.html, page.url) };
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
    page.images = (page.images || []).map((item) => {
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
};
