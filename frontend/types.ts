export type Config = {
  setupComplete: boolean;
  mock: boolean;
  weatherLocation: string;
  provider: ProviderID;
  visionProvider: ProviderID | 'auto';
  fallbackProvider: ProviderID | 'none';
  cloudEnabled: boolean;
  preferLocalSimple: boolean;
  cloudVision: 'disabled' | 'manual' | 'when-needed';
  cloudScreen: boolean;
  cloudClipboard: boolean;
  cloudFiles: boolean;
  openaiUrl: string;
  openaiModel: string;
  openaiVisionModel: string;
  anthropicModel: string;
  geminiModel: string;
  geminiVisionModel: string;
  providerCapabilities: Record<string, string[]>;
  agentMaxSteps: number;
  agentRetries: number;
  toolTimeout: number;
  providerTimeout: number;
  agentTaskTimeout: number;
  parallelTools: boolean;
  automaticRecovery: boolean;
  cloudRequestLimit: number;
  pluginEnabled: Record<string, boolean>;
  mcpServers: MCPServer[];
  ollamaUrl: string;
  model: string;
  visionModel: string;
  temperature: number;
  context: number;
  startup: boolean;
  tray: boolean;
  minimized: boolean;
  animations: 'full' | 'reduced' | 'off';
  animationIntensity: 'low' | 'normal' | 'high';
  microphone: boolean;
  microphoneId: string;
  wakeWord: string;
  wakeEnabled: boolean;
  conversationMode: boolean;
  ptt: string;
  sttModel: string;
  sttModelPath: string;
  sttLanguage: 'en' | 'auto';
  sttDevice: 'auto' | 'cpu' | 'cuda';
  autoStopSpeech: boolean;
  ttsEngine: 'windows' | 'piper' | 'kokoro';
  piperVoicePath: string;
  kokoroModelPath: string;
  kokoroVoicesPath: string;
  kokoroVoice: 'bm_george' | 'bm_daniel' | 'bm_lewis' | 'bm_fable';
  pythonPath: string;
  tts: boolean;
  speechSpeed: number;
  speechVolume: number;
  vision: 'off' | 'manual' | 'awake' | 'continuous';
  captureScope: 'screen' | 'active-window';
  monitor: string;
  interval: number;
  imageQuality: number;
  frameThreshold: number;
  screenSampleSeconds: number;
  gamingMode: 'off' | 'auto' | 'on';
  gamingCommentary: 'off' | 'important' | 'normal' | 'verbose';
  proactive: 'off' | 'low' | 'normal';
  appAliases: Record<string, string>;
  websiteAliases: Record<string, string>;
  mouse: boolean;
  keyboard: boolean;
  browser: boolean;
  filesystem: boolean;
  powershell: boolean;
  conversationLogs: boolean;
  memory: boolean;
  fileRoot: string;
  fileAccess: 'selected' | 'computer';
};
export type Stats = {
  cpu: number | null;
  ram: number | null;
  ramUsed: number;
  ramTotal: number;
  gpu: number | null;
  gpuName: string;
  vram: number | null;
  vramTotal: number | null;
  disk: number | null;
  upload: number;
  download: number;
  diskRead: number | null;
  diskWrite: number | null;
  battery: number | null;
  temperature: number | null;
  processCount: number;
  processes: { name: string; pid: number; ram: number; cpu: number }[];
  time: number;
};
export type ProviderID = 'ollama' | 'openai' | 'anthropic' | 'gemini';
export type MCPServer = {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string[];
  url: string;
  permissions: string[];
};
export type Plugin = {
  id: string;
  name: string;
  builtin: boolean;
  enabled: boolean;
  status: string;
  permissions: string[];
  tools: {
    name: string;
    description: string;
    risk: number;
    confirmation: boolean;
    permissions: string[];
    permitted: boolean;
    inputSchema: unknown;
    outputSchema?: unknown;
  }[];
};
export type AIUsage = {
  requests: number;
  cloudRequests: number;
  inputTokens: number;
  outputTokens: number;
  provider: ProviderID;
  model: string;
  processing: 'CLOUD' | 'LOCAL';
};
export type Step = {
  tool: string;
  args: Record<string, unknown>;
  risk: number;
  status: string;
  result?: unknown;
  error?: string;
};
export type BriefingPanel = {
  narration?: string;
  type:
    | 'text'
    | 'metrics'
    | 'line'
    | 'area'
    | 'bar'
    | 'radial'
    | 'timeline'
    | 'images'
    | 'comparison'
    | 'news'
    | 'sources'
    | 'video'
    | 'map';
  title: string;
  body?: string;
  sourceIds: string[];
  items?: { label: string; value: string; detail?: string }[];
  data?: { label: string; value: number }[];
  unit?: string;
  imageIds?: string[];
};
export type Briefing = {
  id: string;
  title: string;
  subtitle: string;
  created: number;
  modelOrganized: boolean;
  scenes: { title: string; narration: string; panels: BriefingPanel[] }[];
  sources: {
    id: string;
    title: string;
    url: string;
    publishedAt?: string;
    fetchedAt?: number;
    readable: boolean;
    images: { id: string; title: string; sourceUrl: string }[];
  }[];
};
export type Task = {
  id: string;
  title: string;
  created: number;
  finished?: number;
  status: string;
  steps: Step[];
  stage?: string;
};
export type Memory = { id: number; category: string; content: string };
export type Confirmation = {
  id: string;
  risk: number;
  action: { tool: string; args: Record<string, unknown> };
  expires: number;
};
export type VisionResult = {
  preview: string;
  description: string;
  monitor: string;
  width: number;
  height: number;
  analyzed: number;
  elements: unknown[];
};
export type Diagnostics = {
  windows: boolean;
  python: boolean;
  stt: boolean;
  automation: boolean;
  ollama: boolean;
  models: string[];
  monitors: { id: string; width: number; height: number; scale: number }[];
  speakers: boolean;
};
export type ScreenState = {
  active: boolean;
  stale?: boolean;
  updated: number;
  summary: string;
  gaming: boolean;
  activeWindow: { title: string; application: string } | null;
  monitor?: string;
  lastAnalysis?: number;
  elements: { id: string; label: string; kind: string }[];
  events: { time: number; kind: string; text: string }[];
};
export type BrowserState = {
  observedAt: number;
  windows: { title: string; url: string; foreground: boolean }[];
};
export type Audit = {
  time: string;
  event: string;
  tool?: string;
  status?: string;
  risk?: number;
  diagnostic?: string;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type JarvisAPI = {
  snapshot: () => Promise<
    Result<{
      config: Config;
      stats: Stats | null;
      state: string;
      models: { online: boolean; models: string[] };
      tasks: Task[];
      memories: Memory[];
      screenContext?: ScreenState;
      aiUsage?: AIUsage;
      plugins?: Plugin[];
      briefing?: Briefing;
    }>
  >;
  command: (text: string, turn?: string) => Promise<Result<void>>;
  researchImage: (
    id: string,
  ) => Promise<Result<{ dataUrl: string; title: string; sourceUrl: string }>>;
  openResearchSource: (id: string) => Promise<Result<void>>;
  interrupt: () => Promise<Result<{ taskContinues: boolean }>>;
  cancelTask: () => Promise<Result<void>>;
  confirm: (id: string, yes: boolean) => Promise<Result<void>>;
  cancel: () => Promise<Result<void>>;
  settings: (c: Config) => Promise<Result<Config>>;
  models: () => Promise<Result<{ online: boolean; models: string[] }>>;
  providerCapabilities: (id: ProviderID, model: string) => Promise<Result<string[]>>;
  providerModels: (provider: ProviderID) => Promise<Result<{ online: boolean; models: string[] }>>;
  credentials: () => Promise<Result<Record<string, boolean>>>;
  setCredential: (name: string, value: string) => Promise<Result<Record<string, boolean>>>;
  plugins: () => Promise<Result<Plugin[]>>;
  connectPlugin: (id: string) => Promise<Result<Plugin[]>>;
  disconnectPlugin: (id: string) => Promise<Result<Plugin[]>>;
  vision: () => Promise<Result<VisionResult>>;
  locate: (
    label: string,
  ) => Promise<Result<{ x: number; y: number; confidence: number; label: string }>>;
  memories: () => Promise<Result<Memory[]>>;
  remember: (category: string, content: string, id?: number) => Promise<Result<Memory[]>>;
  forget: (id: number) => Promise<Result<Memory[]>>;
  clearMemory: () => Promise<Result<void>>;
  tasks: () => Promise<Result<Task[]>>;
  logs: () => Promise<Result<Audit[]>>;
  transcribe: (audio: string) => Promise<Result<{ text: string }>>;
  synthesize: (text: string) => Promise<Result<{ audio: string }>>;
  diagnostics: () => Promise<Result<Diagnostics>>;
  browserState: () => Promise<Result<BrowserState>>;
  selectRoot: () => Promise<Result<string | null>>;
  window: (action: string) => Promise<Result<void>>;
  on: (fn: (event: { type: string; data: unknown }) => void) => () => void;
};
declare global {
  interface Window {
    jarvis?: JarvisAPI;
  }
}
export async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw Error(r.error);
  return r.data;
}
