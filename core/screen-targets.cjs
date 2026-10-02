const crypto = require('node:crypto');
function sameWindow(a, b) {
  return (
    a.hwnd > 0 &&
    a.hwnd === b.hwnd &&
    a.pid === b.pid &&
    a.title === b.title &&
    ['x', 'y', 'width', 'height'].every((k) => a.bounds[k] === b.bounds[k])
  );
}
function inside(point, bounds) {
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x < bounds.x + bounds.width &&
    point.y < bounds.y + bounds.height
  );
}
function changed(a, b) {
  if (!a.length || a.length !== b.length) return true;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
  return difference / (255 * a.length) > 0.045;
}
// Keep image proofs in memory only. The approval binds the observed target and
// window; it never authorizes fresh model-generated coordinates after approval.
class ScreenTargets {
  constructor({ withTarget, window, capture, locate, fingerprint, click }) {
    Object.assign(this, { withTarget, window, capture, locate, fingerprint, click });
    this.pending = new Map();
  }
  async prepare(label, signal, known) {
    return this.withTarget(async () => {
      signal?.throwIfAborted();
      const window = await this.window();
      if (known && !sameWindow(known.window, window))
        throw Error('The foreground window changed. Observe again.');
      const frame = await this.capture(window);
      const located = known?.control || (await this.locate(label, frame, signal));
      signal?.throwIfAborted();
      if (
        !sameWindow(window, await this.window()) ||
        !inside(located, window.bounds) ||
        !inside(located, frame.bounds)
      )
        throw Error('The visible target moved or is outside the foreground window. Ask again.');
      const review = {
        id: crypto.randomUUID(),
        label: located.label || label,
        windowTitle: window.title,
        x: located.x,
        y: located.y,
      };
      this.pending.set(review.id, {
        review,
        window,
        control: located,
        fingerprint: this.fingerprint(frame, located),
        expires: Date.now() + 60000,
      });
      while (this.pending.size > 4) this.pending.delete(this.pending.keys().next().value);
      return review;
    });
  }
  async execute(review, signal) {
    const target = this.pending.get(review.id);
    this.pending.delete(review.id);
    if (
      !target ||
      target.expires < Date.now() ||
      JSON.stringify(target.review) !== JSON.stringify(review)
    )
      throw Error('The observed target expired or changed. Ask again.');
    return this.withTarget(async () => {
      signal?.throwIfAborted();
      if (!sameWindow(target.window, await this.window()))
        throw Error('The foreground window changed. No click was performed; ask again.');
      const frame = await this.capture(target.window);
      if (changed(target.fingerprint, this.fingerprint(frame, review)))
        throw Error('The target appearance changed. No click was performed; ask again.');
      signal?.throwIfAborted();
      const result = await this.click(
        { x: review.x, y: review.y, window: target.window, control: target.control },
        signal,
      );
      try {
        await new Promise((r) => setTimeout(r, 300));
        const afterWindow = await this.window();
        const afterFrame = result.verified ? null : await this.capture(afterWindow);
        const visiblyChanged =
          !sameWindow(target.window, afterWindow) ||
          result.verified === true ||
          (frame.pixels && afterFrame?.pixels
            ? changed(frame.pixels, afterFrame.pixels)
            : changed(target.fingerprint, this.fingerprint(afterFrame, review)));
        return {
          ...result,
          success: true,
          verified: visiblyChanged,
          observed_result: {
            window: afterWindow,
            screenChanged: visiblyChanged,
            activation: result.observed_result,
          },
          message: visiblyChanged
            ? `Clicked ${review.label}.`
            : `I clicked ${review.label}, but couldn’t confirm the screen changed.`,
        };
      } catch {
        return {
          ...result,
          success: true,
          verified: false,
          retryable: false,
          message: `I clicked ${review.label}, but couldn’t check the resulting screen.`,
        };
      }
    });
  }
}
module.exports = { ScreenTargets, sameWindow, changed };
