import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkline } from './Core';
import { Reactor } from './Reactor';
import { ConfirmationRing } from './ConfirmationRing';
import { BriefingView } from './BriefingView';
import { ControlDeck, UtilityDrawer, categories, Category } from './ControlDeck';
import { Setup } from './Initialization';
import { useVoice } from './useVoice';
import { SpeechPlayback } from './speechPlayback';
import {
  Briefing,
  Audit,
  Config,
  Confirmation,
  Memory,
  Stats,
  Task,
  VisionResult,
  ScreenState,
  BrowserState,
  AIUsage,
  Plugin,
  unwrap,
} from './types';
const number = (v: number | null | undefined, digits = 0) => (v == null ? '—' : v.toFixed(digits));
const gb = (v: number) => `${(v / 1024 ** 3).toFixed(1)} GB`;
type Message = { id: number; role: string; text: string; time: string };
function Panel({
  title,
  code,
  children,
  className = '',
}: {
  title: string;
  code: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`hud-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        <span>{code}</span>
      </header>
      {children}
    </section>
  );
}
function Metric({
  name,
  value,
  values,
  suffix = '%',
}: {
  name: string;
  value: number | null | undefined;
  values: number[];
  suffix?: string;
}) {
  return (
    <div className="metric">
      <div>
        <span>{name}</span>
        <b>
          {number(value)}
          <small>{value == null ? '' : suffix}</small>
        </b>
      </div>
      <Sparkline values={values} />
    </div>
  );
}
export function App() {
  const [page, setPage] = useState('HOME'),
    [config, setConfig] = useState<Config | null>(null),
    [stats, setStats] = useState<Stats | null>(null),
    [state, setState] = useState('OFFLINE'),
    [online, setOnline] = useState(false),
    [tasks, setTasks] = useState<Task[]>([]),
    [memories, setMemories] = useState<Memory[]>([]),
    [logs, setLogs] = useState<Audit[]>([]),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [vision, setVision] = useState<VisionResult | null>(null),
    [screenContext, setScreenContext] = useState<ScreenState | null>(null),
    [browserState, setBrowserState] = useState<BrowserState | null>(null),
    [aiUsage, setAIUsage] = useState<AIUsage | null>(null),
    [plugins, setPlugins] = useState<Plugin[]>([]),
    [clock, setClock] = useState(new Date()),
    [messages, setMessages] = useState<Message[]>([
      {
        id: 0,
        role: 'SYSTEM',
        text: 'JARVIS initialized. Local systems standing by.',
        time: new Date().toLocaleTimeString(),
      },
    ]),
    [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [setup, setSetup] = useState(false),
    [history, setHistory] = useState<string[]>([]),
    [historyIndex, setHistoryIndex] = useState(-1),
    [graphs, setGraphs] = useState<{ cpu: number[]; ram: number[]; gpu: number[] }>({
      cpu: [],
      ram: [],
      gpu: [],
    }),
    [voiceName] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingCategory, setSettingCategory] = useState<Category | null>(null),
    [briefing, setBriefing] = useState<Briefing | null>(null),
    [briefingVisible, setBriefingVisible] = useState(false),
    [autoNarration, setAutoNarration] = useState(0),
    [outputLevel, setOutputLevel] = useState(0);
  const nextId = useRef(1),
    partialReply = useRef<number | null>(null),
    commandBusy = useRef(false),
    configRef = useRef(config),
    commandRef = useRef<(text: string, turn?: string) => Promise<void>>(async () => {}),
    commandFlight = useRef(Promise.resolve()),
    commandEpoch = useRef(0),
    acceptReplies = useRef(true);
  const narrationDone = useRef<(() => void) | null>(null),
    narrateThisTask = useRef(false);
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;
  configRef.current = config;
  const player = useRef<SpeechPlayback | null>(null),
    streamedSpeech = useRef(false),
    speechGeneration = useRef(0);
  const interrupt = useCallback(async () => {
    narrationDone.current = null;
    partialReply.current = null;
    speechGeneration.current++;
    player.current?.stop();
    streamedSpeech.current = false;
    speechSynthesis.cancel();
    if (window.jarvis) {
      const status = await unwrap(window.jarvis.interrupt());
      if (!status.taskContinues) {
        commandEpoch.current++;
        acceptReplies.current = false;
      }
    }
  }, []);
  const report = useCallback(
    (text: string, role = 'SYSTEM') =>
      setMessages((m) =>
        [...m, { id: nextId.current++, role, text, time: new Date().toLocaleTimeString() }].slice(
          -200,
        ),
      ),
    [],
  );
  if (!player.current)
    player.current = new SpeechPlayback({
      synthesize: async (text) => (await unwrap(window.jarvis!.synthesize(text))).audio,
      play: (data) => {
        const audio = new Audio('data:audio/wav;base64,' + data);
        let finish!: () => void,
          meter: ReturnType<typeof setInterval> | undefined,
          context: AudioContext | undefined;
        const clean = () => {
          if (meter) clearInterval(meter);
          void context?.close();
          setOutputLevel(0);
        };
        const done = new Promise<void>((resolve, reject) => {
          finish = resolve;
          audio.onended = () => {
            clean();
            resolve();
          };
          audio.onerror = () => {
            clean();
            reject(Error('Local voice playback unavailable.'));
          };
          try {
            context = new AudioContext();
            const analyser = context.createAnalyser();
            analyser.fftSize = 256;
            context.createMediaElementSource(audio).connect(analyser);
            analyser.connect(context.destination);
            const samples = new Float32Array(analyser.fftSize);
            meter = setInterval(() => {
              analyser.getFloatTimeDomainData(samples);
              setOutputLevel(
                Math.min(1, Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length) * 5),
              );
            }, 80);
            void context.resume();
          } catch {
            /* Audio playback remains usable without a level meter. */
          }
          void audio.play().catch((error) => {
            clean();
            reject(error);
          });
        });
        return {
          done,
          stop: () => {
            audio.pause();
            audio.onended = null;
            audio.onerror = null;
            clean();
            finish();
          },
        };
      },
      state: (speaking) => setState((s) => (speaking ? 'SPEAKING' : s === 'SPEAKING' ? 'IDLE' : s)),
      complete: () => {
        const done = narrationDone.current;
        narrationDone.current = null;
        done?.();
      },
      error: (error) => {
        report(String(error));
        setState('ERROR');
      },
    });
  const speak = useCallback(
    (text: string) => {
      const c = configRef.current;
      if (!c?.tts) return;
      const generation = ++speechGeneration.current;
      player.current?.stop();
      speechSynthesis.cancel();
      if (c.ttsEngine !== 'windows' && window.jarvis) {
        player.current?.speak(text);
        return;
      }
      if (!('speechSynthesis' in window)) return;
      const speech = new SpeechSynthesisUtterance(text);
      speech.rate = c.speechSpeed;
      speech.volume = c.speechVolume;
      const voice =
        speechSynthesis.getVoices().find((v) => v.name === voiceName && v.localService) ||
        speechSynthesis.getVoices().find((v) => v.localService);
      if (!voice) {
        report('No local TTS voice available. Install a Windows voice.');
        return;
      }
      speech.voice = voice;
      speech.onstart = () => setState('SPEAKING');
      speech.onend = () => {
        setState((s) => (s === 'SPEAKING' ? 'IDLE' : s));
        const done = narrationDone.current;
        narrationDone.current = null;
        done?.();
      };
      speech.onerror = (event) => {
        if (
          generation === speechGeneration.current &&
          !['interrupted', 'canceled'].includes(event.error)
        )
          setState('ERROR');
      };
      speechSynthesis.speak(speech);
    },
    [voiceName, report],
  );
  const narrate = useCallback(
    (text: string, done: () => void) => {
      speak(text);
      narrationDone.current = done;
    },
    [speak],
  );
  useEffect(() => {
    const exit = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setSettingCategory(null);
        setPage('HOME');
        void window.jarvis?.window('exit-fullscreen');
      }
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, []);
  const command = useCallback(
    async (text: string, turn?: string) => {
      if (!window.jarvis) {
        report('This browser is a UI preview. Open the desktop application for live capabilities.');
        return;
      }
      if (!text.trim()) return;
      const spoken = text
        .trim()
        .replace(/^(?:hey\s+)?jarvis\b[, :.]*/i, '')
        .trim();
      if (/^(?:stop|cancel|never mind|nevermind|wait)[.!]*$/i.test(spoken)) {
        commandEpoch.current++;
        acceptReplies.current = false;
        player.current?.stop();
        speechSynthesis.cancel();
        await unwrap(window.jarvis.cancelTask());
        setConfirmation(null);
        setState('IDLE');
        report('Stopped.', 'JARVIS');
        return;
      }
      const pending = confirmationRef.current;
      if (pending && /^(?:yes|confirm|go ahead|no|cancel)[.!]*$/i.test(spoken)) {
        if (pending.risk >= 3) {
          report('Please use the confirmation button for this critical action.', 'JARVIS');
          return;
        }
        await unwrap(window.jarvis.confirm(pending.id, !/^(?:no|cancel)/i.test(spoken)));
        setConfirmation(null);
        return;
      }
      const epoch = commandEpoch.current;
      if (turn) {
        await commandFlight.current;
        if (epoch !== commandEpoch.current) return;
      }
      if (commandBusy.current) {
        report('JARVIS is finishing the current task. Press STOP to cancel it.');
        return;
      }
      narrationDone.current = null;
      narrateThisTask.current = false;
      setAutoNarration(0);
      player.current?.stop();
      speechSynthesis.cancel();
      commandBusy.current = true;
      acceptReplies.current = true;
      let settled!: () => void;
      commandFlight.current = new Promise<void>((resolve) => {
        settled = resolve;
      });
      setBusy(true);
      report(text, 'USER');
      setHistory((h) => [text, ...h].slice(0, 100));
      setHistoryIndex(-1);
      try {
        await unwrap(window.jarvis.command(text, turn));
      } catch (e) {
        if (epoch === commandEpoch.current) {
          report(e instanceof Error ? e.message : 'That didn’t work. Please try again.');
          setState('IDLE');
        }
      } finally {
        commandBusy.current = false;
        setBusy(false);
        settled();
      }
    },
    [report],
  );
  commandRef.current = command;
  const voice = useVoice(
    config,
    (text, turn) => commandRef.current(text, turn),
    report,
    setState,
    interrupt,
  );
  const speechRef = useRef(speak),
    voiceRef = useRef(voice);
  speechRef.current = speak;
  voiceRef.current = voice;
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const api = window.jarvis;
    if (!api) return;
    let alive = true;
    unwrap(api.snapshot())
      .then((s) => {
        if (!alive) return;
        setConfig(s.config);
        setSetup(!s.config.setupComplete);
        setStats(s.stats);
        setState(s.state);
        setOnline(s.models.online);
        setTasks(s.tasks);
        setMemories(s.memories);
        setScreenContext(s.screenContext || null);
        setAIUsage(s.aiUsage || null);
        setPlugins(s.plugins || []);
        if (s.briefing) setBriefing(s.briefing);
      })
      .catch((e) => report(String(e)));
    const unsub = api.on((e) => {
      switch (e.type) {
        case 'briefing':
          setBriefing(e.data as Briefing);
          setBriefingVisible(true);
          if ((e.data as Briefing).modelOrganized) narrateThisTask.current = true;
          break;
        case 'ai-usage':
          setAIUsage(e.data as AIUsage);
          break;
        case 'plugins':
          setPlugins(e.data as Plugin[]);
          break;
        case 'provider-fallback':
          report('The AI connection is unavailable. Trying the configured fallback.');
          break;
        case 'telemetry': {
          const s = e.data as Stats;
          setStats(s);
          setGraphs((g) => ({
            cpu: [...g.cpu, s.cpu ?? 0].slice(-45),
            ram: [...g.ram, s.ram ?? 0].slice(-45),
            gpu: [...g.gpu, s.gpu ?? 0].slice(-45),
          }));
          break;
        }
        case 'state':
          if (e.data !== 'IDLE' || !player.current?.speaking) setState(e.data as string);
          break;
        case 'speech-start':
          if (
            acceptReplies.current &&
            configRef.current?.tts &&
            configRef.current.ttsEngine !== 'windows' &&
            !narrateThisTask.current
          ) {
            streamedSpeech.current = true;
            player.current?.begin();
          }
          break;
        case 'speech-chunk':
          if (acceptReplies.current && streamedSpeech.current)
            player.current?.append(e.data as string);
          break;
        case 'speech-abort':
          player.current?.stop();
          streamedSpeech.current = false;
          break;
        case 'reply':
          if (!acceptReplies.current) break;
          if (partialReply.current === null) report(e.data as string, 'JARVIS');
          else {
            const id = partialReply.current;
            setMessages((m) =>
              m.map((message) =>
                message.id === id ? { ...message, text: e.data as string } : message,
              ),
            );
            partialReply.current = null;
          }
          if (narrateThisTask.current && configRef.current?.tts) {
            player.current?.stop();
            streamedSpeech.current = false;
            setAutoNarration((n) => n + 1);
          } else if (streamedSpeech.current) {
            player.current?.finish();
            streamedSpeech.current = false;
          } else speechRef.current(e.data as string);
          break;
        case 'reply-chunk': {
          if (!acceptReplies.current) break;
          if (partialReply.current === null) {
            const id = nextId.current++;
            partialReply.current = id;
            setMessages((m) =>
              [
                ...m,
                {
                  id,
                  role: 'JARVIS',
                  text: e.data as string,
                  time: new Date().toLocaleTimeString(),
                },
              ].slice(-200),
            );
          } else {
            const id = partialReply.current;
            setMessages((m) =>
              m.map((message) =>
                message.id === id
                  ? { ...message, text: message.text + (e.data as string) }
                  : message,
              ),
            );
          }
          break;
        }
        case 'task': {
          const t = e.data as Task;
          setTasks((ts) => [t, ...ts.filter((x) => x.id !== t.id)]);
          break;
        }
        case 'confirmation':
          setConfirmation(e.data as Confirmation | null);
          break;
        case 'vision':
          setVision(e.data as VisionResult);
          break;
        case 'screen-context':
          setScreenContext(e.data as ScreenState);
          break;
        case 'browser-state':
          setBrowserState(e.data as BrowserState);
          break;
        case 'progress':
          report(e.data as string);
          break;
        case 'commentary':
          report(e.data as string, 'JARVIS');
          if (!commandBusy.current && !player.current?.speaking && voiceRef.current.level < 0.03)
            speechRef.current(e.data as string);
          break;
        case 'config':
          setConfig(e.data as Config);
          if (!(e.data as Config).tts) {
            player.current?.stop();
            streamedSpeech.current = false;
            speechSynthesis.cancel();
          }
          break;
        case 'early-action':
          report(e.data as string);
          break;
        case 'memories':
          setMemories(e.data as Memory[]);
          break;
        case 'ptt':
          voiceRef.current.toggle();
          break;
        case 'stop':
          narrationDone.current = null;
          commandEpoch.current++;
          acceptReplies.current = false;
          partialReply.current = null;
          voiceRef.current.cancel();
          speechGeneration.current++;
          player.current?.stop();
          streamedSpeech.current = false;
          speechSynthesis.cancel();
          setConfirmation(null);
          break;
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [report]);
  const save = async (c: Config) => {
    if (window.jarvis) setConfig(await unwrap(window.jarvis.settings(c)));
  };
  const analyze = async () => {
    if (!window.jarvis) return report('Screen capture is available in the desktop app.');
    setBusy(true);
    try {
      setVision(await unwrap(window.jarvis.vision()));
    } catch (e) {
      report(String(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    narrationDone.current = null;
    partialReply.current = null;
    voice.cancel();
    speechGeneration.current++;
    player.current?.stop();
    streamedSpeech.current = false;
    speechSynthesis.cancel();
    setConfirmation(null);
    if (window.jarvis) await window.jarvis.cancel();
    report('Action queue stopped.');
    setState('IDLE');
  };
  const selectPage = (p: string) => {
    setPage(p);
    if (p === 'LOGS' && window.jarvis)
      unwrap(window.jarvis.logs())
        .then(setLogs)
        .catch((e) => report(String(e)));
    if (p === 'TASKS' && window.jarvis)
      unwrap(window.jarvis.tasks())
        .then(setTasks)
        .catch((e) => report(String(e)));
  };
  const active = tasks.find((t) => ['running', 'waiting'].includes(t.status));
  const researching = !!active?.steps.some(
    (s) =>
      ['web_search', 'extract_page_text', 'find_images'].includes(s.tool) && s.status === 'running',
  );
  const coreState = confirmation
    ? 'CONFIRMATION'
    : researching
      ? 'RESEARCHING'
      : state === 'IDLE' && voice.listening
        ? 'LISTENING'
        : state;
  const selectedProvider = aiUsage?.provider || (config?.cloudEnabled ? config.provider : 'ollama');
  const currentStep = active?.steps.at(-1);
  const displayMessage = messages.filter((m) => m.role === 'USER' || m.role === 'JARVIS').slice(-2);
  const openSettings = (category: Category | null = null) => {
    setSettingsOpen(true);
    setSettingCategory(category);
    setPage('HOME');
  };
  return (
    <div
      className={
        'app hud-root animations-' +
        (config?.animations || 'full') +
        ' intensity-' +
        (config?.animationIntensity || 'normal') +
        (settingsOpen ? ' settings-open' : '') +
        (settingCategory ? ' category-open' : '') +
        (briefingVisible && briefing && !settingsOpen ? ' briefing-open' : '') +
        (confirmation ? ' confirmation-active' : '')
      }
    >
      <div className="technical-grid" />
      <div className="ambient-orbit" />
      <div className="viewport-corners">
        <i />
        <i />
        <i />
        <i />
      </div>
      <header className="brand-strip">
        <div className="brand-mark">
          M<span>I</span>
        </div>
        <div className="industry-brand">
          MAATOUK INDUSTRIES<small>JARVIS SYSTEMS / NEURAL INTERFACE</small>
        </div>
        <div className="brand-line" />
        <span className="session-clock">
          {clock.toLocaleTimeString('en-GB')}
          <small>{clock.toLocaleDateString('en-CA')}</small>
        </span>
        <div className="window-controls">
          <button
            aria-label="Minimize window"
            onClick={() => void window.jarvis?.window('minimize')}
          >
            −
          </button>
          <button
            aria-label="Immersive fullscreen"
            onClick={() => void window.jarvis?.window('fullscreen')}
          >
            ⛶
          </button>
          <button aria-label="Close window" onClick={() => void window.jarvis?.window('close')}>
            ×
          </button>
        </div>
      </header>
      <main className="hud-stage">
        <aside className="telemetry-stack peripheral">
          <div className="column-label">
            <span>HOST TELEMETRY</span>
            <b>01 / LIVE</b>
          </div>
          <Panel title="PROCESSOR" code="CPU">
            <Metric name="UTILIZATION" value={stats?.cpu} values={graphs.cpu} />
            <div className="data-strip">
              <span>
                THERMAL <b>{number(stats?.temperature)} °C</b>
              </span>
              <span>
                PROCESSES <b>{stats?.processCount ?? '—'}</b>
              </span>
            </div>
          </Panel>
          <Panel title="MEMORY ARRAY" code="RAM">
            <Metric name="LOAD" value={stats?.ram} values={graphs.ram} />
            <div className="data-strip">
              <span>
                USED <b>{stats ? gb(stats.ramUsed) : '—'}</b>
              </span>
              <span>
                TOTAL <b>{stats ? gb(stats.ramTotal) : '—'}</b>
              </span>
            </div>
          </Panel>
          <Panel title="GRAPHICS" code="GPU">
            <Metric name="ENGINE LOAD" value={stats?.gpu} values={graphs.gpu} />
            <div className="data-strip">
              <span>
                VRAM <b>{stats?.vram != null ? stats.vram.toFixed(0) + ' MB' : '—'}</b>
              </span>
            </div>
            <p className="hardware-name">{stats?.gpuName || 'SENSOR UNAVAILABLE'}</p>
          </Panel>
          <div className="host-sensors">
            <div>
              <span>DISK LOAD</span>
              <b>{number(stats?.disk)}%</b>
            </div>
            <div>
              <span>NETWORK ↓</span>
              <b>{stats ? (stats.download / 1024).toFixed(1) + ' KB/s' : '—'}</b>
            </div>
            <div>
              <span>NETWORK ↑</span>
              <b>{stats ? (stats.upload / 1024).toFixed(1) + ' KB/s' : '—'}</b>
            </div>
            <div>
              <span>BATTERY</span>
              <b>{stats?.battery == null ? 'AC / UNAVAILABLE' : number(stats.battery) + '%'}</b>
            </div>
          </div>
          <button className="technical-link" onClick={() => selectPage('SYSTEM')}>
            HOST PROCESS INVENTORY ↗
          </button>
        </aside>
        <section className="core-zone">
          <div className="core-superlabel">
            MAATOUK NEURAL ARCHITECTURE <span>MI–01</span>
          </div>
          <Reactor state={coreState} level={state === 'SPEAKING' ? outputLevel : voice.level} />
          <div className="core-readout">
            <i className={'status-dot ' + (state === 'ERROR' ? 'error' : '')} />
            <span>{coreState}</span>
            <b>
              {config?.mock ? 'SIMULATION' : window.jarvis ? 'REAL ACTION MODE' : 'DESKTOP PREVIEW'}
            </b>
          </div>
          <div className="core-data-rail">
            <span>VERIFIED ACTIONS</span>
            <span>BOUND CONTEXT</span>
            <span>HOST SAFETY</span>
          </div>
        </section>
        <aside className="intelligence-stack peripheral">
          <div className="column-label">
            <span>INTELLIGENCE LINK</span>
            <b>02 / AGENT</b>
          </div>
          <Panel title="AI CONNECTION" code={aiUsage?.processing || 'LOCAL'}>
            <div className="provider-readout">
              <small>ACTIVE PROVIDER</small>
              <b>{selectedProvider.toUpperCase()}</b>
              <span>{aiUsage?.model || config?.model || 'UNCONFIGURED'}</span>
            </div>
            <div className="data-strip">
              <span>
                REQUESTS <b>{aiUsage?.requests ?? 0}</b>
              </span>
              <span>
                TOKENS{' '}
                <b>
                  {aiUsage ? (aiUsage.inputTokens + aiUsage.outputTokens).toLocaleString() : '—'}
                </b>
              </span>
            </div>
            <p className="link-state">
              {config?.cloudEnabled
                ? 'CLOUD ROUTING AVAILABLE'
                : online
                  ? 'LOCAL SERVICE CONNECTED'
                  : 'LOCAL SERVICE UNAVAILABLE'}
            </p>
            <button className="technical-link" onClick={() => openSettings('AI')}>
              CONFIGURE BRAIN ↗
            </button>
          </Panel>
          <Panel title="PERCEPTION" code={screenContext?.gaming ? 'GAME' : 'VISION'}>
            <dl className="status-list">
              <div>
                <dt>SCREEN</dt>
                <dd>{config?.vision?.toUpperCase() || 'MANUAL'}</dd>
              </div>
              <div>
                <dt>CONTEXT</dt>
                <dd>
                  {screenContext?.stale ? 'STALE' : screenContext?.active ? 'ACTIVE' : 'WAITING'}
                </dd>
              </div>
              <div>
                <dt>MICROPHONE</dt>
                <dd>
                  {voice.listening ? 'LISTENING' : voice.transcribing ? 'TRANSCRIBING' : 'IDLE'}
                </dd>
              </div>
              <div>
                <dt>VOICE</dt>
                <dd>{config?.ttsEngine?.toUpperCase() || 'LOCAL'}</dd>
              </div>
            </dl>
            <p className="active-window">
              {screenContext?.activeWindow?.title ||
                browserState?.windows.find((w) => w.foreground)?.title ||
                'No current window observation'}
            </p>
            <button
              className="technical-link"
              onClick={() => {
                selectPage('VISION');
              }}
            >
              SCREEN OBSERVATION ↗
            </button>
          </Panel>
          <Panel title="TOOL NETWORK" code="MCP">
            <div className="plugin-count">
              <b>{plugins.filter((p) => p.enabled && p.status === 'connected').length}</b>
              <span>
                CONNECTED
                <br />
                CAPABILITIES
              </span>
            </div>
            <div className="tool-signal">
              {plugins
                .filter((p) => p.enabled)
                .slice(0, 9)
                .map((p) => (
                  <i
                    key={p.id}
                    title={p.name}
                    className={p.status === 'connected' ? 'connected' : ''}
                  />
                ))}
            </div>
            <button className="technical-link" onClick={() => openSettings('PLUGINS')}>
              PLUGIN REGISTRY ↗
            </button>
          </Panel>
        </aside>
        {settingsOpen && !settingCategory && (
          <div className="settings-orbit" role="dialog" aria-label="Radial settings">
            <div className="orbit-guide" />
            {categories.map((c, i) => {
              const angle = ((i * 45 - 90) * Math.PI) / 180;
              return (
                <button
                  key={c}
                  className="orbit-node"
                  style={
                    {
                      '--node-x': Math.cos(angle),
                      '--node-y': Math.sin(angle),
                      '--node-delay': i * 45 + 'ms',
                    } as React.CSSProperties
                  }
                  onClick={() => setSettingCategory(c)}
                >
                  <small>{String(i + 1).padStart(2, '0')}</small>
                  <b>{c}</b>
                </button>
              );
            })}
            <button className="orbit-close" onClick={() => setSettingsOpen(false)}>
              RETURN TO COMMAND
            </button>
          </div>
        )}
        {settingsOpen && settingCategory && config && (
          <ControlDeck
            key={settingCategory}
            category={settingCategory}
            config={config}
            save={save}
            onBack={() => setSettingCategory(null)}
            onClose={() => {
              setSettingsOpen(false);
              setSettingCategory(null);
            }}
            onObserve={() => {
              setSettingsOpen(false);
              selectPage('VISION');
              void analyze();
            }}
            onVoice={() => speak('JARVIS voice system ready.')}
            onSetup={() => setSetup(true)}
          />
        )}
        {briefingVisible && briefing && !settingsOpen && page === 'HOME' && (
          <BriefingView
            key={briefing.id}
            briefing={briefing}
            onNarrate={narrate}
            onInterrupt={() => {
              void interrupt();
            }}
            onClose={() => setBriefingVisible(false)}
            interrupted={voice.listening && voice.level > 0.06}
            autoStart={autoNarration}
          />
        )}
        {page !== 'HOME' && !settingsOpen && (
          <UtilityDrawer
            key={page}
            kind={page}
            memories={memories}
            tasks={tasks}
            logs={logs}
            stats={stats}
            vision={vision}
            close={() => setPage('HOME')}
            refreshMemories={setMemories}
            onObserve={() => void analyze()}
            messages={messages}
          />
        )}
      </main>
      <section className="command-dock">
        <div className="task-rail">
          <span className="eyebrow">{active ? 'ACTIVE PLAN' : 'COMMAND SYSTEM'}</span>
          <b>
            {currentStep
              ? currentStep.tool.replaceAll('_', ' ').toUpperCase()
              : active?.title || 'READY FOR A NEW INTENTION'}
          </b>
          <span>
            {active
              ? active.steps.filter((s) => s.status === 'done').length + ' COMPLETED STEPS'
              : voice.status}
          </span>
          <div className="compact-tools">
            <button aria-label="Conversation history" onClick={() => selectPage('HISTORY')}>
              HISTORY
            </button>
            <button aria-label="Saved memory" onClick={() => selectPage('MEMORY')}>
              MEMORY
            </button>
            <button aria-label="Task history" onClick={() => selectPage('TASKS')}>
              TASKS
            </button>
            <button aria-label="Audit log" onClick={() => selectPage('LOGS')}>
              LOGS
            </button>
            {briefing && (
              <button
                onClick={() => {
                  setBriefingVisible(true);
                  setPage('HOME');
                  setSettingsOpen(false);
                }}
              >
                BRIEFING
              </button>
            )}
          </div>
        </div>
        <div className="recent-conversation" aria-live="polite">
          {displayMessage.length ? (
            displayMessage.map((m) => (
              <div key={m.id}>
                <small>
                  {m.role} <span>{m.time}</span>
                </small>
                <p>{m.text}</p>
              </div>
            ))
          ) : (
            <div className="welcome-line">
              <small>JARVIS / MAATOUK INDUSTRIES</small>
              <p>Say an intention. I’ll reason, observe, act and verify.</p>
            </div>
          )}
        </div>
        <form
          className="command-strip"
          onSubmit={(e) => {
            e.preventDefault();
            const text = input;
            setInput('');
            void command(text);
          }}
        >
          <span className="command-prefix">MI /</span>
          <input
            aria-label="Command JARVIS"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                const n = Math.min(history.length - 1, historyIndex + 1);
                setHistoryIndex(n);
                setInput(history[n] || '');
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                const n = Math.max(-1, historyIndex - 1);
                setHistoryIndex(n);
                setInput(n < 0 ? '' : history[n] || '');
              }
            }}
            placeholder={
              busy
                ? 'Task in progress · say cancel to stop'
                : 'Speak naturally, or enter an intention…'
            }
          />
          <button type="submit" disabled={!input.trim() || busy} aria-label="Send command">
            ↗
          </button>
          <button
            type="button"
            className={voice.listening ? 'mic-button active' : 'mic-button'}
            aria-label={voice.listening ? 'Pause microphone' : 'Start microphone'}
            onClick={() => voice.toggle()}
          >
            ◉ <span>{voice.listening ? 'LIVE' : 'MIC'}</span>
          </button>
          <button type="button" className="emergency" onClick={() => void stop()}>
            ■ STOP
          </button>
          <button
            type="button"
            className="settings-toggle"
            aria-label="Open radial settings"
            onClick={() => {
              if (settingsOpen) {
                setSettingsOpen(false);
                setSettingCategory(null);
              } else openSettings();
            }}
          >
            ⚙
          </button>
        </form>
      </section>
      <footer className="system-footer">
        <span>MAATOUK INDUSTRIES © {clock.getFullYear()}</span>
        <span>
          {config?.fileAccess === 'computer' ? 'ACCESSIBLE LOCAL DRIVES' : 'SELECTED FILE SCOPE'} ·
          ACTION CONFIRMATIONS ACTIVE
        </span>
        <button onClick={() => openSettings('PRIVACY')}>
          PRIVACY / {config?.cloudEnabled ? 'CLOUD AVAILABLE' : 'LOCAL'}
        </button>
      </footer>
      {messages.at(-1)?.role === 'SYSTEM' && (
        <div className="hud-notification" key={messages.at(-1)?.id} role="status">
          <i />
          <span>{messages.at(-1)?.text}</span>
        </div>
      )}
      {config?.mock && (
        <div className="simulation-warning" role="alert">
          SIMULATION MODE · PC mutations are disabled{' '}
          <button onClick={() => void save({ ...config, mock: false })}>ENABLE REAL CONTROL</button>
        </div>
      )}
      {confirmation && (
        <ConfirmationRing
          key={confirmation.id}
          confirmation={confirmation}
          onDecision={(yes) => {
            const c = confirmation;
            setConfirmation(null);
            if (window.jarvis)
              void unwrap(window.jarvis.confirm(c.id, yes)).catch((e) => report(String(e)));
          }}
        />
      )}
      {setup && config && <Setup config={config} save={save} close={() => setSetup(false)} />}
    </div>
  );
}
