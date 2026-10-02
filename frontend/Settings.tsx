import { useEffect, useState } from 'react';
import { Config, Diagnostics, unwrap } from './types';
import { PluginManager, ProviderSettings } from './AgentSettings';
type Props = {
  config: Config;
  models: string[];
  save: (c: Config) => Promise<void>;
  refresh: () => void;
};
export function Settings({ config, save }: Props) {
  const [draft, setDraft] = useState(config),
    [section, setSection] = useState('GENERAL'),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => setDraft(config), [config]);
  const update = (key: keyof Config, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };
  const toggle = (key: keyof Config, label: string, help?: string) => (
    <label className="setting-row">
      <span>
        {label}
        <small>{help}</small>
      </span>
      <input
        type="checkbox"
        checked={Boolean(draft[key])}
        onChange={(e) => update(key, e.target.checked)}
      />
    </label>
  );
  const input = (key: keyof Config, label: string, type = 'text', min?: number, max?: number) => (
    <label className="setting-row">
      <span>{label}</span>
      <input
        type={type}
        value={String(draft[key])}
        min={min}
        max={max}
        step={
          key === 'temperature' ||
          key === 'frameThreshold' ||
          key === 'speechSpeed' ||
          key === 'speechVolume'
            ? 0.01
            : 1
        }
        onChange={(e) => update(key, type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </label>
  );
  const select = (key: keyof Config, label: string, choices: string[]) => (
    <label className="setting-row">
      <span>{label}</span>
      <select value={String(draft[key])} onChange={(e) => update(key, e.target.value)}>
        {choices.map((v) => (
          <option key={v} value={v}>
            {v || 'Select a model'}
          </option>
        ))}
      </select>
    </label>
  );
  const chooseRoot = async () => {
    try {
      const p = await unwrap(window.jarvis!.selectRoot());
      if (p) update('fileRoot', p);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="settings-layout">
      <aside className="subnav">
        {[
          'GENERAL',
          'AI PROVIDERS',
          'PLUGINS',
          'AGENT',
          'USAGE',
          'VOICE',
          'VISION',
          'PERMISSIONS',
          'PRIVACY',
          'SAFETY',
        ].map((s) => (
          <button className={section === s ? 'active' : ''} key={s} onClick={() => setSection(s)}>
            {s}
          </button>
        ))}
      </aside>
      <div className="settings-content">
        <div className="section-heading">
          <span>{section} CONFIGURATION</span>
          <small>LOCAL SETTINGS / PERSISTENT</small>
        </div>
        {section === 'GENERAL' && (
          <>
            {input('weatherLocation', 'Default weather city (city, region/country)')}
            {toggle('startup', 'Launch with Windows')}
            {toggle('tray', 'Minimize to system tray')}
            {toggle('minimized', 'Start minimized')}
            {select('animations', 'Animation intensity', ['full', 'reduced', 'off'])}
            {select('proactive', 'Proactive assistance', ['off', 'low', 'normal'])}
          </>
        )}
        {section === 'AI PROVIDERS' && (
          <>
            <ProviderSettings draft={draft} update={update} save={save} />
            {input('temperature', 'Temperature', 'number', 0, 2)}
            {input('context', 'Context length', 'number', 1024, 131072)}
            <p className="help">
              Choose a model with tool support for PC tasks and a vision-capable model for screen
              analysis. Models are never downloaded automatically.
            </p>
          </>
        )}
        {section === 'PLUGINS' && <PluginManager config={config} save={save} />}
        {section === 'AGENT' && (
          <>
            {input('agentMaxSteps', 'Maximum task steps', 'number', 1, 64)}
            {input('agentRetries', 'Maximum retries per action', 'number', 0, 3)}
            {input('toolTimeout', 'Tool timeout / milliseconds', 'number', 1000, 120000)}
            {input('providerTimeout', 'Provider timeout / milliseconds', 'number', 1000, 120000)}
            {input('agentTaskTimeout', 'Task deadline / milliseconds', 'number', 10000, 600000)}
            {toggle('parallelTools', 'Parallel independent read-only tools')}
            {toggle('automaticRecovery', 'Recover from failed steps')}
          </>
        )}
        {section === 'USAGE' && (
          <>
            {toggle(
              'cloudEnabled',
              'Enable cloud AI',
              'Requests may incur provider charges. Disable for fully local operation.',
            )}
            {toggle('preferLocalSimple', 'Prefer local when no action tools are enabled')}
            {input(
              'cloudRequestLimit',
              'Session cloud request limit (0 = unlimited)',
              'number',
              0,
              10000,
            )}
            <p className="help">
              The HUD shows session requests, provider, model and reported tokens. Token counts are
              not a bill or a dollar estimate.
            </p>
          </>
        )}
        {section === 'VOICE' && (
          <>
            {toggle(
              'microphone',
              'Enable microphone',
              'Permission is requested only when listening starts.',
            )}
            {input('pythonPath', 'Python executable path')}
            {toggle(
              'conversationMode',
              'Hands-free live conversation',
              'Keep listening through replies; speak to interrupt. Pause with the microphone button. Complete requests use the same agent as typed messages.',
            )}
            {input('sttModelPath', 'Downloaded Whisper model folder')}
            {select('ttsEngine', 'Local speech engine', ['kokoro', 'piper', 'windows'])}
            {select('sttLanguage', 'Speech language', ['en', 'auto'])}
            {select('sttDevice', 'Speech processing', ['auto', 'cuda', 'cpu'])}
            {toggle('autoStopSpeech', 'Finish recording when you stop speaking')}
            {draft.ttsEngine === 'kokoro' && (
              <>
                {select('kokoroVoice', 'British voice', [
                  'bm_george',
                  'bm_daniel',
                  'bm_lewis',
                  'bm_fable',
                ])}
                {input('kokoroModelPath', 'Kokoro model path')}
                {input('kokoroVoicesPath', 'Kokoro voices path')}
              </>
            )}
            {input('piperVoicePath', 'Piper voice ONNX path')}
            {select('sttModel', 'Local Whisper model', [
              'tiny',
              'base',
              'small',
              'small.en',
              'medium',
              'large-v3',
              'distil-large-v3',
            ])}
            <label className="setting-row">
              <span>Microphone</span>
              <select
                value={draft.microphoneId}
                onChange={(e) => update('microphoneId', e.target.value)}
              >
                <option value="">System default</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                navigator.mediaDevices
                  .enumerateDevices()
                  .then((d) => setDevices(d.filter((x) => x.kind === 'audioinput')))
                  .catch((e) => setError(String(e)))
              }
            >
              REFRESH MICROPHONES
            </button>
            {toggle(
              'wakeEnabled',
              'Optional wake phrase',
              'Requires the wake phrase before a request when hands-free conversation is off.',
            )}
            {input('wakeWord', 'Wake phrase')}
            {input('ptt', 'Push-to-talk shortcut')}
            {toggle('tts', 'Speak responses with the selected local engine')}
            {input('speechSpeed', 'Speech speed', 'number', 0.5, 2)}
            {input('speechVolume', 'Speech volume', 'number', 0, 1)}
          </>
        )}
        {section === 'VISION' && (
          <>
            {select('vision', 'Screen privacy mode', ['off', 'manual', 'awake', 'continuous'])}
            {select('captureScope', 'Capture scope', ['screen', 'active-window'])}
            {input('monitor', 'Monitor ID (blank = primary)')}
            {input('interval', 'Minimum analysis interval / seconds', 'number', 10, 300)}
            {input('screenSampleSeconds', 'Screen sampling / seconds', 'number', 2, 30)}
            {select('gamingMode', 'Gaming Mode', ['off', 'auto', 'on'])}
            {select('gamingCommentary', 'Gaming commentary', [
              'off',
              'important',
              'normal',
              'verbose',
            ])}
            {input('imageQuality', 'Capture width / pixels', 'number', 400, 1920)}
            {input('frameThreshold', 'Frame difference threshold', 'number', 0, 1)}
            <p className="help">
              Screenshots stay in memory. Continuous vision compares downsampled frames before
              inference. Active-window changes trigger new context. Visible text comes from
              accessibility and local vision. Gaming Mode uses reduced background resolution and
              comments only on visible information; it never controls combat.
            </p>
          </>
        )}
        {section === 'PERMISSIONS' && (
          <>
            {toggle(
              'mock',
              'Simulation mode',
              'When enabled, apps do not open and PC input and file changes are simulated.',
            )}
            {toggle('mouse', 'Allow mouse control')}
            {toggle('keyboard', 'Allow keyboard control')}
            {toggle('browser', 'Allow app and browser launch')}
            <label className="setting-row">
              <span>
                Application aliases
                <small>JSON mapping an alias to a real installed app name.</small>
              </span>
              <textarea
                defaultValue={JSON.stringify(draft.appAliases, null, 2)}
                onBlur={(e) => {
                  try {
                    update('appAliases', JSON.parse(e.target.value));
                    setError('');
                  } catch {
                    setError('Application aliases must be a valid JSON object.');
                  }
                }}
              />
            </label>
            <label className="setting-row">
              <span>
                Website aliases<small>JSON mapping names to ordinary web URLs.</small>
              </span>
              <textarea
                defaultValue={JSON.stringify(draft.websiteAliases, null, 2)}
                onBlur={(e) => {
                  try {
                    update('websiteAliases', JSON.parse(e.target.value));
                    setError('');
                  } catch {
                    setError('Website aliases must be a valid JSON object.');
                  }
                }}
              />
            </label>
            {toggle('filesystem', 'Allow filesystem tools')}
            {select('fileAccess', 'File access scope', ['selected', 'computer'])}
            {input(
              'fileRoot',
              draft.fileAccess === 'computer'
                ? 'Default folder for relative paths'
                : 'Allowed filesystem root',
            )}
            <button onClick={() => void chooseRoot()}>CHOOSE FILE ROOT</button>
            {toggle(
              'powershell',
              'Allow PowerShell with confirmation',
              'The exact script is shown for approval. Windows permissions and UAC still apply.',
            )}
          </>
        )}
        {section === 'PRIVACY' && (
          <>
            {toggle('microphone', 'Microphone access')}
            {toggle('memory', 'Explicit local memory')}
            {toggle(
              'cloudScreen',
              'Allow screen images to cloud AI',
              'Background screen monitoring always stays local.',
            )}
            {select('cloudVision', 'Cloud vision', ['disabled', 'manual', 'when-needed'])}
            {toggle('cloudClipboard', 'Allow clipboard contents to cloud AI')}
            {toggle('cloudFiles', 'Allow file contents to cloud AI')}
            <p className="help">
              Cloud providers receive your requests, public research, visible accessibility text,
              window titles and notes you explicitly retrieve. Screen-image sharing controls
              pictures. Restricted file/clipboard results stay local.
            </p>
            <p className="help">
              Conversation text, screenshots, clipboard contents and tool arguments are never
              written to audit logs. Memories are saved through the Memory page or explicit approved
              tools. SQLite is local and unencrypted.
            </p>
          </>
        )}
        {section === 'SAFETY' && (
          <>
            <div className="risk-list">
              <p>
                <b>00 / SAFE</b> System readings and responses.
              </p>
              <p>
                <b>01 / NORMAL</b> App launch, browser searches, game launch and verified
                search-field input run automatically.
              </p>
              <p>
                <b>02 / IMPORTANT</b> Approval for other clicks, command or sensitive fields,
                hotkeys, clipboard, file moves, and form submission.
              </p>
              <p>
                <b>03 / CRITICAL</b> Explicit approval for deletion, overwrites, executable paths
                and PowerShell commands.
              </p>
            </div>
            <p className="help">
              The model cannot disable safety. Approvals expire after 60 seconds and apply to one
              action. Destructive actions, installers and PowerShell changes require approval.
              Windows permissions still apply, and elevation needs Windows UAC.
            </p>
            <p className="danger-text">
              EMERGENCY STOP: CTRL + SHIFT + BACKSPACE
              <br />
              PyAutoGUI also stops when the pointer reaches a screen corner.
            </p>
          </>
        )}
        <div className="settings-save">
          <button
            className="primary"
            onClick={async () => {
              try {
                await save(draft);
                setSaved(true);
                setError('');
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            SAVE CONFIGURATION
          </button>
          {saved && <span>CONFIGURATION SAVED</span>}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
export function Setup({
  config,
  save,
  close,
}: {
  config: Config;
  save: (c: Config) => Promise<void>;
  close: () => void;
}) {
  const [checks, setChecks] = useState<Diagnostics | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setChecks(await unwrap(window.jarvis!.diagnostics()));
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run();
  }, []);
  return (
    <div className="modal-shade">
      <section
        className="setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <span className="eyebrow">INITIALIZATION PROTOCOL / 01</span>
        <h1 id="setup-title">Welcome to JARVIS.</h1>
        <p>
          Your assistant runs locally. Enable the capabilities you need in Settings. Approved
          actions use your actual computer; destructive actions still require confirmation.
        </p>
        <div className="setup-checks">
          {[
            ['Windows desktop', checks?.windows],
            ['Python executable', checks?.python],
            ['Local speech recognition', checks?.stt],
            ['Mouse / keyboard worker', checks?.automation],
            ['Ollama service', checks?.ollama],
            ['Installed AI models', Boolean(checks?.models.length)],
            ['Connected displays', Boolean(checks?.monitors.length)],
          ].map(([label, ok]) => (
            <div key={String(label)}>
              <span>{label}</span>
              <b className={ok ? 'good' : 'warning'}>
                {checks ? (ok ? 'READY' : 'NOT CONFIGURED') : 'CHECKING'}
              </b>
            </div>
          ))}
        </div>
        <p className="help">
          Install Ollama separately and select your models in Settings. For speech and PC input,
          install voice/requirements.txt into a Python environment and set its executable path. No
          paid API is required.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button disabled={busy} onClick={() => void run()}>
            RECHECK
          </button>
          <button
            className="primary"
            onClick={async () => {
              await save({ ...config, setupComplete: true });
              close();
            }}
          >
            ENTER COMMAND CENTER →
          </button>
        </footer>
      </section>
    </div>
  );
}
