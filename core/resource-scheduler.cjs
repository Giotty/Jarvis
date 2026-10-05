// Heavy local work is serialized; cloud planning/review never holds a lease.
class ResourceScheduler {
  constructor({ emit = () => {}, pauseBackground = () => {} } = {}) {
    Object.assign(this, { emit, pauseBackground });
    this.tail = Promise.resolve();
    this.active = null;
  }
  async acquire(label, signal) {
    signal?.throwIfAborted();
    let release;
    const ticket = new Promise((resolve) => {
        release = resolve;
      }),
      previous = this.tail;
    this.tail = previous.catch(() => {}).then(() => ticket);
    try {
      await new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal?.addEventListener('abort', aborted, { once: true });
        previous.finally(() => {
          signal?.removeEventListener('abort', aborted);
          resolve();
        });
        if (signal?.aborted) aborted();
      });
      signal?.throwIfAborted();
    } catch (error) {
      release();
      throw error;
    }
    this.active = label;
    this.pauseBackground();
    this.emit('resource-state', { busy: true, label });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active = null;
      this.emit('resource-state', { busy: false, label });
      release();
    };
  }
}
module.exports = { ResourceScheduler };
