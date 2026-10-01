const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');

function powershell(command, timeout = 30000, signal) {
  const code = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n' + command;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(code, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', signal },
      (error, stdout, stderr) =>
        error
          ? reject(Error(`PowerShell failed: ${(stderr || error.message).slice(0, 700)}`))
          : resolve(stdout.replace(/^\uFEFF/, '').trim()),
    );
  });
}
const normalize = (name) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const requiresAppApproval = (name) =>
  /\b(?:uninstall|uninstaller|install|installer|setup|reset|remove|shutdown|restart|désinstaller|désinstallation|installation|réinitialiser)\b/i.test(
    normalize(name),
  );
function chooseApp(query, apps) {
  const name = normalize(query);
  const exact = apps.filter((app) => normalize(app.Name) === name);
  const matches = exact.length
    ? exact
    : apps.filter((app) => name.length >= 3 && normalize(app.Name).includes(name));
  return { selected: matches.length === 1 ? matches[0] : null, matches };
}
class WindowsApps {
  constructor() {
    this.cached = null;
    this.expires = 0;
  }
  async all() {
    if (!this.cached || Date.now() > this.expires) {
      this.expires = Date.now() + 600000;
      this.cached = powershell(
        '@(Get-StartApps | Select-Object Name, AppID) | ConvertTo-Json -Compress',
        15000,
      )
        .then((text) => JSON.parse(text || '[]'))
        .then((items) =>
          (Array.isArray(items) ? items : [items]).filter(
            (a) => typeof a.Name === 'string' && typeof a.AppID === 'string',
          ),
        )
        .catch((error) => {
          this.cached = null;
          throw error;
        });
    }
    return this.cached;
  }
  async list(query = '') {
    const items = await this.all();
    const matches = query
      ? items.filter((app) => normalize(app.Name).includes(normalize(query)))
      : items;
    return {
      applications: matches
        .slice(0, 100)
        .map((a) => ({ name: a.Name, needsConfirmation: requiresAppApproval(a.Name) })),
      total: matches.length,
    };
  }
  async open(name, approvedRisk, openNamespace, launchRegistered) {
    const { selected, matches } = chooseApp(name, await this.all());
    if (!selected)
      return {
        message: matches.length
          ? `Which application? ${matches
              .slice(0, 8)
              .map((a) => a.Name)
              .join('; ')}. Say its full name.`
          : `I couldn't find an installed app named ${name}. Give its Start menu name or executable path.`,
      };
    // A vague query must not automatically resolve to an installer/uninstaller.
    if (requiresAppApproval(selected.Name) && approvedRisk < 3)
      throw Error(
        `Opening ${selected.Name} requires confirmation. Ask for that exact application name.`,
      );
    if (
      /\.(?:msi|msix|bat|cmd|ps1|vbs|js|scr)(?:$|[ "'])/i.test(selected.AppID) &&
      approvedRisk < 3
    )
      throw Error('This app entry runs a script or installer and requires approval.');
    if (/^(?:\{[0-9a-f-]{36}\}\\|[a-z]:[\\/])/i.test(selected.AppID)) {
      if (!launchRegistered) throw Error('Registered desktop launcher is unavailable.');
      await launchRegistered(selected.AppID, approvedRisk);
    } else {
      await openNamespace('shell:AppsFolder\\' + selected.AppID);
    }
    return {
      dispatched: true,
      application: selected.Name,
      message: `Asked Windows to open ${selected.Name}.`,
    };
  }
}
async function resolveFile(config, input, writable = false) {
  if (input.includes('\0')) throw Error('Invalid file path.');
  if (config.fileAccess !== 'computer') {
    const { safePath } = require('./tools.cjs');
    if (!writable && path.resolve(config.fileRoot, input) === path.resolve(config.fileRoot))
      return fs.realpath(config.fileRoot);
    return safePath(config.fileRoot, input);
  }
  const resolved = path.resolve(config.fileRoot || process.env.USERPROFILE || process.cwd(), input);
  if (!/^[a-z]:\\/i.test(resolved))
    throw Error(
      'Computer access accepts local drive paths. Network shares require a separate explicit setup.',
    );
  if (writable && path.parse(resolved).root === resolved)
    throw Error('A drive root cannot be changed with a file tool.');
  let cursor = resolved;
  while (true) {
    try {
      const canonical = await fs.realpath(cursor);
      if (!/^[a-z]:\\/i.test(canonical))
        throw Error('This path redirects outside the local computer.');
      return path.join(canonical, path.relative(cursor, resolved));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (cursor === parent) throw Error('The selected drive does not exist.', { cause: error });
      cursor = parent;
    }
  }
}
async function drives() {
  const found = await Promise.all(
    Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ':\\').map(async (root) => {
      try {
        return (await fs.stat(root)).isDirectory() ? root : null;
      } catch {
        return null;
      }
    }),
  );
  return { drives: found.filter(Boolean) };
}
async function directory(config, input, offset = 0) {
  const folder = await resolveFile(config, input);
  const items = await fs.readdir(folder, { withFileTypes: true });
  items.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
  );
  return {
    path: folder,
    entries: items.slice(offset, offset + 100).map((entry) => ({
      name: entry.name,
      path: path.join(folder, entry.name),
      type: entry.isDirectory() ? 'folder' : entry.isSymbolicLink() ? 'link' : 'file',
    })),
    nextOffset: offset + 100 < items.length ? offset + 100 : null,
  };
}
async function readFile(config, input, offset = 0) {
  const file = await resolveFile(config, input);
  const handle = await fs.open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw Error('Use list_directory for folders.');
    const buffer = Buffer.alloc(16000);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const content = buffer.subarray(0, bytesRead);
    if (content.includes(0))
      throw Error('This is a binary file; use open_file to open it in its application.');
    return {
      path: file,
      content: content.toString('utf8'),
      nextOffset: bytesRead === buffer.length ? offset + bytesRead : null,
    };
  } finally {
    await handle.close();
  }
}
async function searchFiles(config, query, input) {
  const root = await resolveFile(config, input || config.fileRoot);
  const matches = [],
    stack = [{ dir: root, depth: 0 }];
  const started = Date.now();
  let scanned = 0,
    skipped = 0;
  while (stack.length && scanned < 20000 && Date.now() - started < 2000 && matches.length < 100) {
    const { dir, depth } = stack.pop();
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      skipped++;
      continue;
    }
    const next = [];
    for (const entry of items) {
      if (++scanned > 20000) break;
      const file = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(query.toLowerCase())) matches.push(file);
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        depth < 12 &&
        (input || !['node_modules', '.git', '.venv', 'AppData'].includes(entry.name))
      )
        next.push({ dir: file, depth: depth + 1 });
    }
    // Search user-facing folders before huge system/build folders.
    next.sort(
      (a, b) =>
        Number(/\\(?:Documents|Downloads|Desktop)$/i.test(a.dir)) -
        Number(/\\(?:Documents|Downloads|Desktop)$/i.test(b.dir)),
    );
    stack.push(...next);
  }
  return {
    matches: matches.slice(0, 100),
    truncated: Boolean(stack.length),
    skippedDirectories: skipped,
    message: 'Filename search; give a narrower directory to continue if results were limited.',
  };
}
function settingsUri(page) {
  const aliases = {
    settings: '',
    windows: '',
    sound: 'sound',
    volume: 'sound',
    bluetooth: 'bluetooth',
    display: 'display',
    network: 'network',
    wifi: 'network-wifi',
    microphone: 'privacy-microphone',
    camera: 'privacy-webcam',
    mouse: 'mousetouchpad',
    keyboard: 'easeofaccess-keyboard',
    apps: 'appsfeatures',
    updates: 'windowsupdate',
    'windows update': 'windowsupdate',
    gaming: 'gaming',
    privacy: 'privacy',
    notifications: 'notifications',
  };
  const value = Object.hasOwn(aliases, page.toLowerCase())
    ? aliases[page.toLowerCase()]
    : page.replace(/^ms-settings:/i, '').toLowerCase();
  if (!/^[a-z0-9-]*$/.test(value))
    throw Error('Use a Windows Settings page name, such as sound or bluetooth.');
  return 'ms-settings:' + value;
}
module.exports = {
  powershell,
  WindowsApps,
  chooseApp,
  requiresAppApproval,
  resolveFile,
  drives,
  directory,
  readFile,
  searchFiles,
  settingsUri,
};
