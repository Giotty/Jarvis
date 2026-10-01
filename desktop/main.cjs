const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
  clipboard,
  desktopCapturer,
  screen,
  globalShortcut,
  dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { z } = require('zod');
const { schema, defaults } = require('../core/config.cjs');
const { Store } = require('../core/store.cjs');
const { Audit } = require('../core/log.cjs');
const { Ollama } = require('../core/ollama.cjs');
const { telemetry } = require('../core/telemetry.cjs');
const { Safety } = require('../core/safety.cjs');
const { Executor, pythonCall } = require('../core/tools.cjs');
const { Planner } = require('../core/planner.cjs');
const { Vision } = require('../core/vision.cjs');
const { SpeechWorker } = require('../core/speech.cjs');
let speech;
let win,
  tray,
  quitting = false,
  config,
  store,
  audit,
  planner,
  vision,
  ollama,
  configFile,
  timer,
  visionTimer,
  lastStats = {},
  state = 'IDLE',
  statsBusy = false;
const smokeArg = process.argv.find((a) => a.startsWith('--smoke-test='));
if (smokeArg) {
  const testDir = path.resolve(smokeArg.slice('--smoke-test='.length));
  fs.mkdirSync(testDir, { recursive: true });
  app.setPath('userData', testDir);
}
const emit = (type, data) => {
  if (type === 'state') state = data;
  if (type === 'confirmation' && data && win) win.show();
  if (win && !win.isDestroyed()) win.webContents.send('jarvis:event', { type, data });
};
const workerRoot = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'voice')
    : path.join(__dirname, '..', 'voice');
function loadConfig() {
  const dir = app.getPath('userData');
  configFile = path.join(dir, 'config.json');
  try {
    config = schema.parse(JSON.parse(fs.readFileSync(configFile, 'utf8')));
  } catch {
    config = defaults();
    const candidates = [
      path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe'),
      path.resolve(path.dirname(app.getPath('exe')), '..', '..', '.venv', 'Scripts', 'python.exe'),
    ];
    const local = candidates.find((p) => fs.existsSync(p));
    if (local) config.pythonPath = local;
  }
  if (smokeArg) config.setupComplete = true;
  return dir;
}
function saveConfig(next) {
  config = schema.parse(next);
  fs.writeFileSync(configFile + '.tmp', JSON.stringify(config, null, 2));
  fs.renameSync(configFile + '.tmp', configFile);
  app.setLoginItemSettings({
    openAtLogin: config.startup,
    args: config.minimized ? ['--minimized'] : [],
  });
  globalShortcut.unregisterAll();
  globalShortcut.register('CommandOrControl+Shift+Escape', () => emergencyStop());
  if (
    !globalShortcut.register(config.ptt, () => {
      if (config.microphone) {
        win.show();
        emit('ptt', true);
      }
    })
  )
    emit('reply', 'Push-to-talk shortcut could not be registered.');
  emit('config', config);
  return config;
}
function emergencyStop() {
  planner?.cancel();
  speech?.stop();
  emit('stop', true);
}
async function capture(monitor, width) {
  if (config.captureScope === 'active-window') {
    const info = await pythonCall(config, path.join(workerRoot(), 'automation.py'), {
      tool: 'get_foreground_window',
      args: {},
    });
    const windows = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width, height: Math.round(width * 0.75) },
    });
    const source = windows.find((s) => s.name === info.title);
    if (!source) throw Error('Active window capture unavailable.');
    const size = source.thumbnail.getSize();
    return {
      image: source.thumbnail.toJPEG(75).toString('base64'),
      pixels: source.thumbnail.resize({ width: 32, height: 18 }).toBitmap(),
      width: size.width,
      height: size.height,
      monitor: 'active-window',
      monitors: [],
      bounds: info.bounds,
    };
  }
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height: Math.round(width * 0.75) },
  });
  const source = sources.find((s) => s.display_id === monitor) || sources[0];
  if (!source) throw Error('Screen capture unavailable.');
  const display = displays.find((d) => String(d.id) === source.display_id) || displays[0];
  const size = source.thumbnail.getSize();
  const small = source.thumbnail.resize({ width: 32, height: 18 }).toBitmap();
  return {
    image: source.thumbnail.toJPEG(75).toString('base64'),
    pixels: small,
    width: size.width,
    height: size.height,
    monitor: source.display_id,
    monitors: displays.map((d) => ({ id: String(d.id), bounds: d.bounds })),
    bounds: {
      x: Math.round(display.bounds.x * display.scaleFactor),
      y: Math.round(display.bounds.y * display.scaleFactor),
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
    },
  };
}
function handlers() {
  const handle = (name, fn) =>
    ipcMain.handle('jarvis:' + name, async (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw Error('Untrusted IPC sender.');
      try {
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        audit.write('error', { status: 'failed' });
        return { ok: false, error: e.message };
      }
    });
  handle('snapshot', async () => ({
    config,
    stats: lastStats.time ? lastStats : null,
    state,
    models: await ollama.models(),
    tasks: store.tasks(),
    memories: store.memories(),
  }));
  handle('command', (text) => planner.command(z.string().trim().min(1).max(8000).parse(text)));
  handle('confirm', (id, approved) =>
    planner.confirm(z.string().uuid().parse(id), z.boolean().parse(approved)),
  );
  handle('cancel', () => emergencyStop());
  handle('settings', (next) => saveConfig(next));
  handle('models', () => ollama.models());
  handle('vision', async () => {
    emit('state', 'OBSERVING SCREEN');
    try {
      const r = await vision.analyze(true);
      emit('vision', r);
      return r;
    } finally {
      emit('state', 'IDLE');
    }
  });
  handle('locate', async (label) => {
    emit('state', 'OBSERVING SCREEN');
    try {
      return await vision.locate(z.string().min(1).max(200).parse(label));
    } finally {
      emit('state', 'IDLE');
    }
  });
  handle('memories', () => store.memories());
  handle('remember', (category, content, id) => {
    if (!config.memory) throw Error('Memory disabled.');
    return store.remember(
      z
        .enum([
          'preferences',
          'people',
          'applications',
          'commands',
          'shortcuts',
          'notes',
          'summaries',
        ])
        .parse(category),
      z.string().trim().min(1).max(2000).parse(content),
      id === undefined ? undefined : z.number().int().positive().parse(id),
    );
  });
  handle('forget', (id) => store.forget(z.number().int().positive().parse(id)));
  handle('clearMemory', () => store.clear());
  handle('logs', () => audit.items);
  handle('tasks', () => store.tasks());
  handle('transcribe', async (audio) => {
    if (!config.microphone) throw Error('Microphone privacy is disabled.');
    emit('state', 'TRANSCRIBING');
    try {
      return await speech.transcribe(z.string().max(12000000).parse(audio));
    } finally {
      emit('state', 'IDLE');
    }
  });
  handle('diagnostics', async () => {
    const ai = await ollama.models();
    let python = false,
      stt = false,
      automation = false;
    try {
      const { execFile } = require('node:child_process');
      const output = await new Promise((resolve, reject) =>
        execFile(
          config.pythonPath,
          [
            '-c',
            'import importlib.util,json; print(json.dumps({"stt":importlib.util.find_spec("faster_whisper") is not None,"automation":importlib.util.find_spec("pyautogui") is not None}))',
          ],
          { windowsHide: true, timeout: 10000 },
          (e, out) => (e ? reject(e) : resolve(out)),
        ),
      );
      const check = JSON.parse(output);
      python = true;
      stt = check.stt;
      automation = check.automation;
    } catch {}
    return {
      windows: process.platform === 'win32',
      python,
      stt,
      automation,
      ollama: ai.online,
      models: ai.models,
      monitors: screen.getAllDisplays().map((d) => ({
        id: String(d.id),
        width: d.size.width,
        height: d.size.height,
        scale: d.scaleFactor,
      })),
      speakers: true,
    };
  });
  handle('selectRoot', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('window', (action) => {
    if (action === 'minimize') win.minimize();
    else if (action === 'close') win.close();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else throw Error('Unknown window action');
  });
}
async function init() {
  const dir = loadConfig();
  speech = new SpeechWorker(() => config, path.join(workerRoot(), 'speech_worker.py'));
  audit = new Audit(dir);
  store = await new Store().init(dir);
  ollama = new Ollama(() => config);
  const safety = new Safety();
  const executor = new Executor({
    config: () => config,
    worker: path.join(workerRoot(), 'automation.py'),
    audit,
    host: {
      stats: () => telemetry(),
      openUrl: (url) => shell.openExternal(url),
      openPath: (p) => shell.openPath(p),
      trash: (p) => shell.trashItem(p),
      clipboard,
      prepareInput: async () => {
        win.hide();
        await new Promise((r) => setTimeout(r, 350));
      },
      analyze: async () => {
        const result = await vision.analyze(true);
        emit('vision', result);
        return result;
      },
      locate: (label) => vision.locate(label),
      remember: (category, content) => {
        const result = store.remember(category, content);
        emit('memories', result);
        return result;
      },
    },
  });
  planner = new Planner({ ollama, executor, safety, store, emit, audit, config: () => config });
  vision = new Vision({ capture, ollama, config: () => config });
  win = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#040b13',
    title: 'JARVIS',
    icon: path.join(__dirname, '../assets/icon.ico'),
    frame: false,
    show: !config.minimized && !process.argv.includes('--minimized'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_web, permission, callback) =>
    callback(permission === 'media' && config.microphone),
  );
  win.webContents.session.setPermissionCheckHandler(
    (_web, permission) => permission === 'media' && config.microphone,
  );
  handlers();
  if (process.env.JARVIS_DEV === '1') await win.loadURL('http://127.0.0.1:5173');
  else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.on('close', (e) => {
    if (config.tray && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png'));
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip('JARVIS • local assistant');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open JARVIS', click: () => win.show() },
      { label: 'Stop all actions', click: () => emergencyStop() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => win.show());
  saveConfig(config);
  const sample = async () => {
    if (statsBusy) return;
    statsBusy = true;
    try {
      lastStats = await telemetry();
      emit('telemetry', lastStats);
    } catch {
    } finally {
      statsBusy = false;
    }
  };
  await sample();
  timer = setInterval(sample, 3000);
  visionTimer = setInterval(async () => {
    if (
      config.vision !== 'continuous' &&
      !(config.vision === 'awake' && !['IDLE', 'OFFLINE', 'ERROR'].includes(state))
    )
      return;
    try {
      const r = await vision.analyze(false);
      if (r) emit('vision', r);
    } catch {}
  }, 10000);
  if (smokeArg) {
    await sample();
    await new Promise((r) => setTimeout(r, 1500));
    const result = await win.webContents.executeJavaScript(
      `(async()=>{const snapshot=await window.jarvis.snapshot();return {bridge:!!window.jarvis,snapshot: snapshot.ok,config:snapshot.ok?snapshot.data.config:null,headings:[...document.querySelectorAll('h1,h2')].map(x=>x.textContent),cpu:snapshot.ok?snapshot.data.stats.cpu:null,hasNode:typeof require!=='undefined',voices:speechSynthesis.getVoices().filter(v=>v.localService).map(v=>v.name)}})()`,
    );
    fs.writeFileSync(path.join(dir, 'smoke-result.json'), JSON.stringify(result, null, 2));
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, 'hud.png'), shot.toPNG());
    quitting = true;
    app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => win?.show());
  app
    .whenReady()
    .then(init)
    .catch((e) => {
      dialog.showErrorBox('JARVIS startup failed', e.message);
      app.quit();
    });
  app.on('before-quit', () => {
    quitting = true;
    speech?.stop();
    clearInterval(timer);
    clearInterval(visionTimer);
    globalShortcut.unregisterAll();
    planner?.cancel();
  });
  app.on('window-all-closed', () => {
    if (quitting || !config?.tray) app.quit();
  });
}
