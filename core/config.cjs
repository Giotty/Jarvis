const { z } = require('zod');
const schema = z
  .object({
    setupComplete: z.boolean().default(false),
    mock: z.boolean().default(true),
    ollamaUrl: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && u.protocol === 'http:';
      }, 'Only a local Ollama server is allowed')
      .default('http://127.0.0.1:11434'),
    model: z.string().max(200).default(''),
    visionModel: z.string().max(200).default(''),
    temperature: z.number().min(0).max(2).default(0.4),
    context: z.number().int().min(1024).max(131072).default(8192),
    startup: z.boolean().default(false),
    tray: z.boolean().default(true),
    minimized: z.boolean().default(false),
    animations: z.enum(['full', 'reduced', 'off']).default('full'),
    microphone: z.boolean().default(false),
    microphoneId: z.string().default(''),
    wakeWord: z.string().min(1).max(40).default('Jarvis'),
    wakeEnabled: z.boolean().default(false),
    ptt: z
      .string()
      .regex(
        /^(?:CommandOrControl|Control|Alt|Shift|Super|Meta)(?:\+(?:CommandOrControl|Control|Alt|Shift|Super|Meta))*\+(?:Space|[A-Z0-9]|F(?:[1-9]|1[0-2]))$/,
      )
      .default('CommandOrControl+Shift+Space'),
    sttModel: z
      .enum(['tiny', 'base', 'small', 'medium', 'large-v3', 'distil-large-v3'])
      .default('base'),
    sttModelPath: z.string().default(''),
    sttLanguage: z.enum(['en', 'auto']).default('en'),
    autoStopSpeech: z.boolean().default(true),
    ttsEngine: z.enum(['windows', 'piper', 'kokoro']).default('windows'),
    piperVoicePath: z.string().default(''),
    kokoroModelPath: z.string().default(''),
    kokoroVoicesPath: z.string().default(''),
    kokoroVoice: z.enum(['bm_george', 'bm_daniel', 'bm_lewis', 'bm_fable']).default('bm_george'),
    pythonPath: z.string().default('python'),
    tts: z.boolean().default(true),
    speechSpeed: z.number().min(0.5).max(2).default(1),
    speechVolume: z.number().min(0).max(1).default(0.8),
    vision: z.enum(['off', 'manual', 'awake', 'continuous']).default('manual'),
    captureScope: z.enum(['screen', 'active-window']).default('screen'),
    monitor: z.string().default(''),
    interval: z.number().int().min(10).max(300).default(30),
    imageQuality: z.number().int().min(400).max(1920).default(1280),
    frameThreshold: z.number().min(0).max(1).default(0.02),
    mouse: z.boolean().default(false),
    keyboard: z.boolean().default(false),
    browser: z.boolean().default(true),
    filesystem: z.boolean().default(false),
    powershell: z.boolean().default(false),
    conversationLogs: z.boolean().default(false),
    memory: z.boolean().default(true),
    fileRoot: z.string().default(''),
  })
  .strict();
module.exports = { schema, defaults: () => schema.parse({}) };
