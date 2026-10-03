const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
function waitFor(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || Error('Cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
class OllamaService {
  constructor({
    fetcher = fetch,
    exists = fs.existsSync,
    launcher,
    platform = process.platform,
    environment = process.env,
    timeout = 12000,
    delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {}) {
    Object.assign(this, { fetcher, exists, platform, environment, timeout, delay });
    this.pending = new Map();
    this.launcher =
      launcher ||
      ((exe) =>
        new Promise((resolve, reject) => {
          const child = spawn(exe, ['serve'], {
            windowsHide: true,
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
          });
          child.once('error', reject);
          child.once('spawn', () => {
            child.unref();
            resolve();
          });
        }));
  }
  async ensure(base, signal) {
    signal?.throwIfAborted();
    let url;
    try {
      url = new URL(base);
    } catch {
      return false;
    }
    // Only start the already installed default local service, never arbitrary endpoints/binaries.
    if (
      this.platform !== 'win32' ||
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.port !== '11434' ||
      url.username ||
      url.password ||
      !['', '/'].includes(url.pathname) ||
      url.search ||
      url.hash
    )
      return false;
    const key = url.origin;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.start(key).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return waitFor(pending, signal);
  }
  async probe(base) {
    try {
      return (await this.fetcher(base + '/api/version', { signal: AbortSignal.timeout(800) })).ok;
    } catch {
      return false;
    }
  }
  async start(base) {
    if (await this.probe(base)) return true;
    const roots = [
      this.environment.LOCALAPPDATA &&
        path.join(this.environment.LOCALAPPDATA, 'Programs', 'Ollama'),
      this.environment.ProgramFiles && path.join(this.environment.ProgramFiles, 'Ollama'),
    ].filter(Boolean);
    const exe = roots.map((root) => path.join(root, 'ollama.exe')).find(this.exists);
    if (!exe) return false;
    await this.launcher(exe);
    const end = Date.now() + this.timeout;
    do {
      if (await this.probe(base)) return true;
      await this.delay(150);
    } while (Date.now() < end);
    return false;
  }
}
module.exports = { OllamaService };
