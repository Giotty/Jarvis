import { useEffect, useState } from 'react';
import { Config, Diagnostics, unwrap } from './types';
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
