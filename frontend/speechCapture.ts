export type SpeechFrame = {
  onset: boolean;
  preview?: Float32Array[];
  final?: Float32Array[];
  level: number;
};
// Durations follow audio samples even while the HUD is hidden. Silence never
// reaches Whisper. The detector continues during transcription and replies.
export class SpeechCapture {
  private pre: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private speech = 0;
  private quiet = 0;
  private duration = 0;
  private noise = 0.003;
  private previewed = false;
  active = false;
  constructor(readonly rate: number) {}
  finish(): Float32Array[] | undefined {
    const result = this.active ? this.frames : undefined;
    this.frames = [];
    this.pre = [];
    this.active = false;
    this.speech = this.quiet = this.duration = 0;
    this.previewed = false;
    return result;
  }
  push(frame: Float32Array, automatic: boolean): SpeechFrame {
    const ms = (frame.length / this.rate) * 1000;
    const rms = Math.sqrt(frame.reduce((sum, x) => sum + x * x, 0) / frame.length);
    const loud = rms > Math.max(0.009, this.noise * 2.8);
    const result: SpeechFrame = { onset: false, level: Math.min(1, rms * 8) };
    if (!this.active) {
      if (!loud) this.noise = this.noise * 0.98 + Math.min(rms, 0.01) * 0.02;
      this.pre.push(frame);
      while (this.pre.length * ms > 350) this.pre.shift();
      this.speech = loud ? this.speech + ms : Math.max(0, this.speech - ms);
      if (this.speech < 140) return result;
      this.active = true;
      this.frames = this.pre;
      this.pre = [];
      result.onset = true;
    } else this.frames.push(frame);
    this.duration += ms;
    this.quiet = loud ? 0 : this.quiet + ms;
    if (!this.previewed && this.duration >= 2000 && this.quiet < 200) {
      this.previewed = true;
      result.preview = this.frames.slice();
    }
    if (this.duration >= 25000 || (automatic && this.quiet >= 800)) result.final = this.finish();
    return result;
  }
}
export function wavBase64(frames: Float32Array[], rate: number): string {
  const count = frames.reduce((total, frame) => total + frame.length, 0);
  const buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const label = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  label(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const frame of frames)
    for (const sample of frame) {
      view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true);
      offset += 2;
    }
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
