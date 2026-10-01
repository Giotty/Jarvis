class JarvisCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1024);
    this.used = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const input = inputs[0]?.[0];
    if (input)
      for (const sample of input) {
        this.buffer[this.used++] = sample;
        if (this.used === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(1024);
          this.used = 0;
        }
      }
    return true;
  }
}
registerProcessor('jarvis-capture', JarvisCapture);
