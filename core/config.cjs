const { z } = require('zod');
const schema = z
  .object({
    setupComplete: z.boolean().default(false),
    mock: z.boolean().default(false),
    weatherLocation: z.string().trim().max(200).default(''),
    provider: z.enum(['ollama', 'openai', 'anthropic', 'gemini']).default('ollama'),
    fallbackProvider: z.enum(['none', 'ollama', 'openai', 'anthropic', 'gemini']).default('ollama'),
    visionProvider: z.enum(['auto', 'ollama', 'openai', 'anthropic', 'gemini']).default('auto'),
    cloudEnabled: z.boolean().default(false),
    preferLocalSimple: z.boolean().default(false),
    cloudVision: z.enum(['disabled', 'manual', 'when-needed']).default('disabled'),
    cloudScreen: z.boolean().default(false),
    cloudClipboard: z.boolean().default(false),
    cloudFiles: z.boolean().default(false),
    openaiUrl: z
      .string()
      .url()
      .refine((v) => new URL(v).protocol === 'https:')
      .default('https://api.openai.com/v1'),
    openaiModel: z.string().max(200).default(''),
    openaiVisionModel: z.string().max(200).default(''),
    anthropicModel: z.string().max(200).default(''),
    geminiModel: z.string().max(200).default(''),
    geminiVisionModel: z.string().max(200).default(''),
    providerCapabilities: z
      .record(
        z.array(z.enum(['TEXT', 'VISION', 'TOOLS', 'STRUCTURED_OUTPUT', 'STREAMING', 'REASONING'])),
      )
      .default({}),
    agentMaxSteps: z.number().int().min(1).max(64).default(24),
    agentRetries: z.number().int().min(0).max(3).default(2),
    toolTimeout: z.number().int().min(1000).max(120000).default(30000),
    providerTimeout: z.number().int().min(1000).max(120000).default(45000),
    agentTaskTimeout: z.number().int().min(10000).max(600000).default(180000),
    parallelTools: z.boolean().default(true),
    automaticRecovery: z.boolean().default(true),
    cloudRequestLimit: z.number().int().min(0).max(10000).default(0),
    pluginEnabled: z.record(z.boolean()).default({}),
    mcpServers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
            name: z.string().min(1).max(100),
            transport: z.enum(['stdio', 'http']),
            command: z.string().max(1000).default(''),
            args: z.array(z.string().max(2000)).max(30).default([]),
            url: z.string().max(2000).default(''),
            permissions: z
              .array(
                z.enum([
                  'SCREEN_READ',
                  'MOUSE_CONTROL',
                  'KEYBOARD_CONTROL',
                  'FILES_READ',
                  'FILES_WRITE',
                  'BROWSER_CONTROL',
                  'EMAIL_READ',
                  'EMAIL_SEND',
                  'CALENDAR_READ',
                  'CALENDAR_WRITE',
                  'SYSTEM_CONTROL',
                  'PROCESS_CONTROL',
                  'NETWORK',
                ]),
              )
              .default([]),
          })
          .strict(),
      )
      .max(20)
      .refine(
        (servers) =>
          new Set(servers.map((s) => s.id)).size === servers.length &&
          servers.every(
            (s) =>
              ![
                'windows',
                'screen',
                'browser',
                'files',
                'research',
                'steam',
                'roblox',
                'system',
                'memory',
                'toolkit',
              ].includes(s.id),
          ),
        'Use unique external plugin IDs, distinct from built-ins',
      )
      .default([]),
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
    animationIntensity: z.enum(['low', 'normal', 'high']).default('normal'),
    microphone: z.boolean().default(false),
    microphoneId: z.string().default(''),
    wakeWord: z.string().min(1).max(40).default('Jarvis'),
    wakeEnabled: z.boolean().default(false),
    conversationMode: z.boolean().default(false),
    ptt: z
      .string()
      .regex(
        /^(?:CommandOrControl|Control|Alt|Shift|Super|Meta)(?:\+(?:CommandOrControl|Control|Alt|Shift|Super|Meta))*\+(?:Space|[A-Z0-9]|F(?:[1-9]|1[0-2]))$/,
      )
      .default('CommandOrControl+Shift+Space'),
    sttModel: z
      .enum(['tiny', 'base', 'small', 'small.en', 'medium', 'large-v3', 'distil-large-v3'])
      .default('base'),
    sttModelPath: z.string().default(''),
    sttLanguage: z.enum(['en', 'auto']).default('en'),
    sttDevice: z.enum(['auto', 'cpu', 'cuda']).default('auto'),
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
    screenSampleSeconds: z.number().int().min(2).max(30).default(3),
    gamingMode: z.enum(['off', 'auto', 'on']).default('auto'),
    gamingCommentary: z.enum(['off', 'important', 'normal', 'verbose']).default('important'),
    proactive: z.enum(['off', 'low', 'normal']).default('low'),
    appAliases: z.record(z.string().min(1).max(150)).default({}),
    websiteAliases: z
      .record(
        z
          .string()
          .url()
          .refine((v) => ['http:', 'https:'].includes(new URL(v).protocol)),
      )
      .default({ google: 'https://www.google.com/', youtube: 'https://www.youtube.com/' }),
    mouse: z.boolean().default(false),
    keyboard: z.boolean().default(false),
    browser: z.boolean().default(true),
    filesystem: z.boolean().default(false),
    powershell: z.boolean().default(false),
    conversationLogs: z.boolean().default(false),
    memory: z.boolean().default(true),
    fileRoot: z.string().default(''),
    fileAccess: z.enum(['selected', 'computer']).default('selected'),
  })
  .strict();
module.exports = { schema, defaults: () => schema.parse({}) };
