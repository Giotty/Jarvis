type Playback = { done: Promise<void>; stop: () => void };
type Options = {
  synthesize: (text: string) => Promise<string>;
  play: (audio: string) => Playback;
  state: (speaking: boolean) => void;
  error: (error: unknown) => void;
  complete?: () => void;
};
// One current chunk and one look-ahead chunk. No whole-reply synthesis wait,
// and an interruption cannot play audio from an older generation.
export class SpeechPlayback {
  private generation = 0;
  private pumpToken: number | null = null;
  private queue: string[] = [];
  private pending = '';
  private next: { generation: number; result: Promise<string> } | null = null;
  private playback: Playback | null = null;
  private ended = false;
  speaking = false;
  constructor(private options: Options) {}
  stop() {
    this.generation++;
    this.ended = false;
    this.queue = [];
    this.pending = '';
    this.next = null;
    this.pumpToken = null;
    this.playback?.stop();
    this.playback = null;
    this.speaking = false;
    this.options.state(false);
  }
  begin() {
    this.stop();
  }
  append(text: string) {
    this.pending += text;
    this.flush(false);
  }
  finish() {
    this.ended = true;
    this.flush(true);
  }
  speak(text: string) {
    this.begin();
    this.append(text.slice(0, 2000));
    this.finish();
  }
  private flush(final: boolean) {
    while (this.pending.trim()) {
      const sentence = this.pending.match(/^\s*[\s\S]{1,130}?[.!?](?:\s|$)/);
      let end = sentence?.[0].length || 0;
      if (!end && this.pending.length >= 120) end = this.pending.lastIndexOf(' ', 120) + 1 || 120;
      if (!end && final) end = this.pending.length;
      if (!end) break;
      const chunk = this.pending.slice(0, end).trim();
      this.pending = this.pending.slice(end);
      if (chunk) this.queue.push(chunk);
    }
    if (this.playback) this.prepare();
    void this.pump();
  }
  private prepare() {
    if (!this.next && this.queue.length) {
      const result = this.options.synthesize(this.queue.shift()!);
      // The next chunk may finish or fail during playback. Keep rejections
      // handled until the pump consumes the result.
      void result.catch(() => {});
      this.next = { generation: this.generation, result };
    }
  }
  private async pump() {
    const token = this.generation;
    if (this.pumpToken === token) return;
    this.pumpToken = token;
    let failed = false;
    try {
      while (token === this.generation) {
        this.prepare();
        const next = this.next;
        if (!next) break;
        this.next = null;
        const audio = await next.result;
        if (token !== this.generation || next.generation !== token) return;
        const playback = this.options.play(audio);
        this.playback = playback;
        this.speaking = true;
        this.options.state(true);
        this.prepare();
        await playback.done;
        if (token !== this.generation) return;
        this.playback = null;
      }
    } catch (error) {
      failed = true;
      if (token === this.generation) this.options.error(error);
    } finally {
      if (token === this.generation) {
        this.pumpToken = null;
        this.speaking = false;
        this.options.state(false);
        if (!failed && this.ended && !this.queue.length && !this.pending.trim()) {
          this.ended = false;
          this.options.complete?.();
        }
      }
    }
  }
}
