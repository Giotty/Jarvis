import { useEffect, useState } from 'react';
import { Config, Plugin, ProviderID, unwrap } from './types';
export function Credentials({ name }: { name: string }) {
  const [key, setKey] = useState(''),
    [present, setPresent] = useState(false),
    [status, setStatus] = useState('');
  useEffect(() => {
    if (window.jarvis)
      void unwrap(window.jarvis.credentials())
        .then((s) => setPresent(!!s[name]))
        .catch(() => setStatus('Credential storage unavailable.'));
  }, [name]);
  const store = async (value: string) => {
    try {
      const s = await unwrap(window.jarvis!.setCredential(name, value));
      setPresent(!!s[name]);
      setKey('');
      setStatus(value ? 'Saved with Windows encryption.' : 'Removed.');
    } catch (error) {
      setStatus(String(error));
    }
  };
  return (
    <div className="credential-row">
      <label className="setting-row">
        <span>
          {name.startsWith('mcp:') ? 'Plugin account token' : 'API key'}
          <small>{present ? 'Stored securely · ••••••••' : 'No credential saved'}</small>
        </span>
        <input
          type="password"
          autoComplete="off"
          value={key}
          placeholder="Enter a new key"
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button disabled={!key} onClick={() => void store(key)}>
        SAVE KEY SECURELY
      </button>{' '}
      <button disabled={!present} onClick={() => void store('')}>
        REMOVE KEY
      </button>
      {status && (
        <p className="help" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
export function ProviderSettings({
  draft,
  update,
  save,
}: {
  draft: Config;
  update: (key: keyof Config, value: unknown) => void;
  save: (c: Config) => Promise<void>;
}) {
  const [catalogs, setCatalogs] = useState<Record<string, string[]>>({}),
    [status, setStatus] = useState('');
  const select = (key: keyof Config, label: string, values: string[]) => (
    <label className="setting-row">
      <span>{label}</span>
      <select value={String(draft[key])} onChange={(e) => update(key, e.target.value)}>
        {values.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  const field = (key: keyof Config, label: string, provider?: ProviderID) => (
    <label className="setting-row">
      <span>{label}</span>
      <input
        list={provider ? 'models-' + provider : undefined}
        value={String(draft[key])}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );
  const refresh = async (id: ProviderID) => {
    try {
      await save(draft);
      const r = await unwrap(window.jarvis!.providerModels(id));
      setCatalogs((s) => ({ ...s, [id]: r.models }));
      setStatus(
        r.online
          ? 'Model catalog updated.'
          : 'Provider unavailable. Check cloud access, credentials and server settings.',
      );
    } catch (error) {
      setStatus(String(error));
    }
  };
  return (
    <>
      {select('provider', 'Primary provider', ['ollama', 'openai', 'anthropic'])}
      {select('fallbackProvider', 'Fallback provider', ['none', 'ollama', 'openai', 'anthropic'])}
      <label className="setting-row">
        <span>
          Enable cloud AI<small>API usage may incur charges. Off keeps all inference local.</small>
        </span>
        <input
          type="checkbox"
          checked={draft.cloudEnabled}
          onChange={(e) => update('cloudEnabled', e.target.checked)}
        />
      </label>
      {(['openai', 'anthropic', 'ollama'] as ProviderID[]).map((id) => (
        <div className="provider-card" key={id}>
          <h3>{id.toUpperCase()}</h3>
          <datalist id={'models-' + id}>
            {(catalogs[id] || []).map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          {id !== 'ollama' && <Credentials name={id} />}
          {id === 'openai' && (
            <>
              {field('openaiUrl', 'API base URL')}
              {field('openaiModel', 'Chat / tools model', id)}
              {field('openaiVisionModel', 'Vision model (blank uses chat model)', id)}
            </>
          )}
          {id === 'anthropic' && field('anthropicModel', 'Claude model', id)}
          {id === 'ollama' && (
            <>
              {field('ollamaUrl', 'Local server URL')}
              {field('model', 'Local chat / tools model', id)}
              {field('visionModel', 'Local vision model', id)}
            </>
          )}
          <button onClick={() => void refresh(id)}>SAVE & DISCOVER MODELS</button>
        </div>
      ))}
      <p className="help">
        Choose any available model name. Use models with tools for actions and vision for images.
        API keys stay in an encrypted local store and are never returned to the interface.
      </p>
      <label className="setting-row">
        <span>
          Model capability overrides
          <small>
            JSON keyed by provider:model. Values: TEXT, TOOLS, VISION, STRUCTURED_OUTPUT, STREAMING.
            Ollama capabilities are detected automatically.
          </small>
        </span>
        <textarea
          key={JSON.stringify(draft.providerCapabilities)}
          defaultValue={JSON.stringify(draft.providerCapabilities, null, 2)}
          onBlur={(e) => {
            try {
              update('providerCapabilities', JSON.parse(e.target.value));
              setStatus('');
            } catch {
              setStatus('Capabilities must be valid JSON.');
            }
          }}
        />
      </label>
      {status && (
        <p role="status" className="help">
          {status}
        </p>
      )}
    </>
  );
}
export function PluginManager({
  config,
  save,
}: {
  config: Config;
  save: (c: Config) => Promise<void>;
}) {
  const [plugins, setPlugins] = useState<Plugin[]>([]),
    [error, setError] = useState(''),
    [servers, setServers] = useState(JSON.stringify(config.mcpServers, null, 2)),
    [connecting, setConnecting] = useState('');
  useEffect(() => {
    setServers(JSON.stringify(config.mcpServers, null, 2));
    if (window.jarvis)
      void unwrap(window.jarvis.plugins())
        .then(setPlugins)
        .catch((e) => setError(String(e)));
  }, [config]);
  const toggle = async (plugin: Plugin, enabled: boolean) => {
    try {
      await save({ ...config, pluginEnabled: { ...config.pluginEnabled, [plugin.id]: enabled } });
      setPlugins(await unwrap(window.jarvis!.plugins()));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  const connect = async (plugin: Plugin) => {
    setConnecting(plugin.id);
    try {
      setPlugins(
        await unwrap(
          plugin.status === 'connected'
            ? window.jarvis!.disconnectPlugin(plugin.id)
            : window.jarvis!.connectPlugin(plugin.id),
        ),
      );
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting('');
    }
  };
  return (
    <div className="plugin-manager">
      <p className="help">
        Enable only trusted plugins. Review permissions before connecting. External tools require
        approval for each call; server descriptions cannot relax JARVIS safety.
      </p>
      {plugins.map((plugin) => (
        <article className="plugin-card" key={plugin.id}>
          <label className="setting-row">
            <span>
              {plugin.name}
              <small>
                {plugin.status.toUpperCase()} · {plugin.builtin ? 'BUILT IN' : 'MCP SERVER'}
              </small>
            </span>
            <input
              type="checkbox"
              checked={plugin.enabled}
              onChange={(e) => void toggle(plugin, e.target.checked)}
            />
          </label>
          <p className="help">
            Permissions: {plugin.permissions.join(', ') || 'Persistent memory access'}
          </p>
          <details>
            <summary>{plugin.tools.length} AVAILABLE TOOLS</summary>
            {plugin.tools.map((tool) => (
              <div className="plugin-tool" key={tool.name}>
                <b>{tool.name}</b>
                <p>{tool.description}</p>
                <small>
                  {tool.permitted ? 'PERMITTED' : 'PERMISSION DISABLED'} ·{' '}
                  {tool.confirmation ? 'CONFIRMATION REQUIRED' : 'AUTOMATIC'}
                </small>
                <details>
                  <summary>Schema</summary>
                  <pre>
                    {JSON.stringify(
                      { input: tool.inputSchema, output: tool.outputSchema },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            ))}
          </details>
          {!plugin.builtin && (
            <>
              <Credentials name={'mcp:' + plugin.id} />
              <button
                disabled={!plugin.enabled || !!connecting}
                onClick={() => void connect(plugin)}
              >
                {connecting === plugin.id
                  ? 'CONNECTING…'
                  : plugin.status === 'connected'
                    ? 'DISCONNECT'
                    : 'CONNECT'}
              </button>
            </>
          )}
        </article>
      ))}
      <details>
        <summary>CONFIGURE MCP SERVERS</summary>
        <p className="help">
          Use an installed local server or HTTPS endpoint. New servers are disabled until you enable
          them. Tokens belong in the encrypted token field. Installing a server is a separate
          action.
        </p>
        <textarea
          aria-label="MCP server configuration"
          className="mcp-config"
          value={servers}
          onChange={(e) => setServers(e.target.value)}
        />
        <pre className="help">
          {
            '[{"id":"notes","name":"Notes","transport":"http","url":"https://your-server.example/mcp","command":"","args":[],"permissions":["FILES_READ"]}]'
          }
        </pre>
        <button
          onClick={async () => {
            try {
              await save({ ...config, mcpServers: JSON.parse(servers) });
              setPlugins(await unwrap(window.jarvis!.plugins()));
              setError('');
            } catch {
              setError(
                'Server configuration is invalid. Check IDs, transport and permission names.',
              );
            }
          }}
        >
          SAVE SERVERS
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
