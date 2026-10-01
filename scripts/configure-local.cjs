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
  model: 'qwen3.5:9b',
  visionModel: 'qwen3.5:9b',
  context: 8192,
  temperature: 0.25,
  microphone: true,
  wakeEnabled: false,
  conversationMode: true,
  sttModel: 'distil-large-v3',
  sttModelPath: path.join(root, 'models', 'whisper-distil-large-v3'),
  sttLanguage: 'en',
  autoStopSpeech: true,
  pythonPath: path.join(root, '.venv', 'Scripts', 'python.exe'),
  tts: true,
  ttsEngine: 'kokoro',
  kokoroModelPath: path.join(root, 'models', 'kokoro', 'onnx', 'model.onnx'),
  kokoroVoicesPath: path.join(root, 'models', 'kokoro', 'british-voices.bin'),
  kokoroVoice: 'bm_george',
  speechSpeed: 1.02,
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
console.log(
  'JARVIS local configuration saved: British Kokoro voice, distilled Whisper, Qwen 3.5 for chat and vision. Destructive-action confirmations remain enabled.',
);
