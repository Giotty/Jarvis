const fs = require('node:fs'),
  path = require('node:path');
const { ProviderError } = require('./base.cjs'),
  { localDay, localReset } = require('./gemini-budget.cjs');
class HostedBudget {
  constructor({ directory, config, clock = () => new Date(), emit = () => {} }) {
    Object.assign(this, { config, clock, emit });
    this.file = directory && path.join(directory, 'nvidia-budget.json');
    this.data = { day: localDay(clock()), used: 0 };
    if (this.file) {
      try {
        const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!Number.isSafeInteger(d.used) || d.used < 0 || typeof d.day !== 'string')
          throw Error('Invalid');
        this.data = { day: d.day, used: d.used };
      } catch (e) {
        if (e.code !== 'ENOENT') this.data.used = config().nvidiaDailyCap || 100;
      }
    }
  }
  save() {
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
        fs.renameSync(this.file + '.tmp', this.file);
      } catch {
        throw new ProviderError('budget_storage', false);
      }
    }
  }
  snapshot() {
    const now = this.clock();
    if (this.file) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (saved.day === localDay(now) && Number.isSafeInteger(saved.used) && saved.used >= 0)
          this.data = {
            day: saved.day,
            used: Math.max(this.data.day === saved.day ? this.data.used : 0, saved.used),
          };
      } catch {
        /* take() fails closed if the persisted ledger is invalid. */
      }
    }
    if (this.data.day !== localDay(now)) {
      this.data = { day: localDay(now), used: 0 };
    }
    const cap = this.config().nvidiaDailyCap || 100;
    return { ...this.data, cap, limited: this.data.used >= cap, resetAt: localReset(now) };
  }
  take(signal) {
    signal?.throwIfAborted();
    let lock;
    try {
      if (this.file) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        lock = fs.openSync(this.file + '.lock', 'wx');
        try {
          const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
          if (!Number.isSafeInteger(saved.used) || saved.used < 0 || typeof saved.day !== 'string')
            throw Error('Invalid budget');
          if (saved.day === localDay(this.clock()))
            this.data = {
              day: saved.day,
              used: Math.max(saved.used, this.data.day === saved.day ? this.data.used : 0),
            };
        } catch (e) {
          if (e.code !== 'ENOENT') throw new ProviderError('budget_storage', false);
        }
      }
      if (this.snapshot().limited) throw new ProviderError('daily_budget', false);
      this.data.used++;
      this.save();
      this.emit('provider-budget', { provider: 'nvidia', ...this.snapshot() });
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError('budget_storage', false);
    } finally {
      if (lock !== undefined) {
        fs.closeSync(lock);
        fs.unlinkSync(this.file + '.lock');
      }
    }
  }
}
module.exports = { HostedBudget };
