// Explicit developer check; never included in the automatic unit test suite.
const path = require('node:path');
const assert = require('node:assert/strict');
const { pythonCall } = require('../core/tools.cjs');
const { ScreenTargets } = require('../core/screen-targets.cjs');
const { findControl } = require('../core/control-matching.cjs');
const { ordinaryNavigation } = require('../core/navigation-safety.cjs');
const root = path.resolve(__dirname, '..');
const config = { pythonPath: path.join(root, '.venv', 'Scripts', 'python.exe') };
const worker = path.join(root, 'voice', 'automation.py');
const probe = path.join(root, 'tests', 'fixtures', 'desktop-probe.py');
const native = (tool, args = {}) => pythonCall(config, worker, { tool, args });
async function window() {
  const value = await native('get_foreground_window');
  assert.equal(
    value.title,
    'JARVIS control sandbox',
    'Only the disposable sandbox may be targeted',
  );
  return value;
}
async function check() {
  let sandbox;
  for (let attempt = 0; attempt < 10; attempt++) {
    sandbox = (await native('list_windows')).windows.find(
      (w) => w.title === 'JARVIS control sandbox',
    );
    if (sandbox) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(sandbox, 'Start the disposable control sandbox first');
  await native('focus_application', { name: sandbox.title });
  const targets = new ScreenTargets({
    withTarget: (fn) => fn(),
    window,
    capture: async () => {
      const frame = await pythonCall(config, probe, {});
      return { ...frame, pixels: Buffer.from(frame.pixels, 'base64') };
    },
    fingerprint: (frame) => frame.pixels,
    locate: async (label) => {
      await window();
      const found = findControl(label, (await native('list_ui_elements')).elements);
      assert.ok(found, 'No unique observed control');
      return found;
    },
    click: async (args) => {
      await window();
      return native('click_verified', args);
    },
  });
  const results = [];
  try {
    for (const label of ['Collections', 'Library']) {
      const started = Date.now();
      const review = await targets.prepare(label);
      const proof = targets.pending.get(review.id);
      assert.equal(ordinaryNavigation(proof.control, proof.window), true);
      const result = await targets.execute(review);
      assert.equal(result.success, true);
      assert.equal(result.verified, true);
      results.push({
        label,
        verified: result.verified,
        method: result.observed_result.activation?.method,
        milliseconds: Date.now() - started,
      });
    }
  } finally {
    await pythonCall(config, probe, { operation: 'close' }).catch(() => {});
  }
  if (process.argv.includes('--audio')) {
    const before = (await native('get_audio_state')).observed_result;
    try {
      const result = await native('set_volume', {
        action: before.volume >= 1 ? 'lower' : 'raise',
        percent: 1,
      });
      assert.equal(result.verified, true);
      results.push({
        volumeVerified: true,
        before: before.volume,
        after: result.observed_result.volume,
      });
    } finally {
      const restored = await native('set_volume', { action: 'set', percent: before.volume });
      assert.equal(restored.verified, true);
      assert.equal(restored.observed_result.muted, before.muted);
    }
  }
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}
check().catch((error) => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
