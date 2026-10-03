const fs = require('node:fs');
const path = require('node:path');
const { ProviderError } = require('./base.cjs');
const localDay = (d) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
const localReset = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
class GeminiBudget {
  constructor({ config, directory, clock = () => new Date(), emit = () => {} }) {
    Object.assign(this, { config, clock, emit });
    this.file = directory ? path.join(directory, 'gemini-budget.json') : null;
    this.data = { day: '', used: 0, warned: false, blockedUntil: 0, blockReason: '' };
    if (this.file) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (
          typeof data.day !== 'string' ||
          !Number.isSafeInteger(data.used) ||
          data.used < 0 ||
          !Number.isFinite(data.blockedUntil || 0)
        )
          throw Error('Invalid ledger');
        this.data = {
          ...this.data,
          day: data.day,
          used: data.used,
          warned: data.warned === true,
          blockedUntil: data.blockedUntil || 0,
          blockReason: data.blockReason === 'google_rate_limit' ? 'google_rate_limit' : '',
        };
      } catch (e) {
        // A damaged ledger must not silently reset a budget and spend more requests.
        if (e.code !== 'ENOENT')
          this.data = {
            ...this.data,
            day: localDay(this.clock()),
            used: this.cap(),
            blockReason: 'ledger_unavailable',
          };
      }
    }
  }
  cap() {
    return this.config().geminiDailyCap || 100;
  }
  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch {
      this.data.blockReason = 'ledger_unavailable';
      throw new ProviderError('gemini_budget_storage', false);
    }
  }
  snapshot() {
    const now = this.clock(),
      day = localDay(now);
    if (day !== this.data.day) {
      this.data = {
        ...this.data,
        day,
        used: 0,
        warned: false,
        blockReason: this.data.blockReason === 'ledger_unavailable' ? '' : this.data.blockReason,
      };
      this.save();
    }
    const cap = this.cap(),
      used = this.data.used,
      remoteBlocked = this.data.blockedUntil > now.getTime();
    return {
      day,
      used,
      cap,
      remaining: Math.max(0, cap - used),
      percent: Math.min(100, Math.floor((used / cap) * 100)),
      warning: used >= Math.ceil(cap * 0.8),
      limited: used >= cap || remoteBlocked || this.data.blockReason === 'ledger_unavailable',
      reason:
        used >= cap
          ? 'daily_budget'
          : remoteBlocked
            ? this.data.blockReason
            : this.data.blockReason === 'ledger_unavailable'
              ? 'ledger_unavailable'
              : '',
      resetAt: localReset(now),
      retryAt: remoteBlocked ? this.data.blockedUntil : null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  notify() {
    const state = this.snapshot();
    this.emit('gemini-budget', state);
    if (state.warning && !this.data.warned) {
      this.data.warned = true;
      this.save();
      this.emit(
        'progress',
        `Gemini has used ${state.used} / ${state.cap} of JARVIS's daily request budget. Ollama takes over at the cap.`,
      );
    }
    return state;
  }
  take(signal) {
    signal?.throwIfAborted();
    if (this.snapshot().limited) {
      this.notify();
      throw new ProviderError('gemini_budget', false);
    }
    // Reserve synchronously BEFORE fetch so parallel tool/planner calls cannot overspend.
    this.data.used++;
    this.save();
    const state = this.notify();
    if (state.used === state.cap)
      this.emit(
        'progress',
        'JARVIS’s Gemini daily budget is reached. Further AI requests will use Ollama until the local daily reset.',
      );
    return state;
  }
  async rateLimited(response) {
    let seconds = 60;
    try {
      const body = await response.json();
      const delay = body.error?.details?.find((d) =>
        String(d['@type']).endsWith('/google.rpc.RetryInfo'),
      )?.retryDelay;
      if (/^\d+(?:\.\d+)?s$/.test(delay || ''))
        seconds = Math.min(86400, Math.max(1, Number(delay.slice(0, -1))));
      if (
        body.error?.details?.some((d) =>
          d.violations?.some((v) => /perday|daily/i.test(v.quotaId || v.quotaMetric || '')),
        )
      )
        seconds = Math.max(seconds, 3600);
    } catch {
      /* No server message/key is persisted or displayed. */
    }
    this.data.blockedUntil = this.clock().getTime() + seconds * 1000;
    this.data.blockReason = 'google_rate_limit';
    this.save();
    this.notify();
    this.emit(
      'progress',
      'Google has rate-limited Gemini. JARVIS is using Ollama; your local daily budget is separate.',
    );
  }
}
module.exports = { GeminiBudget, localDay, localReset };
