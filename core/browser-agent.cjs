function matchesUrl(expected, observed) {
  try {
    const a = new URL(expected),
      b = new URL(observed.includes('://') ? observed : 'https://' + observed);
    if (a.hostname.replace(/^www\./, '') !== b.hostname.replace(/^www\./, '')) return false;
    if (a.pathname.replace(/\/$/, '') !== b.pathname.replace(/\/$/, '')) return false;
    return [...a.searchParams].every(([k, v]) => b.searchParams.get(k) === v);
  } catch {
    return false;
  }
}
function websiteName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the website';
  }
}
class BrowserAgent {
  constructor({ native, openExternal, config, emit }) {
    Object.assign(this, { native, openExternal, config, emit });
    this.last = { windows: [], observedAt: 0 };
  }
  async state(signal) {
    this.last = await this.native('browser_state', {}, signal);
    this.emit('browser-state', this.last);
    return this.last;
  }
  async verify(url, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      if (attempt) await new Promise((r) => setTimeout(r, 650));
      const current = await this.state(signal);
      const match = current.windows.find((w) => matchesUrl(url, w.url));
      if (match) {
        if (!match.foreground) {
          await this.native('focus_browser', { hwnd: match.hwnd }, signal);
          const fresh = await this.state(signal);
          const visible = fresh.windows.find((w) => w.foreground && matchesUrl(url, w.url));
          if (visible) return { verified: true, observed_result: visible };
        } else return { verified: true, observed_result: match };
      }
    }
    return { verified: false, observed_result: this.last };
  }
  async open(url, signal, newTab = false) {
    const destination = new URL(url);
    if (
      !['http:', 'https:'].includes(destination.protocol) ||
      destination.username ||
      destination.password
    )
      throw Error('Unsupported browser destination.');
    let observation = { verified: false, observed_result: null };
    for (let method = 0; method < 2; method++) {
      signal?.throwIfAborted();
      try {
        if (!method && !newTab) await this.openExternal(url);
        else {
          if (!this.config().keyboard) break;
          this.emit('progress', 'Trying another way to open the page.');
          await this.native('browser_navigate', { url, newTab }, signal);
        }
        observation = await this.verify(url, signal);
        if (observation.verified)
          return {
            success: true,
            ...observation,
            url,
            attempts: method + 1,
            message: `${websiteName(url)} is open.`,
          };
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    return {
      success: false,
      ...observation,
      url,
      error: 'browser_navigation_unverified',
      retryable: false,
      message: `I couldn’t confirm ${websiteName(url)} opened. Something may be blocking the browser.`,
    };
  }
  async control(action, index, signal) {
    signal?.throwIfAborted();
    const before = await this.state(signal);
    const result = await this.native('browser_control', { action, index }, signal);
    this.last = result.observed_result || (await this.state(signal));
    this.emit('browser-state', this.last);
    const changed =
      JSON.stringify(before.windows.map((w) => [w.title, w.url])) !==
      JSON.stringify(this.last.windows.map((w) => [w.title, w.url]));
    return {
      success: true,
      verified: changed,
      observed_result: this.last,
      message: changed ? 'Done.' : 'I tried that, but couldn’t confirm the page changed.',
    };
  }
}
module.exports = { BrowserAgent, matchesUrl };
