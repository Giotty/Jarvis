const cheerio = require('cheerio');
const dns = require('node:dns/promises');
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
    !(a === 100 && b >= 64 && b <= 127)
  );
}
async function webGet(input, signal) {
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
    const response = await fetch(url, {
      redirect: 'manual',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 JARVIS-Research/1.0',
        Accept: 'text/html,application/xhtml+xml,application/rss+xml,text/plain',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.get('location')) throw Error('Incomplete page redirect.');
      url = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw Error(`Research page returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (!/text|html|xml/.test(contentType)) {
      await response.body?.cancel();
      throw Error('This page is not readable web text.');
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2000000) {
        await response.body.cancel().catch(() => {});
        throw Error('Page exceeds the text extraction limit.');
      }
      chunks.push(chunk);
    }
    return { url: url.href, html: Buffer.concat(chunks).toString('utf8') };
  }
  throw Error('Too many page redirects.');
}
function extract(html, url) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  $('script,style,noscript,iframe,form,nav,footer,header,aside,svg,[hidden]').remove();
  const main = $('article,main,[role=main]').first();
  const text = (main.length ? main : $('body')).text().replace(/\s+/g, ' ').trim().slice(0, 12000);
  return { url, title, text, untrusted: true, fetchedAt: Date.now() };
}
class ResearchAgent {
  constructor() {
    this.results = new Map();
  }
  async search(query, signal, video = false) {
    if (!query?.trim()) throw Error('A search phrase is required.');
    const phrase = video ? query + ' site:youtube.com/watch' : query;
    let page;
    try {
      page = await webGet(
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
      const alternate = await webGet(
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
    const page = await webGet(url, signal);
    return { success: true, verified: true, ...extract(page.html, page.url) };
  }
  selected(id) {
    const item = this.results.get(id);
    if (!item || Date.now() - item.fetchedAt > 600000)
      throw Error('Search result expired. Search again.');
    return item;
  }
}
module.exports = { ResearchAgent, extract, publicAddress };
