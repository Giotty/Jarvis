const fs = require('node:fs');
const path = require('node:path');
async function smoke(win, directory) {
  // Smoke mode uses isolated user data. Never overwrite real account credentials.
  const checks = await win.webContents.executeJavaScript(`(async () => {
    const api = window.jarvis, plugins = await api.plugins(), snapshot = await api.snapshot();
    return { plugins: plugins.ok && plugins.data.length >= 10,
      schemas: plugins.ok && plugins.data.every(p => p.tools.every(t => t.inputSchema)),
      finiteBridge: !!api && typeof require === 'undefined',
      snapshot: snapshot.ok, reactor: !!document.querySelector('.reactor'),
      branding: document.body.innerText.includes('MAATOUK INDUSTRIES'),
      noScroll: document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth };
  })()`);
  for (const [name, valid] of Object.entries(checks))
    if (!valid) throw Error('Runtime smoke failed: ' + name);
  const click = async (selector) => {
    await win.webContents.executeJavaScript(
      `(() => {const button = document.querySelector(${JSON.stringify(selector)}); if (!button) throw Error('Missing HUD control'); button.click();})()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
  };
  await click('button[aria-label="Open radial settings"]');
  await click('.orbit-node');
  const providerUI = await win.webContents.executeJavaScript(
    `({primary:document.body.innerText.includes('Primary brain'),gemini:[...document.querySelectorAll('.control-deck option')].some(e => e.value === 'gemini')})`,
  );
  if (!providerUI.primary || !providerUI.gemini) throw Error('Provider controls unavailable');
  fs.writeFileSync(
    path.join(directory, 'providers.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  fs.writeFileSync(
    path.join(directory, 'agent-checks.json'),
    JSON.stringify({ ...checks, providerUI }, null, 2),
  );
}
module.exports = { smoke };
