const fs = require('node:fs');
const path = require('node:path');
const { schema, defaults } = require('../core/config.cjs');
const root = path.resolve(__dirname, '..');
const dir = path.join(process.env.APPDATA, 'jarvis');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'config.json');
let previous = {};
try {
  previous = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {}
const config = schema.parse({
  ...defaults(),
  ...previous,
  setupComplete: true,
  mock: false,
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'qwen3:8b',
  visionModel: 'gemma3:4b',
  context: 4096,
  microphone: true,
  wakeEnabled: false,
  sttModel: 'small',
  sttModelPath: path.join(root, 'models', 'whisper-small'),
  pythonPath: path.join(root, '.venv', 'Scripts', 'python.exe'),
  tts: true,
  ttsEngine: 'piper',
  piperVoicePath: path.join(root, 'models', 'piper', 'en_US-lessac-medium.onnx'),
  mouse: true,
  keyboard: true,
  browser: true,
  filesystem: true,
  fileRoot: root,
  powershell: true,
  vision: 'manual',
  captureScope: 'screen',
});
fs.writeFileSync(file, JSON.stringify(config, null, 2));
console.log('JARVIS local configuration saved. Safety remains mandatory.');
