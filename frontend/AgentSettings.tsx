import { useEffect, useState } from 'react';
import { Config, Plugin, ProviderID, MCPServer, unwrap } from './types';
const providers: ProviderID[] = ['ollama', 'openai', 'anthropic', 'gemini'];
const capabilities = ['TEXT', 'TOOLS', 'VISION', 'STRUCTURED_OUTPUT', 'STREAMING', 'REASONING'];
export function Pager({
  index,
  count,
  onChange,
}: {
  index: number;
  count: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="pager">
      <button disabled={index <= 0} aria-label="Previous panel" onClick={() => onChange(index - 1)}>
        ←
      </button>
      <span>
        PANEL {index + 1} / {Math.max(1, count)}
      </span>
      <button
        disabled={index >= count - 1}
        aria-label="Next panel"
        onClick={() => onChange(index + 1)}
      >
        →
      </button>
    </div>
  );
}
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
    } catch {
      setStatus('Credential could not be saved.');
    }
  };
  return (
    <div className="credential-row">
      <label className="setting-row">
        <span>
          {name.startsWith('mcp:') ? 'Account token' : 'API key'}
          <small>{present ? 'ENCRYPTED · ••••••••' : 'NO KEY SAVED'}</small>
        </span>
        <input
          type="password"
          autoComplete="off"
          value={key}
          placeholder="New key"
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <div className="inline-actions">
        <button disabled={!key || !window.jarvis} onClick={() => void store(key)}>
          ENCRYPT & SAVE
        </button>
        <button disabled={!present} onClick={() => void store('')}>
          REMOVE
        </button>
      </div>
      <p role="status" className="help">
        {status}
      </p>
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
  const [page, setPage] = useState(0),
    [editing, setEditing] = useState<ProviderID>(draft.provider),
    [catalog, setCatalog] = useState<string[]>([]),
    [localCaps, setLocalCaps] = useState<string[]>([]),
    [status, setStatus] = useState('');
  const select = (key: keyof Config, label: string, values: string[]) => (
    <label className="setting-row">
      <span>{label}</span>
      <select value={String(draft[key])} onChange={(e) => update(key, e.target.value)}>
        {values.map((v) => (
          <option key={v} value={v}>
            {v.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
  const field = (key: keyof Config, label: string) => (
    <label className="setting-row">
      <span>{label}</span>
      <input
        list="provider-model-catalog"
        value={String(draft[key])}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );
  const toggle = (key: keyof Config, label: string) => (
    <label className="setting-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={Boolean(draft[key])}
        onChange={(e) => update(key, e.target.checked)}
      />
    </label>
  );
  const modelKey: keyof Config =
    editing === 'ollama'
      ? 'model'
      : editing === 'openai'
        ? 'openaiModel'
        : editing === 'anthropic'
          ? 'anthropicModel'
          : 'geminiModel';
  const model = String(draft[modelKey]),
    capKey = editing + ':' + model,
    caps =
      editing === 'ollama'
        ? localCaps
        : draft.providerCapabilities[capKey] || ['TEXT', 'STREAMING'];
  useEffect(() => {
    let active = true;
    if (editing === 'ollama' && model && window.jarvis)
      void unwrap(window.jarvis.providerCapabilities(editing, model))
        .then((c) => {
          if (active) setLocalCaps(c);
        })
        .catch(() => {
          if (active) setLocalCaps([]);
        });
    return () => {
      active = false;
    };
  }, [editing, model]);
  return (
    <div className="control-content">
      <h3>
        {
          [
            'CONNECTION ROUTING',
            'MODEL & CREDENTIAL',
            'MODEL CAPABILITIES',
            'AGENT BOUNDS',
            'INFERENCE OPTIONS',
            'NAME ALIASES',
          ][page]
        }
      </h3>
      {page === 0 && (
        <>
          {select('provider', 'Primary brain', providers)}
          {select('fallbackProvider', 'Fallback brain', ['none', ...providers])}
          {select('visionProvider', 'Vision provider', ['auto', ...providers])}
          {toggle('cloudEnabled', 'Cloud inference')}
          {toggle('preferLocalSimple', 'Prefer local for initial inference')}
          <p className="help">
            Cloud stays off until you enable it. Provider billing and quotas apply to your account.
            API credentials are separate from configuration.
          </p>
        </>
      )}
      {page === 1 && (
        <>
          <label className="setting-row">
            <span>Configure provider</span>
            <select
              value={editing}
              onChange={(e) => {
                setEditing(e.target.value as ProviderID);
                setCatalog([]);
              }}
            >
              {providers.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <datalist id="provider-model-catalog">
            {catalog.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {field(modelKey, 'Conversation / tools model')}
          {editing === 'ollama' && (
            <>
              {field('ollamaUrl', 'Local server')}
              {field('visionModel', 'Local vision model')}
            </>
          )}
          {editing === 'openai' && field('openaiVisionModel', 'Vision model')}
          {editing === 'gemini' && field('geminiVisionModel', 'Vision model')}
          {editing !== 'ollama' && <Credentials name={editing} />}
          <button
            disabled={!window.jarvis}
            onClick={async () => {
              try {
                await save(draft);
                const r = await unwrap(window.jarvis!.providerModels(editing));
                setCatalog(r.models);
                setStatus(
                  r.online
                    ? 'Catalog ready.'
                    : 'Provider unavailable; check key and cloud setting.',
                );
              } catch {
                setStatus('Model discovery unavailable.');
              }
            }}
          >
            SAVE & DISCOVER MODELS
          </button>
        </>
      )}
      {page === 2 && (
        <>
          <label className="setting-row">
            <span>Capability profile</span>
            <select value={editing} onChange={(e) => setEditing(e.target.value as ProviderID)}>
              {providers.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <p className="help">
            {model || 'Select a model in panel 2.'} · Declare only features this model supports.
            Unknown cloud models default to text and streaming; Ollama reports capabilities locally.
          </p>
          <div className="capability-grid">
            {capabilities.map((cap) => (
              <label key={cap}>
                <input
                  type="checkbox"
                  disabled={!model || editing === 'ollama'}
                  checked={caps.includes(cap)}
                  onChange={(e) =>
                    update('providerCapabilities', {
                      ...draft.providerCapabilities,
                      [capKey]: e.target.checked
                        ? [...new Set([...caps, cap])]
                        : caps.filter((v) => v !== cap),
                    })
                  }
                />
                {cap}
              </label>
            ))}
          </div>
        </>
      )}
      {page === 3 && (
        <>
          {(
            [
              'agentMaxSteps',
              'agentRetries',
              'toolTimeout',
              'providerTimeout',
              'agentTaskTimeout',
              'cloudRequestLimit',
            ] as (keyof Config)[]
          ).map((key) => (
            <label className="setting-row" key={key}>
              <span>
                {
                  (
                    {
                      agentMaxSteps: 'Maximum steps',
                      agentRetries: 'Retries',
                      toolTimeout: 'Tool timeout / ms',
                      providerTimeout: 'AI timeout / ms',
                      agentTaskTimeout: 'Task timeout / ms',
                      cloudRequestLimit: 'Cloud request limit',
                    } as Record<string, string>
                  )[key]
                }
              </span>
              <input
                type="number"
                value={Number(draft[key])}
                onChange={(e) => update(key, Number(e.target.value))}
              />
            </label>
          ))}
        </>
      )}
      {page === 4 && (
        <>
          {(['temperature', 'context'] as const).map((key) => (
            <label className="setting-row" key={key}>
              <span>{key === 'temperature' ? 'Temperature' : 'Context tokens / local'}</span>
              <input
                type="number"
                step={key === 'temperature' ? 0.1 : 1024}
                value={Number(draft[key])}
                onChange={(e) => update(key, Number(e.target.value))}
              />
            </label>
          ))}
          {toggle('parallelTools', 'Parallel independent reads')}
          {toggle('automaticRecovery', 'Bounded failure recovery')}
          {field('openaiUrl', 'OpenAI compatible API base')}
        </>
      )}
      {page === 5 && <AliasSettings draft={draft} update={update} />}
      {status && (
        <p role="status" className="help">
          {status}
        </p>
      )}
      <Pager index={page} count={6} onChange={setPage} />
    </div>
  );
}
function AliasSettings({
  draft,
  update,
}: {
  draft: Config;
  update: (key: keyof Config, value: unknown) => void;
}) {
  const [kind, setKind] = useState<'appAliases' | 'websiteAliases'>('appAliases'),
    [name, setName] = useState(''),
    [value, setValue] = useState(''),
    [selected, setSelected] = useState('');
  const entries = draft[kind];
  return (
    <>
      <label className="setting-row">
        <span>Alias type</span>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setName('');
            setValue('');
            setSelected('');
          }}
        >
          <option value="appAliases">Applications</option>
          <option value="websiteAliases">Websites</option>
        </select>
      </label>
      <label className="setting-row">
        <span>Saved aliases</span>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setName(e.target.value);
            setValue(entries[e.target.value] || '');
          }}
        >
          <option value="">New alias</option>
          {Object.keys(entries).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="setting-row">
        <span>Say this name</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="setting-row">
        <span>{kind === 'appAliases' ? 'Installed application' : 'Website URL'}</span>
        <input
          value={value}
          maxLength={kind === 'appAliases' ? 150 : 2000}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <div className="inline-actions">
        <button
          disabled={!name.trim() || !value.trim()}
          onClick={() => {
            const next = { ...entries };
            if (selected && selected !== name.trim()) delete next[selected];
            next[name.trim()] = value.trim();
            update(kind, next);
            setSelected(name.trim());
          }}
        >
          ADD / UPDATE
        </button>
        <button
          disabled={!selected}
          onClick={() => {
            const next = { ...entries };
            delete next[selected];
            update(kind, next);
            setSelected('');
            setName('');
            setValue('');
          }}
        >
          REMOVE ALIAS
        </button>
      </div>
      <p className="help">
        Aliases resolve names; the model still interprets your intention. Save configuration to
        apply your changes.
      </p>
    </>
  );
}
const permissionNames = [
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
];
export function PluginManager({
  config,
  save,
}: {
  config: Config;
  save: (c: Config) => Promise<void>;
}) {
  const [plugins, setPlugins] = useState<Plugin[]>([]),
    [index, setIndex] = useState(0),
    [toolPage, setToolPage] = useState(0),
    [toolView, setToolView] = useState(false),
    [inspect, setInspect] = useState<string | null>(null),
    [schemaPage, setSchemaPage] = useState(0),
    [edit, setEdit] = useState(false),
    [permissionPage, setPermissionPage] = useState(false),
    [status, setStatus] = useState(''),
    [connecting, setConnecting] = useState(false);
  const [server, setServer] = useState<MCPServer>({
    id: '',
    name: '',
    transport: 'http',
    url: '',
    command: '',
    args: [],
    permissions: [],
  });
  useEffect(() => {
    if (window.jarvis)
      void unwrap(window.jarvis.plugins())
        .then(setPlugins)
        .catch(() => setStatus('Plugin inventory unavailable.'));
  }, [config]);
  const selected = plugins[index];
  const inspected = selected?.tools.find((t) => t.name === inspect);
  const schemaParts = inspected
    ? (() => {
        const lines = JSON.stringify(inspected.inputSchema, null, 2)
          .split('\n')
          .flatMap((line) => line.match(/.{1,48}/g) || ['']);
        return Array.from({ length: Math.ceil(lines.length / 12) }, (_, i) =>
          lines.slice(i * 12, i * 12 + 12).join('\n'),
        );
      })()
    : [];
  const toggle = async () => {
    if (!selected) return;
    try {
      await save({
        ...config,
        pluginEnabled: { ...config.pluginEnabled, [selected.id]: !selected.enabled },
      });
      setStatus('Plugin setting saved.');
    } catch {
      setStatus('Unable to change plugin.');
    }
  };
  const connect = async () => {
    if (!selected) return;
    setConnecting(true);
    try {
      setPlugins(
        await unwrap(
          selected.status === 'connected'
            ? window.jarvis!.disconnectPlugin(selected.id)
            : window.jarvis!.connectPlugin(selected.id),
        ),
      );
      setStatus('Connection updated.');
    } catch {
      setStatus('Connection failed. Check server settings and permissions.');
    } finally {
      setConnecting(false);
    }
  };
  return (
    <div className="control-content plugin-manager">
      {edit ? (
        <>
          <h3>{permissionPage ? 'SERVER PERMISSIONS' : 'MCP CONNECTION'}</h3>
          {!permissionPage ? (
            <>
              {(['id', 'name', 'transport', 'url', 'command', 'args'] as const).map((key) => (
                <label className="setting-row" key={key}>
                  <span>{key.toUpperCase()}</span>
                  {key === 'transport' ? (
                    <select
                      value={server.transport}
                      onChange={(e) =>
                        setServer({ ...server, transport: e.target.value as 'http' | 'stdio' })
                      }
                    >
                      <option>http</option>
                      <option>stdio</option>
                    </select>
                  ) : (
                    <input
                      value={key === 'args' ? server.args.join(' | ') : server[key]}
                      placeholder={key === 'args' ? 'Arguments separated by |' : ''}
                      onChange={(e) =>
                        setServer({
                          ...server,
                          [key]:
                            key === 'args'
                              ? e.target.value
                                  .split('|')
                                  .map((v) => v.trim())
                                  .filter(Boolean)
                              : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
              ))}
            </>
          ) : (
            <div className="capability-grid">
              {permissionNames.map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={server.permissions.includes(p)}
                    onChange={(e) =>
                      setServer({
                        ...server,
                        permissions: e.target.checked
                          ? [...server.permissions, p]
                          : server.permissions.filter((x) => x !== p),
                      })
                    }
                  />
                  {p}
                </label>
              ))}
            </div>
          )}
          <p className="help">
            Use an installed trusted server. New connections start disabled. External tool calls
            require approval. Enter credentials only in the encrypted token field.
          </p>
          <div className="inline-actions">
            <button onClick={() => setPermissionPage((v) => !v)}>
              {permissionPage ? 'CONNECTION' : 'PERMISSIONS'}
            </button>
            <button
              onClick={async () => {
                try {
                  await save({
                    ...config,
                    mcpServers: [...config.mcpServers.filter((s) => s.id !== server.id), server],
                  });
                  setEdit(false);
                  setStatus('Server saved; review and enable it.');
                } catch {
                  setStatus('Invalid server fields. Check ID, URL and permissions.');
                }
              }}
            >
              SAVE SERVER
            </button>
            <button onClick={() => setEdit(false)}>BACK</button>
          </div>
        </>
      ) : (
        <>
          <label className="setting-row">
            <span>Installed plugin</span>
            <select
              value={index}
              onChange={(e) => {
                setIndex(Number(e.target.value));
                setToolPage(0);
                setInspect(null);
              }}
            >
              {plugins.map((p, i) => (
                <option key={p.id} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <div className="plugin-status">
                <b>{selected.name}</b>
                <span>
                  {selected.status.toUpperCase()} · {selected.tools.length} TOOLS
                </span>
              </div>
              <label className="setting-row">
                <span>Enabled</span>
                <input type="checkbox" checked={selected.enabled} onChange={() => void toggle()} />
              </label>
              <p className="permission-summary">
                {selected.permissions.join(' · ') || 'NO DEVICE PERMISSIONS'}
              </p>
              <div className="inline-actions">
                <button onClick={() => setToolView(false)}>CONNECTION</button>
                <button onClick={() => setToolView(true)}>TOOLS & RISKS</button>
              </div>
              {toolView && (
                <>
                  {inspected ? (
                    <>
                      <b>{inspected.name}</b>
                      <pre className="schema-view">{schemaParts[schemaPage]}</pre>
                      <Pager
                        index={schemaPage}
                        count={schemaParts.length}
                        onChange={setSchemaPage}
                      />
                      <button onClick={() => setInspect(null)}>BACK TO TOOLS</button>
                    </>
                  ) : (
                    <>
                      <div className="tool-inventory">
                        {selected.tools.slice(toolPage * 2, toolPage * 2 + 2).map((t) => (
                          <article key={t.name}>
                            <b>{t.name}</b>
                            <p>{t.description}</p>
                            <small>
                              {t.permitted ? 'PERMITTED' : 'DISABLED'} ·{' '}
                              {t.confirmation ? 'CONFIRMATION' : 'AUTOMATIC'}
                            </small>
                            <button
                              onClick={() => {
                                setInspect(t.name);
                                setSchemaPage(0);
                              }}
                            >
                              VIEW SCHEMA
                            </button>
                          </article>
                        ))}
                      </div>
                      <Pager
                        index={toolPage}
                        count={Math.max(1, Math.ceil(selected.tools.length / 2))}
                        onChange={setToolPage}
                      />
                    </>
                  )}
                </>
              )}
              {!toolView && !selected.builtin && (
                <>
                  <Credentials name={'mcp:' + selected.id} />
                  <button disabled={!selected.enabled || connecting} onClick={() => void connect()}>
                    {connecting
                      ? 'CONNECTING'
                      : selected.status === 'connected'
                        ? 'DISCONNECT'
                        : 'CONNECT'}
                  </button>
                </>
              )}
            </>
          )}
          <div className="inline-actions">
            <button
              onClick={() => {
                setServer({
                  id: '',
                  name: '',
                  transport: 'http',
                  url: '',
                  command: '',
                  args: [],
                  permissions: [],
                });
                setPermissionPage(false);
                setEdit(true);
              }}
            >
              ADD MCP SERVER
            </button>
            {selected && !selected.builtin && (
              <button
                onClick={() => {
                  const found = config.mcpServers.find((s) => s.id === selected.id);
                  if (found) {
                    setServer(found);
                    setPermissionPage(false);
                    setEdit(true);
                  }
                }}
              >
                EDIT SERVER
              </button>
            )}
          </div>
        </>
      )}
      {status && (
        <p className="help" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
