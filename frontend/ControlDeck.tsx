import { useEffect, useState } from 'react';
import { Config, Memory, Task, Audit, VisionResult, Stats, unwrap } from './types';
import { Pager, PluginManager, ProviderSettings } from './AgentSettings';
export const categories = [
  'AI',
  'VOICE',
  'VISION',
  'PLUGINS',
  'PRIVACY',
  'SAFETY',
  'SYSTEM',
  'APPEARANCE',
] as const;
export type Category = (typeof categories)[number];
type Field = {
  key: keyof Config;
  label: string;
  options?: string[];
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
};
const fields: Record<string, Field[]> = {
  VOICE: [
    { key: 'microphone', label: 'Microphone access' },
    { key: 'conversationMode', label: 'Hands-free conversation' },
    { key: 'wakeEnabled', label: 'Wake word gate' },
    { key: 'wakeWord', label: 'Wake word' },
    { key: 'tts', label: 'Voice output' },
    { key: 'ttsEngine', label: 'Voice engine', options: ['kokoro', 'piper', 'windows'] },
    {
      key: 'kokoroVoice',
      label: 'Kokoro voice',
      options: ['bm_george', 'bm_daniel', 'bm_lewis', 'bm_fable'],
    },
    { key: 'speechSpeed', label: 'Speech speed', min: 0.5, max: 2, step: 0.05 },
    { key: 'speechVolume', label: 'Voice volume', min: 0, max: 1, step: 0.05 },
    { key: 'microphoneId', label: 'Microphone device ID' },
    {
      key: 'sttModel',
      label: 'Whisper model',
      options: ['tiny', 'base', 'small', 'small.en', 'medium', 'large-v3', 'distil-large-v3'],
    },
    { key: 'sttDevice', label: 'Speech processing', options: ['auto', 'cpu', 'cuda'] },
    { key: 'sttLanguage', label: 'Recognition language', options: ['en', 'auto'] },
    { key: 'sttModelPath', label: 'Local Whisper path' },
    { key: 'piperVoicePath', label: 'Piper voice path' },
    { key: 'ptt', label: 'Manual listening shortcut' },
    { key: 'kokoroModelPath', label: 'Kokoro model path' },
    { key: 'kokoroVoicesPath', label: 'Kokoro voices path' },
    { key: 'autoStopSpeech', label: 'Stop playback on interruption' },
  ],
  VISION: [
    { key: 'vision', label: 'Screen awareness', options: ['off', 'manual', 'awake', 'continuous'] },
    { key: 'captureScope', label: 'Capture scope', options: ['screen', 'active-window'] },
    { key: 'monitor', label: 'Display ID (blank: primary)' },
    { key: 'imageQuality', label: 'Capture width', min: 400, max: 1920 },
    { key: 'interval', label: 'Vision interval / seconds', min: 10, max: 300 },
    { key: 'screenSampleSeconds', label: 'Change sampling / seconds', min: 2, max: 30 },
    { key: 'frameThreshold', label: 'Significant change threshold', min: 0, max: 1, step: 0.01 },
    { key: 'gamingMode', label: 'Gaming context', options: ['off', 'auto', 'on'] },
    {
      key: 'gamingCommentary',
      label: 'Game commentary',
      options: ['off', 'important', 'normal', 'verbose'],
    },
    { key: 'proactive', label: 'Proactive help', options: ['off', 'low', 'normal'] },
  ],
  PRIVACY: [
    { key: 'cloudEnabled', label: 'Cloud AI' },
    { key: 'cloudScreen', label: 'Allow cloud screen images' },
    { key: 'cloudClipboard', label: 'Allow cloud clipboard' },
    { key: 'cloudFiles', label: 'Allow cloud file contents' },
    {
      key: 'cloudVision',
      label: 'Cloud image policy',
      options: ['disabled', 'manual', 'when-needed'],
    },
    { key: 'conversationLogs', label: 'Save conversation logs' },
    { key: 'memory', label: 'Explicit long-term memory' },
  ],
  SAFETY: [
    { key: 'mouse', label: 'Mouse control' },
    { key: 'keyboard', label: 'Keyboard control' },
    { key: 'browser', label: 'Browser / research access' },
    { key: 'filesystem', label: 'File access' },
    { key: 'powershell', label: 'Windows command access' },
    { key: 'fileAccess', label: 'File scope', options: ['selected', 'computer'] },
    { key: 'fileRoot', label: 'Relative-path starting folder' },
    { key: 'mock', label: 'Simulate PC mutations' },
  ],
  SYSTEM: [
    { key: 'startup', label: 'Start with Windows' },
    { key: 'tray', label: 'Keep running in tray' },
    { key: 'minimized', label: 'Start minimized' },
    { key: 'pythonPath', label: 'Python executable' },
    { key: 'weatherLocation', label: 'Default weather city' },
    { key: 'parallelTools', label: 'Parallel read-only tools' },
    { key: 'automaticRecovery', label: 'Automatic bounded recovery' },
  ],
  APPEARANCE: [
    { key: 'animationIntensity', label: 'Animation intensity', options: ['low', 'normal', 'high'] },
    { key: 'animations', label: 'Motion', options: ['full', 'reduced', 'off'] },
  ],
};
export function ControlDeck({
  category,
  config,
  save,
  onBack,
  onClose,
  onObserve,
  onVoice,
  onSetup,
}: {
  category: Category;
  config: Config;
  save: (c: Config) => Promise<void>;
  onBack: () => void;
  onClose: () => void;
  onObserve: () => void;
  onVoice: () => void;
  onSetup: () => void;
}) {
  const [draft, setDraft] = useState(config),
    [page, setPage] = useState(0),
    [status, setStatus] = useState('');
  useEffect(() => {
    setDraft(config);
  }, [config]);
  useEffect(() => {
    setPage(0);
    setStatus('');
  }, [category]);
  const update = (key: keyof Config, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));
  const list = fields[category] || [];
  return (
    <section className="control-deck" role="dialog" aria-label={category + ' controls'}>
      <header>
        <button onClick={onBack}>← ORBIT</button>
        <h2>{category}</h2>
        <button aria-label="Close settings" onClick={onClose}>
          ×
        </button>
      </header>
      {category === 'AI' ? (
        <ProviderSettings draft={draft} update={update} save={save} />
      ) : category === 'PLUGINS' ? (
        <PluginManager config={config} save={save} />
      ) : (
        <div className="control-content">
          <span className="eyebrow">{category} / CONFIGURATION</span>
          <div className="field-group">
            {list.slice(page * 4, page * 4 + 4).map((f) => (
              <label className="setting-row" key={f.key}>
                <span>
                  {f.label}
                  {f.hint && <small>{f.hint}</small>}
                </span>
                {f.options ? (
                  <select
                    value={String(draft[f.key])}
                    onChange={(e) => update(f.key, e.target.value)}
                  >
                    {f.options.map((v) => (
                      <option key={v} value={v}>
                        {v.toUpperCase()}
                      </option>
                    ))}
                  </select>
                ) : typeof draft[f.key] === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(draft[f.key])}
                    onChange={(e) => update(f.key, e.target.checked)}
                  />
                ) : (
                  <input
                    type={typeof draft[f.key] === 'number' ? 'number' : 'text'}
                    value={String(draft[f.key])}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    onChange={(e) =>
                      update(
                        f.key,
                        typeof draft[f.key] === 'number' ? Number(e.target.value) : e.target.value,
                      )
                    }
                  />
                )}
              </label>
            ))}
          </div>
          {category === 'SAFETY' && (
            <p className="help safety-note">
              Permissions are enforced by the host. Sends, submissions, file changes, software
              installation, admin/security commands and shutdown keep action-specific confirmations.
              Emergency stop: Ctrl+Shift+Backspace.
            </p>
          )}
          {category === 'PRIVACY' && (
            <p className="help">
              Background screen analysis stays local. Explicit saved notes are separate from
              temporary task/screen context. Protected Windows locations still obey your account
              permissions.
            </p>
          )}
          {category === 'VISION' && <button onClick={onObserve}>OBSERVE CURRENT SCREEN</button>}
          {category === 'VOICE' && <button onClick={onVoice}>TEST SELECTED VOICE</button>}
          {category === 'SYSTEM' && <button onClick={onSetup}>RUN READINESS CHECKS</button>}
          {category === 'APPEARANCE' && (
            <button onClick={() => void window.jarvis?.window('fullscreen')}>
              TOGGLE IMMERSIVE MODE
            </button>
          )}
          <Pager index={page} count={Math.ceil(list.length / 4)} onChange={setPage} />
        </div>
      )}
      <footer className="control-save">
        {category !== 'PLUGINS' && (
          <button
            className="primary"
            onClick={async () => {
              try {
                await save(draft);
                setStatus('Configuration saved.');
              } catch {
                setStatus('Invalid setting or unavailable service. Check this panel.');
              }
            }}
          >
            SAVE CONFIGURATION
          </button>
        )}
        <span role="status">{status}</span>
      </footer>
    </section>
  );
}
export function UtilityDrawer({
  kind,
  memories,
  tasks,
  logs,
  stats,
  vision,
  close,
  refreshMemories,
  onObserve,
  messages,
}: {
  kind: string;
  memories: Memory[];
  tasks: Task[];
  logs: Audit[];
  stats: Stats | null;
  vision: VisionResult | null;
  close: () => void;
  refreshMemories: (m: Memory[]) => void;
  onObserve: () => void;
  messages: { role: string; text: string; time: string }[];
}) {
  const [page, setPage] = useState(0),
    [note, setNote] = useState(''),
    [category, setCategory] = useState('preferences'),
    [id, setId] = useState<number | undefined>(),
    [error, setError] = useState('');
  const rows =
    kind === 'MEMORY'
      ? memories
      : kind === 'TASKS'
        ? tasks
        : kind === 'LOGS'
          ? logs
          : kind === 'SYSTEM'
            ? stats?.processes || []
            : messages.slice().reverse();
  const historyRows = messages
    .slice()
    .reverse()
    .flatMap((m) => {
      const parts = m.text.match(/[\s\S]{1,500}/g) || [''];
      return parts.map((text, i) => ({
        ...m,
        text,
        role: m.role + (parts.length > 1 ? ' / ' + (i + 1) + ' of ' + parts.length : ''),
      }));
    });
  const pageSize = kind === 'HISTORY' ? 1 : kind === 'MEMORY' ? 2 : 4;
  const displayedRows = kind === 'HISTORY' ? historyRows : rows;
  const count = kind === 'VISION' ? 1 : Math.max(1, Math.ceil(displayedRows.length / pageSize));
  return (
    <section className="utility-drawer" role="dialog" aria-label={kind.toLowerCase()}>
      <header>
        <h2>{kind}</h2>
        <button aria-label="Close panel" onClick={close}>
          ×
        </button>
      </header>
      <div className={'utility-content utility-' + kind.toLowerCase()}>
        {kind === 'VISION' ? (
          <>
            <p>
              {vision?.description || 'Use a read-only observation to inspect your current screen.'}
            </p>
            {vision?.preview && (
              <img
                className="vision-preview"
                src={vision.preview}
                alt="Current screen observation"
              />
            )}
            <button onClick={onObserve}>OBSERVE SCREEN</button>
          </>
        ) : (
          displayedRows.slice(page * pageSize, page * pageSize + pageSize).map((row, i) => (
            <article className="utility-row" key={i}>
              {kind === 'MEMORY' ? (
                <>
                  <small>{(row as Memory).category}</small>
                  <p>{(row as Memory).content}</p>
                  <div className="inline-actions">
                    <button
                      onClick={() => {
                        setNote((row as Memory).content);
                        setCategory((row as Memory).category);
                        setId((row as Memory).id);
                      }}
                    >
                      EDIT
                    </button>
                    <button
                      onClick={async () => {
                        if (window.jarvis)
                          refreshMemories(await unwrap(window.jarvis.forget((row as Memory).id)));
                      }}
                    >
                      REMOVE NOTE
                    </button>
                  </div>
                </>
              ) : kind === 'TASKS' ? (
                <>
                  <b>{(row as Task).title}</b>
                  <small>
                    {(row as Task).status.toUpperCase()} · {(row as Task).steps.length} STEPS
                  </small>
                  <p>
                    {(row as Task).steps
                      .slice(-3)
                      .map((s) => s.tool + ' / ' + s.status)
                      .join(' · ')}
                  </p>
                </>
              ) : kind === 'LOGS' ? (
                <>
                  <small>{new Date((row as Audit).time).toLocaleTimeString()}</small>
                  <b>{(row as Audit).event}</b>
                  <p>
                    {(row as Audit).tool || ''} {(row as Audit).status || ''}
                  </p>
                </>
              ) : kind === 'SYSTEM' ? (
                <>
                  <b>{(row as { name: string }).name}</b>
                  <small>
                    PID {(row as { pid: number }).pid} · {(row as { ram: number }).ram.toFixed(0)}{' '}
                    MB
                  </small>
                </>
              ) : (
                <>
                  <small>
                    {(row as { role: string; time: string }).role} ·{' '}
                    {(row as { time: string }).time}
                  </small>
                  <p>{(row as { text: string }).text}</p>
                </>
              )}
            </article>
          ))
        )}
        {!rows.length && kind !== 'VISION' && <p className="help">No entries available.</p>}
        {kind === 'MEMORY' && (
          <div className="memory-editor">
            <input
              aria-label="Memory category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <input
              aria-label="Explicit memory note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Save a preference or useful fact"
            />
            <button
              disabled={!note.trim()}
              onClick={async () => {
                try {
                  if (window.jarvis)
                    refreshMemories(await unwrap(window.jarvis.remember(category, note, id)));
                  setNote('');
                  setId(undefined);
                } catch {
                  setError('Could not save this note.');
                }
              }}
            >
              {id ? 'UPDATE' : 'SAVE'} NOTE
            </button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <Pager index={Math.min(page, count - 1)} count={count} onChange={setPage} />
    </section>
  );
}
