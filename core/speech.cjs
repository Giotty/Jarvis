const { spawn } = require('node:child_process');
class SpeechWorker {
  constructor(config, script) {
    this.config = config;
    this.script = script;
    this.child = null;
    this.pending = null;
    this.buffer = '';
    this.executable = '';
  }
  stop() {
    this.child?.kill();
    this.child = null;
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
    child.stdin.on('error', () => this.stop());
    child.on('error', () => this.stop());
    child.on('exit', () => {
      if (this.child === child) this.stop();
    });
  }
  transcribe(audio) {
    if (this.pending) return Promise.reject(Error('Speech recognition is busy.'));
    this.start();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.stop(), 180000) };
      this.child.stdin.write(
        JSON.stringify({
          audio,
          model: this.config().sttModel,
          modelPath: this.config().sttModelPath,
        }) + '\n',
      );
    });
  }
}
module.exports = { SpeechWorker };
