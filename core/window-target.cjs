// Restore the assistant even when an input worker or vision lookup fails.
function targetWindow(getWindow, delay = () => new Promise((r) => setTimeout(r, 250)), prepare) {
  let depth = 0;
  let restore = false;
  return async (action, { focus = true } = {}) => {
    const win = getWindow();
    if (depth++ === 0) {
      restore = Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
      if (restore) win.hide();
    }
    try {
      if (restore) await delay();
      if (depth === 1 && focus) await prepare?.();
      return await action();
    } finally {
      if (--depth === 0 && restore && win && !win.isDestroyed()) {
        restore = false;
        win.showInactive();
      }
    }
  };
}
module.exports = { targetWindow };
