import { useCallback, useEffect, useRef, useState } from 'react';
import { Core, Sparkline, Waveform } from './Core';
import { Settings, Setup } from './Settings';
import { PluginManager } from './AgentSettings';
import { useVoice } from './useVoice';
import { SpeechPlayback } from './speechPlayback';
import {
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
const modules = [
  'HOME',
  'VISION',
  'SYSTEM',
  'TASKS',
  'MEMORY',
  'AUTOMATION',
  'FILES',
  'SETTINGS',
  'PLUGINS',
  'LOGS',
];
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
    [models, setModels] = useState<string[]>([]),
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
    [note, setNote] = useState(''),
    [category, setCategory] = useState('notes'),
    [editId, setEditId] = useState<number | undefined>(),
    [target, setTarget] = useState(''),
    [located, setLocated] = useState<{
      x: number;
      y: number;
      confidence: number;
      label: string;
    } | null>(null),
    [files, setFiles] = useState(''),
    [voiceName, setVoiceName] = useState(''),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const nextId = useRef(1),
    partialReply = useRef<number | null>(null),
    commandBusy = useRef(false),
    feed = useRef<HTMLDivElement | null>(null),
    configRef = useRef(config),
    commandRef = useRef<(text: string, turn?: string) => Promise<void>>(async () => {}),
    commandFlight = useRef(Promise.resolve()),
    commandEpoch = useRef(0),
    acceptReplies = useRef(true);
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;
  configRef.current = config;
  const player = useRef<SpeechPlayback | null>(null),
    streamedSpeech = useRef(false),
    speechGeneration = useRef(0);
  const interrupt = useCallback(async () => {
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
        let finish!: () => void;
        const done = new Promise<void>((resolve, reject) => {
          finish = resolve;
          audio.onended = () => resolve();
          audio.onerror = () => reject(Error('Local voice playback failed.'));
          void audio.play().catch(reject);
        });
        return {
          done,
          stop: () => {
            audio.pause();
            audio.onended = null;
            audio.onerror = null;
            finish();
          },
        };
      },
      state: (speaking) => setState((s) => (speaking ? 'SPEAKING' : s === 'SPEAKING' ? 'IDLE' : s)),
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
      speech.onend = () => setState((s) => (s === 'SPEAKING' ? 'IDLE' : s));
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
    const update = () => setVoices(speechSynthesis.getVoices().filter((v) => v.localService));
    update();
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => {
      clearInterval(timer);
      speechSynthesis.removeEventListener('voiceschanged', update);
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
        setModels(s.models.models);
        setTasks(s.tasks);
        setMemories(s.memories);
        setScreenContext(s.screenContext || null);
        setAIUsage(s.aiUsage || null);
        setPlugins(s.plugins || []);
      })
      .catch((e) => report(String(e)));
    const unsub = api.on((e) => {
      switch (e.type) {
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
            configRef.current.ttsEngine !== 'windows'
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
          if (streamedSpeech.current) {
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
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);
  const refresh = async () => {
    if (window.jarvis) {
      try {
        const r = await unwrap(window.jarvis.models());
        setOnline(r.online);
        setModels(r.models);
      } catch (e) {
        report(String(e));
      }
    }
  };
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
  return (
    <div className={`app animations-${config?.animations || 'full'}`}>
      <div className="background-grid" />
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">J</div>
          <div>
            JARVIS<small>PERSONAL INTELLIGENCE SYSTEM</small>
          </div>
        </div>
        <div className="top-status">
          <i className={online ? 'status-dot' : 'status-dot amber'} />
          {online ? 'AI CONNECTED' : 'AI CONNECTION UNAVAILABLE'}
          <span className="divider">/</span>
          <span>
            {!config ? 'DESIGN PREVIEW' : config.mock ? 'SIMULATION MODE' : 'LIVE CONTROL'}
          </span>
        </div>
        <div className="window-controls">
          <button
            aria-label="Minimize window"
            onClick={() => void window.jarvis?.window('minimize')}
          >
            −
          </button>
          <button
            aria-label="Maximize window"
            onClick={() => void window.jarvis?.window('maximize')}
          >
            □
          </button>
          <button aria-label="Close window" onClick={() => void window.jarvis?.window('close')}>
            ×
          </button>
        </div>
      </header>
      <nav className="navigation" aria-label="Modules">
        {modules.map((m, i) => (
          <button key={m} className={page === m ? 'active' : ''} onClick={() => selectPage(m)}>
            <small>{String(i + 1).padStart(2, '0')}</small>
            {m}
          </button>
        ))}
        <button className="emergency" onClick={() => void stop()}>
          ■ STOP
        </button>
      </nav>
      <main>
        <div className="page-heading">
          <div>
            <span className="eyebrow">J.A.R.V.I.S. / COMMAND ENVIRONMENT</span>
            <h1>
              {page === 'HOME' ? 'Neural command center' : page.toLowerCase() + ' interface'}
              <span className="heading-line" />
            </h1>
          </div>
          <div className="session-label">
            SESSION / LOCAL
            <br />
            <b>
              {clock.toLocaleDateString('en-CA')} <span>{clock.toLocaleTimeString('en-GB')}</span>
            </b>
          </div>
        </div>
        {!window.jarvis && (
          <div className="preview-banner">
            DESIGN PREVIEW — launch JARVIS desktop for telemetry, voice and automation. No simulated
            data is presented as live.
          </div>
        )}
        <section className="context-strip" aria-label="Live assistant context">
          <span>
            SCREEN CONTEXT{' '}
            <b>{screenContext?.active ? 'ACTIVE' : config?.vision === 'off' ? 'OFF' : 'WAITING'}</b>
          </span>
          <span>
            ACTIVE WINDOW <b>{screenContext?.activeWindow?.title || '—'}</b>
          </span>
          <span>
            AI <b>{config?.model || '—'}</b>
          </span>
          <span>
            VISION AI <b>{config?.visionModel || '—'}</b>
          </span>
          <span>
            GAMING <b>{screenContext?.gaming ? 'ACTIVE' : 'OFF'}</b>
          </span>
          <span>
            MICROPHONE <b>{voice.status}</b>
          </span>
          <span>
            BROWSER{' '}
            <b>
              {browserState?.windows.find((w) => w.foreground)?.url ||
                browserState?.windows[0]?.url ||
                'NOT OBSERVED'}
            </b>
          </span>
        </section>
        {page === 'VISION' && screenContext && (
          <Panel title="SCREEN CONTEXT & EVENTS" code="CONTEXT / LIVE">
            <p>
              {screenContext.summary ||
                'Waiting for a meaningful screen change or a requested observation.'}
            </p>
            <div className="context-events">
              {screenContext.events
                .slice(-12)
                .reverse()
                .map((event, index) => (
                  <div key={event.time + ':' + index}>
                    <time>{new Date(event.time).toLocaleTimeString()}</time>
                    <span>{event.text}</span>
                  </div>
                ))}
            </div>
            <p className="help">
              Current observations are temporary. Screenshots and this event timeline are not saved
              to long-term memory.
            </p>
          </Panel>
        )}
        {page === 'HOME' && (
          <div className="home-grid">
            <div className="left-column">
              <Panel title="SYSTEM TELEMETRY" code="SYS / 01">
                <div className="telemetry-summary">
                  <div
                    className="radial"
                    style={{ '--progress': `${stats?.cpu ?? 0}%` } as React.CSSProperties}
                  >
                    <b>
                      {number(stats?.cpu)}
                      <small>CPU LOAD</small>
                    </b>
                  </div>
                  <div className="telemetry-info">
                    <span>PROCESSING UNIT</span>
                    <strong>{stats?.processCount ?? '—'} PROCESSES</strong>
                    <small>
                      {stats?.temperature != null
                        ? `${number(stats.temperature)}°C CORE TEMP`
                        : 'TEMPERATURE UNAVAILABLE'}
                    </small>
                  </div>
                </div>
                <Metric name="CPU UTILIZATION" value={stats?.cpu} values={graphs.cpu} />
                <Metric name="MEMORY ALLOCATION" value={stats?.ram} values={graphs.ram} />
                <Metric name="GPU UTILIZATION" value={stats?.gpu} values={graphs.gpu} />
                <div className="panel-footer">
                  {stats ? gb(stats.ramUsed) + ' / ' + gb(stats.ramTotal) : 'WAITING FOR TELEMETRY'}
                  <span>3 SEC POLL</span>
                </div>
              </Panel>
              <Panel title="NETWORK UPLINK" code="NET / 02">
                <div className="network-row">
                  <span>↓ RECEIVE</span>
                  <b>
                    {stats ? number(stats.download / 1024, 1) : '—'} <small>KB/S</small>
                  </b>
                </div>
                <div className="network-row">
                  <span>↑ TRANSMIT</span>
                  <b>
                    {stats ? number(stats.upload / 1024, 1) : '—'} <small>KB/S</small>
                  </b>
                </div>
                <div className="network-grid">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="panel-footer">
                  {aiUsage?.processing || 'LOCAL'} PROCESSING
                  <span>{aiUsage?.provider.toUpperCase() || 'OLLAMA'}</span>
                </div>
              </Panel>
            </div>
            <div className="center-column">
              <div className="core-label">
                <i className="status-dot" />
                NEURAL CORE <span>ONLINE INTERFACE / V.01</span>
              </div>
              <Core state={state} level={voice.level} />
              <div className={`state-badge ${state.includes('CONFIRMATION') ? 'warning' : ''}`}>
                <span /> {state} <span />
              </div>
              <p className="core-caption">
                {active
                  ? active.title
                  : online
                    ? 'Ready when you are.'
                    : 'Configure an AI provider in Settings.'}
              </p>
              <div className="core-actions">
                <button
                  disabled={!config || !config.microphone}
                  onClick={voice.toggle}
                  className={voice.listening ? 'primary' : ''}
                >
                  {voice.listening
                    ? '■ PAUSE LISTENING'
                    : config?.conversationMode
                      ? '◉ RESUME CONVERSATION'
                      : '◉ PUSH TO TALK'}
                </button>
                <button
                  onClick={() => {
                    selectPage('VISION');
                    void analyze();
                  }}
                >
                  ⌖ OBSERVE SCREEN
                </button>
              </div>
              <Panel title="AUDIO SPECTRUM" code={voice.listening ? 'MIC / LIVE' : 'MIC / STANDBY'}>
                <Waveform level={voice.level} />
                <div className="panel-footer">
                  {config?.conversationMode
                    ? 'HANDS-FREE CONVERSATION'
                    : config?.wakeEnabled
                      ? 'WAKE PHRASE: ' + config.wakeWord.toUpperCase()
                      : 'PUSH-TO-TALK MODE'}
                  <span>
                    {voice.transcribing
                      ? 'RECOGNIZING SPEECH'
                      : voice.listening
                        ? 'LISTENING'
                        : 'MIC PAUSED'}
                  </span>
                </div>
              </Panel>
            </div>
            <div className="right-column">
              <Panel title="ENVIRONMENT STATUS" code="ENV / 03">
                <div className="clock-display">
                  {clock.toLocaleTimeString('en-GB')}
                  <small>
                    {clock
                      .toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })
                      .toUpperCase()}
                  </small>
                </div>
                <div className="status-table">
                  {[
                    [
                      'AI PROVIDER',
                      aiUsage?.provider.toUpperCase() || config?.provider.toUpperCase() || 'OLLAMA',
                    ],
                    [
                      'AI MODEL',
                      aiUsage?.model ||
                        (config?.provider === 'openai'
                          ? config.openaiModel
                          : config?.provider === 'anthropic'
                            ? config.anthropicModel
                            : config?.model) ||
                        'NOT SELECTED',
                    ],
                    ['FALLBACK', config?.fallbackProvider.toUpperCase() || 'NONE'],
                    ['PROCESSING', aiUsage?.processing || 'LOCAL'],
                    [
                      'PLUGIN STATUS',
                      `${plugins.filter((p) => p.enabled && p.status === 'connected').length} CONNECTED`,
                    ],
                    [
                      'AGENT STEP',
                      active ? `${active.steps.length} / ${config?.agentMaxSteps || 24}` : 'IDLE',
                    ],
                    ['CURRENT PLAN', active?.stage?.toUpperCase() || 'STANDBY'],
                    [
                      'CURRENT TOOL',
                      active?.steps.find((s) => ['running', 'waiting'].includes(s.status))?.tool ||
                        'NONE',
                    ],
                    [
                      'SESSION USAGE',
                      `${aiUsage?.requests || 0} REQUESTS · ${(aiUsage?.inputTokens || 0) + (aiUsage?.outputTokens || 0)} TOKENS`,
                    ],
                    ['CLOUD REQUESTS', String(aiUsage?.cloudRequests || 0)],
                    ['CONFIRMATION', confirmation ? 'WAITING' : 'CLEAR'],
                    [
                      'MICROPHONE',
                      !config?.microphone
                        ? 'DISABLED'
                        : voice.listening
                          ? 'LISTENING'
                          : voice.status,
                    ],
                    ['SCREEN VISION', config?.vision?.toUpperCase() || 'DESKTOP ONLY'],
                    ['WAKE PHRASE', config?.wakeEnabled ? config.wakeWord : 'DISABLED'],
                    ['CONTROL MODE', !config ? 'PREVIEW' : config.mock ? 'MOCK / SAFE' : 'LIVE'],
                    ['GPU', stats?.gpuName || 'UNAVAILABLE'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>
                <button className="text-button" onClick={() => void refresh()}>
                  ↻ RECHECK CONNECTION
                </button>
              </Panel>
              <Panel title="ACTION PIPELINE" code="TASK / 04">
                {active ? (
                  <div className="mini-plan">
                    <p>{active.title}</p>
                    {active.steps.map((s, i) => (
                      <div key={i}>
                        <i className={s.status === 'done' ? 'done' : ''} />
                        <span>{s.tool.replaceAll('_', ' ')}</span>
                        <small>{s.status.toUpperCase()}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="standby">
                    <div className="radar">
                      <i />
                      <i />
                      <b />
                    </div>
                    <span>ALL SYSTEMS STANDING BY</span>
                    <small>{tasks.length} LOCAL TASKS IN HISTORY</small>
                  </div>
                )}
                <div className="panel-footer">
                  GUARDED EXECUTION<span>SAFETY ACTIVE</span>
                </div>
              </Panel>
            </div>
          </div>
        )}
        {page === 'VISION' && (
          <div className="two-column">
            <Panel title="VISUAL SENSOR" code="SCREEN / CAPTURE">
              <div className="vision-preview">
                {vision ? (
                  <img src={vision.preview} alt="Last screen capture" />
                ) : (
                  <div className="empty-sensor">
                    <span>⌖</span>
                    <h3>Awaiting visual input</h3>
                    <p>Capture and analyze your selected monitor on demand.</p>
                  </div>
                )}
              </div>
              <div className="toolbar">
                <button className="primary" disabled={busy} onClick={() => void analyze()}>
                  ANALYZE SCREEN
                </button>
                <span>
                  {vision
                    ? `MONITOR ${vision.monitor} / ${vision.width} × ${vision.height}`
                    : 'SCREENSHOTS ARE NOT SAVED'}
                </span>
              </div>
            </Panel>
            <Panel title="SCENE INTERPRETATION" code="VISION / LOCAL">
              <p className="analysis-text">
                {vision?.description ||
                  'Choose a vision model in Settings. Background screen analysis stays local.'}
              </p>
              <div className="panel-footer">
                LAST ANALYSIS
                <span>{vision ? new Date(vision.analyzed).toLocaleTimeString() : '—'}</span>
              </div>
              <label className="field-label">
                LOCATE AN INTERFACE ELEMENT
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. the Submit button"
                />
              </label>
              <button
                disabled={!target || busy}
                onClick={async () => {
                  if (!window.jarvis) return;
                  try {
                    setLocated(await unwrap(window.jarvis.locate(target)));
                  } catch (e) {
                    report(String(e));
                  }
                }}
              >
                LOCATE ELEMENT
              </button>
              {located && (
                <p className="coordinates">
                  {located.label}
                  <br />X {located.x} / Y {located.y} / CONFIDENCE{' '}
                  {number(located.confidence * 100)}%<br />
                  Coordinates are advisory. Verify them visually before approving a click.
                </p>
              )}
            </Panel>
          </div>
        )}
        {page === 'SYSTEM' && (
          <div className="system-grid">
            <Panel title="RESOURCE MATRIX" code="HARDWARE">
              <Metric name="CPU" value={stats?.cpu} values={graphs.cpu} />
              <Metric name="RAM" value={stats?.ram} values={graphs.ram} />
              <Metric name="GPU" value={stats?.gpu} values={graphs.gpu} />
              <Metric
                name="DISK CAPACITY"
                value={stats?.disk}
                values={[stats?.disk ?? 0, stats?.disk ?? 0]}
              />
              <div className="status-table">
                {[
                  ['GPU', stats?.gpuName],
                  ['VRAM', stats?.vram != null ? `${stats.vram} MB` : 'Unavailable'],
                  ['BATTERY', stats?.battery != null ? `${stats.battery}%` : 'No battery'],
                  ['DISK READ', number(stats?.diskRead)],
                  ['DISK WRITE', number(stats?.diskWrite)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <b>{v || '—'}</b>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="PROCESS INTELLIGENCE" code="TOP RAM">
              <table>
                <thead>
                  <tr>
                    <th>PROCESS</th>
                    <th>PID</th>
                    <th>RAM / MB</th>
                    <th>CPU %</th>
                  </tr>
                </thead>
                <tbody>
                  {stats?.processes?.map((p) => (
                    <tr key={p.pid}>
                      <td>{p.name}</td>
                      <td>{p.pid}</td>
                      <td>{number(p.ram / 1024 ** 2, 1)}</td>
                      <td>{number(p.cpu, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        )}
        {page === 'TASKS' && (
          <Panel title="EXECUTION HISTORY" code={`${tasks.length} TASKS`}>
            <div className="task-list">
              {tasks.length ? (
                tasks.map((t) => (
                  <article className="task-card" key={t.id}>
                    <header>
                      <span>TASK / {t.id.slice(0, 8).toUpperCase()}</span>
                      <b className={t.status === 'failed' ? 'danger-text' : ''}>
                        {t.status.toUpperCase()}
                      </b>
                    </header>
                    <h3>{t.title}</h3>
                    <small>
                      {new Date(t.created).toLocaleString()}
                      {t.finished ? ` / ${((t.finished - t.created) / 1000).toFixed(1)} sec` : ''}
                    </small>
                    {t.steps.map((s, i) => (
                      <div className="task-step" key={i}>
                        <span>{String(i + 1).padStart(2, '0')}</span>
                        <b>{s.tool}</b>
                        <small>LEVEL {s.risk}</small>
                        <em>{s.status}</em>
                        {s.error && <p>{s.error}</p>}
                      </div>
                    ))}
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  No tasks yet. Ask JARVIS to perform an action after connecting a tool-capable
                  model.
                </div>
              )}
            </div>
          </Panel>
        )}
        {page === 'MEMORY' && (
          <div className="two-column">
            <Panel title="LOCAL KNOWLEDGE" code={`${memories.length} MEMORIES`}>
              {memories.length ? (
                memories.map((m) => (
                  <article className="memory-card" key={m.id}>
                    <small>{m.category.toUpperCase()}</small>
                    <p>{m.content}</p>
                    <button
                      onClick={() => {
                        setNote(m.content);
                        setCategory(m.category);
                        setEditId(m.id);
                      }}
                    >
                      EDIT
                    </button>
                    <button
                      onClick={async () => {
                        if (window.confirm('Delete this memory?') && window.jarvis)
                          setMemories(await unwrap(window.jarvis.forget(m.id)));
                      }}
                    >
                      DELETE
                    </button>
                  </article>
                ))
              ) : (
                <div className="empty-state">No memories stored. Add information explicitly.</div>
              )}
              <button
                onClick={async () => {
                  if (window.confirm('Clear all local memories?') && window.jarvis) {
                    await unwrap(window.jarvis.clearMemory());
                    setMemories([]);
                  }
                }}
              >
                CLEAR ALL MEMORIES
              </button>
            </Panel>
            <Panel title={editId ? 'EDIT MEMORY' : 'CREATE MEMORY'} code="SQLITE / LOCAL">
              <label className="field-label">
                CATEGORY
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {[
                    'preferences',
                    'people',
                    'applications',
                    'commands',
                    'shortcuts',
                    'notes',
                    'summaries',
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                CONTENT
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={7}
                  placeholder="Remember a preference, shortcut, or note…"
                />
              </label>
              <p className="help">
                Store only information you choose. Do not enter passwords or financial credentials.
              </p>
              <button
                className="primary"
                disabled={!note.trim()}
                onClick={async () => {
                  if (!window.jarvis) return;
                  try {
                    setMemories(await unwrap(window.jarvis.remember(category, note, editId)));
                    setNote('');
                    setEditId(undefined);
                  } catch (e) {
                    report(String(e));
                  }
                }}
              >
                SAVE MEMORY
              </button>
            </Panel>
          </div>
        )}
        {page === 'AUTOMATION' && (
          <div className="two-column">
            <Panel title="CONTROL CAPABILITIES" code="GUARDED TOOLS">
              <div className="status-table">
                {(['mouse', 'keyboard', 'browser', 'filesystem', 'powershell'] as const).map(
                  (k) => (
                    <div key={k}>
                      <span>{k.toUpperCase()}</span>
                      <b>{config?.[k] ? 'ENABLED' : 'DISABLED'}</b>
                    </div>
                  ),
                )}
              </div>
              <p className="help">
                Each action is validated and assigned a fixed risk level before execution. Change
                permissions in Settings. Mock mode simulates mutations.
              </p>
              <button onClick={() => selectPage('SETTINGS')}>CONFIGURE PERMISSIONS →</button>
            </Panel>
            <Panel title="SAFETY INTERLOCK" code="ALWAYS ACTIVE">
              <div className="safety-seal">
                ◇<span>PROTECTED</span>
              </div>
              <p className="analysis-text">
                Approvals cover one exact action. The assistant cannot execute arbitrary shell
                commands, elevate itself, or disable confirmation.
              </p>
              <button className="danger" onClick={() => void stop()}>
                EMERGENCY STOP
              </button>
              <p className="help">
                CTRL + SHIFT + BACKSPACE stops the queue. It cannot undo an action already executed.
              </p>
            </Panel>
          </div>
        )}
        {page === 'FILES' && (
          <Panel title="FILESYSTEM WORKSPACE" code="EXPLICIT REQUESTS">
            <p className="analysis-text">
              {config?.fileAccess === 'computer'
                ? 'Computer access • Default folder: '
                : 'Allowed folder: '}
              {config?.fileRoot || 'Choose a folder in Settings.'}
            </p>
            <p className="help">
              {config?.fileAccess === 'computer'
                ? 'Local drive paths are available under your Windows permissions. '
                : 'Access is limited to the selected folder. '}
              Searches return bounded results; specify a directory to narrow them. Moves and renames
              require approval. Deletions go to the Recycle Bin after critical confirmation.
            </p>
            <label className="field-label">
              FILENAME SEARCH
              <input
                value={files}
                onChange={(e) => setFiles(e.target.value)}
                placeholder="Enter a filename to search"
              />
            </label>
            <button
              className="primary"
              disabled={!files}
              onClick={() =>
                void command(`Search files for ${JSON.stringify(files)} in my default folder.`)
              }
            >
              SEARCH WITH JARVIS
            </button>
          </Panel>
        )}
        {page === 'PLUGINS' && config && (
          <Panel title="PLUGIN CONNECTIONS" code="CAPABILITIES / MCP">
            <PluginManager config={config} save={save} />
          </Panel>
        )}
        {page === 'SETTINGS' &&
          (config ? (
            <Settings config={config} models={models} save={save} refresh={() => void refresh()} />
          ) : (
            <div className="empty-state">Settings are available in the desktop application.</div>
          ))}
        {page === 'LOGS' && (
          <Panel title="AUDIT STREAM" code="METADATA ONLY">
            <div className="toolbar">
              <button onClick={() => selectPage('LOGS')}>REFRESH LOGS</button>
              <span>CONTENT AND CREDENTIALS ARE EXCLUDED</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>EVENT</th>
                  <th>TOOL</th>
                  <th>RISK</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={i}>
                    <td>{new Date(l.time).toLocaleTimeString()}</td>
                    <td>
                      {l.event}
                      {l.diagnostic && (
                        <details>
                          <summary>Technical details</summary>
                          <pre>{l.diagnostic}</pre>
                        </details>
                      )}
                    </td>
                    <td>{l.tool || '—'}</td>
                    <td>{l.risk ?? '—'}</td>
                    <td>{l.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!logs.length && <div className="empty-state">No audit events in this session.</div>}
          </Panel>
        )}
        <section className="console">
          <header>
            <h2>
              <i className="status-dot" /> COMMAND CONSOLE
            </h2>
            <span>LOCAL SESSION / {messages.length} ENTRIES</span>
            <button className="text-button" onClick={() => setMessages([])}>
              CLEAR
            </button>
          </header>
          <div className="conversation" ref={feed} role="log" aria-label="Conversation">
            {messages.map((m) => (
              <div className={`message ${m.role.toLowerCase()}`} key={m.id}>
                <time>{m.time}</time>
                <b>{m.role}</b>
                <span>{m.text}</span>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = input;
              setInput('');
              void command(text);
            }}
          >
            <span className="prompt-symbol">›</span>
            <input
              aria-label="Command"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Give JARVIS a command…"
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const n = Math.min(historyIndex + 1, history.length - 1);
                  setHistoryIndex(n);
                  setInput(history[n] || '');
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const n = Math.max(historyIndex - 1, -1);
                  setHistoryIndex(n);
                  setInput(n < 0 ? '' : history[n]);
                }
              }}
            />
            <button
              type="button"
              disabled={!config || !config.microphone}
              onClick={voice.toggle}
              aria-label="Toggle microphone"
            >
              {voice.listening ? '■' : '◉'}
            </button>
            <button className="primary" disabled={busy || !input.trim()} type="submit">
              EXECUTE ↗
            </button>
          </form>
        </section>
      </main>
      <footer className="statusbar">
        <span>
          <i className="status-dot" /> JARVIS / LOCAL-FIRST
        </span>
        <span>
          {online ? 'AI CONNECTED' : 'AI UNAVAILABLE'} · {aiUsage?.processing || 'LOCAL'} ·{' '}
          {config?.vision === 'off'
            ? 'VISION OFF'
            : 'VISION ' + (config?.vision?.toUpperCase() || 'DESKTOP ONLY')}
        </span>
        <span>
          SAFETY INTERLOCK ENGAGED <b>●</b>
        </span>
      </footer>
      {confirmation && (
        <div className="modal-shade">
          <section
            className="confirmation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <span className="eyebrow warning">SAFETY INTERLOCK / LEVEL {confirmation.risk}</span>
            <h1 id="confirm-title">Authorization required.</h1>
            <p>Review the exact action before allowing JARVIS to proceed.</p>
            <pre>{JSON.stringify(confirmation.action, null, 2)}</pre>
            {confirmation.action.tool === 'delete_file' && (
              <p className="danger-text">
                This deletes the selected file into the Recycle Bin. Permanent deletion is blocked.
              </p>
            )}
            <p className="help">
              Expires at {new Date(confirmation.expires).toLocaleTimeString()}. Focus the correct
              target window before approving keyboard or mouse input. Mock mode:{' '}
              {config?.mock ? 'ON' : 'OFF'}
            </p>
            <footer>
              <button
                onClick={async () => {
                  const c = confirmation;
                  setConfirmation(null);
                  try {
                    await unwrap(window.jarvis!.confirm(c.id, false));
                  } catch (e) {
                    report(String(e));
                  }
                }}
              >
                DENY
              </button>
              <button
                className="primary"
                onClick={async () => {
                  const c = confirmation;
                  setConfirmation(null);
                  try {
                    await unwrap(window.jarvis!.confirm(c.id, true));
                  } catch (e) {
                    report(String(e));
                  }
                }}
              >
                AUTHORIZE THIS ACTION
              </button>
            </footer>
          </section>
        </div>
      )}
      {setup && config && <Setup config={config} save={save} close={() => setSetup(false)} />}
      {page === 'SETTINGS' && config?.tts && (
        <div className="voice-selector">
          <label>
            {config.ttsEngine === 'piper' ? 'PIPER LOCAL VOICE' : 'LOCAL WINDOWS VOICE'}{' '}
            {config.ttsEngine === 'piper' ? (
              <span>{config.piperVoicePath.split(/[\\/]/).pop()}</span>
            ) : (
              <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
                <option value="">System local default</option>
                {voices.map((v) => (
                  <option key={v.name}>{v.name}</option>
                ))}
              </select>
            )}
          </label>
          <button onClick={() => speak('JARVIS voice system ready.')}>TEST VOICE</button>
          <button onClick={() => setSetup(true)}>RUN SETUP CHECKS</button>
        </div>
      )}
    </div>
  );
}
