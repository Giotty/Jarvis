const fs = require('node:fs');
const path = require('node:path');
async function smoke(win, directory) {
  const checks = await win.webContents.executeJavaScript(`(async () => {
    const api = window.jarvis;
    const plugins = await api.plugins();
    const key = await api.setCredential('openai', 'jarvis-sandbox-credential-only');
    const status = await api.credentials();
    await api.setCredential('openai', '');
    return { plugins: plugins.ok && plugins.data.length >= 10, encryptedCredentials: key.ok && status.ok && status.data.openai === true && !JSON.stringify(status).includes('jarvis-sandbox'), cloudOff: (await api.snapshot()).data.config.cloudEnabled === false };
  })()`);
  for (const [name, valid] of Object.entries(checks))
    if (!valid) throw Error('Runtime smoke failed: ' + name);
  const click = async (label) => {
    await win.webContents.executeJavaScript(
      `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.replace(/\\s/g, '') === ${JSON.stringify(label.replace(/\s/g, ''))}); if (!button) throw Error('Missing settings control'); button.click(); })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
  };
  await click('08 SETTINGS');
  await click('AI PROVIDERS');
  const providerUI = await win.webContents.executeJavaScript(
    `({ providerSelects: document.querySelectorAll('.settings-content select').length, secureKeyFields: document.querySelectorAll('input[type=password]').length, hasProvider: document.body.innerText.includes('Primary provider') })`,
  );
  if (!providerUI.hasProvider || providerUI.secureKeyFields !== 2)
    throw Error('Provider UI smoke failed');
  fs.writeFileSync(
    path.join(directory, 'providers.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await click('PLUGINS');
  const pluginUI = await win.webContents.executeJavaScript(
    `({ count: document.querySelectorAll('.plugin-card').length, schemas: document.querySelectorAll('.plugin-tool').length })`,
  );
  if (pluginUI.count < 10 || pluginUI.schemas < 50) throw Error('Plugin UI smoke failed');
  fs.writeFileSync(
    path.join(directory, 'plugins.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  fs.writeFileSync(
    path.join(directory, 'agent-checks.json'),
    JSON.stringify({ ...checks, providerUI, pluginUI }, null, 2),
  );
}
module.exports = { smoke };
