const { spawn, execFile } = require('node:child_process');
class SpeechWorker {
  constructor(config, script) {
    this.config = config;
    this.script = script;
    this.child = null;
    this.pending = null;
    this.buffer = '';
    this.executable = '';
    this.prepared = null;
    this.epoch = 0;
    this.queue = Promise.resolve();
  }
  stop() {
    this.epoch++;
    if (this.child) {
      const child = this.child;
      if (process.platform === 'win32' && child.pid && child.exitCode === null)
        execFile(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => {},
        );
      else child.kill();
    }
    this.child = null;
    this.prepared = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error('Speech worker stopped.'));
      this.pending = null;
    }
  }
  start() {
    const c = this.config();
    if (this.child && this.executable === c.pythonPath) return;
    this.stop();
    this.executable = c.pythonPath;
    const child = spawn(c.pythonPath, [this.script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.buffer = '';
    child.stdout.on('data', (data) => {
      if (this.child !== child) return;
      this.buffer += data;
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      clearTimeout(p.timer);
      try {
        const result = JSON.parse(line);
        result.error ? p.reject(Error(result.error)) : p.resolve(result);
      } catch {
        p.reject(Error('Invalid speech response.'));
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {
      if (this.child === child) this.stop();
    });
    child.on('error', () => {
      if (this.child === child) this.stop();
    });
    child.on('exit', () => {
      if (this.child === child) this.stop();
    });
  }
  request(payload) {
    if (this.pending) return Promise.reject(Error('Local voice worker is still processing.'));
    this.start();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.stop(), 180000) };
      this.child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }
  settings() {
    const c = this.config();
    return {
      model: c.sttModel,
      modelPath: c.sttModelPath,
      language: c.sttLanguage,
      device: c.sttDevice,
    };
  }
  prepare(payload = this.settings()) {
    if (!this.prepared) this.prepared = this.request({ ...payload, operation: 'prepare' });
    return this.prepared;
  }
  async transcribe(audio) {
    if (this.prepared) await this.prepared;
    return this.request({ audio, ...this.settings() });
  }
  async synthesize(text, payload) {
    // Barge-in discards playback, not this warmed model. Serialize requests
    // so a new reply can safely follow synthesis that was already in progress.
    if (!this.child) this.start();
    const epoch = this.epoch;
    const result = this.queue
      .catch(() => {})
      .then(async () => {
        if (epoch !== this.epoch) throw Error('Speech request cancelled.');
        await this.prepare(payload);
        if (epoch !== this.epoch) throw Error('Speech request cancelled.');
        return this.request({ text, ...payload });
      });
    this.queue = result.catch(() => {});
    return result;
  }
}
module.exports = { SpeechWorker };
