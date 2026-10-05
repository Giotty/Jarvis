const Ajv = require('ajv');
const { builtins } = require('./builtins.cjs');
const { MCPConnection } = require('./mcp.cjs');
const { failure, result } = require('../agent-errors.cjs');
const flags = {
  MOUSE_CONTROL: 'mouse',
  KEYBOARD_CONTROL: 'keyboard',
  BROWSER_CONTROL: 'browser',
  FILES_READ: 'filesystem',
  FILES_WRITE: 'filesystem',
  SYSTEM_CONTROL: 'powershell',
  PROCESS_CONTROL: 'browser',
  BLENDER_CONTROL: 'blenderEnabled',
};
class PluginRegistry {
  constructor({
    config,
    executor,
    store,
    secrets,
    emit = () => {},
    connector = (s) => new MCPConnection(s, secrets),
  }) {
    Object.assign(this, { config, executor, store, secrets, emit, connector });
    this.plugins = new Map();
    this.connections = new Map();
    this.ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
    this.certifiedTargets = new WeakSet();
    for (const plugin of builtins(executor, store, emit)) this.register(plugin);
    this.register({
      id: 'toolkit',
      name: 'TOOL DISCOVERY',
      builtin: true,
      tools: [
        {
          name: 'discover_tools',
          description:
            'Discover the tools of an enabled plugin by its ID. Loads its schemas for this task; cannot enable disabled plugins or grant permissions.',
          inputSchema: {
            type: 'object',
            properties: { plugin: { type: 'string' } },
            required: ['plugin'],
            additionalProperties: false,
          },
          risk: 0,
          permissions: [],
          execute: async ({ args }) => {
            if (!this.enabled(args.plugin)) throw Error('Plugin disabled or unavailable.');
            return {
              success: true,
              verified: true,
              plugin: args.plugin,
              tools: this.plugins
                .get(args.plugin)
                .tools.filter((t) => this.permitted(t))
                .map((t) => ({ name: t.name, description: t.description })),
            };
          },
        },
      ],
    });
  }
  register(plugin) {
    if (this.plugins.has(plugin.id)) throw Error('Duplicate plugin');
    const tools = plugin.tools.map((tool) => {
      if (
        !/^[a-zA-Z0-9_-]+$/.test(tool.name) ||
        !Array.isArray(tool.permissions) ||
        !Number.isInteger(tool.risk) ||
        tool.risk < 0 ||
        tool.risk > 3
      )
        throw Error('Invalid plugin manifest.');
      return {
        ...tool,
        validateJSON: this.ajv.compile(tool.inputSchema),
        validateOutput: tool.outputSchema ? this.ajv.compile(tool.outputSchema) : null,
      };
    });
    const names = new Set([...this.plugins.values()].flatMap((p) => p.tools.map((t) => t.name)));
    for (const tool of tools) {
      if (names.has(tool.name) || tool.name.length > 64)
        throw Error('Duplicate or invalid plugin tool name.');
      names.add(tool.name);
    }
    this.plugins.set(plugin.id, { ...plugin, tools, status: 'connected' });
  }
  enabled(id) {
    const p = this.plugins.get(id);
    return (
      p &&
      this.config().pluginEnabled?.[id] !== false &&
      (p.builtin || this.config().pluginEnabled?.[id] === true) &&
      !(id === 'memory' && !this.config().memory)
    );
  }
  permitted(tool) {
    const c = this.config();
    return tool.permissions.every((p) =>
      p === 'SCREEN_READ' ? c.vision !== 'off' : !flags[p] || c[flags[p]],
    );
  }
  list() {
    const enabled = this.config().pluginEnabled || {};
    const entries = [...this.plugins.values()].map((p) => ({
      id: p.id,
      name: p.name,
      builtin: !!p.builtin,
      enabled: !!this.enabled(p.id),
      status: p.status,
      permissions: [...new Set(p.tools.flatMap((t) => t.permissions))],
      tools: p.tools.map((t) => ({
        name: t.name,
        description: t.description,
        provider: p.id,
        availability: p.availability?.() || p.status,
        timeout:
          p.id === 'blender'
            ? t.name === 'blender_design'
              ? 1800000
              : this.config().blenderTimeout || 90000
            : this.config().toolTimeout || 30000,
        readOnly: t.risk === 0,
        risk: t.risk,
        confirmation: t.risk >= 2,
        permissions: t.permissions,
        permitted: this.permitted(t),
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
      })),
    }));
    for (const s of this.config().mcpServers || [])
      if (!this.plugins.has(s.id))
        entries.push({
          id: s.id,
          name: s.name,
          builtin: false,
          enabled: enabled[s.id] === true,
          status: 'disconnected',
          permissions: s.permissions,
          tools: [],
        });
    return entries;
  }
  schemas(loaded) {
    const base = require('../agent-capabilities.cjs')
      .toolNames()
      .filter((name) => name !== 'enable_tools');
    return [...this.plugins.values()]
      .filter((p) => this.enabled(p.id))
      .flatMap((p) =>
        p.tools
          .filter(
            (t) =>
              this.permitted(t) &&
              (!loaded || loaded.has(p.id) || base.includes(t.name) || t.name === 'discover_tools'),
          )
          .map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
      );
  }
  find(name) {
    for (const p of this.plugins.values()) {
      const tool = p.tools.find((t) => t.name === name);
      if (tool) return { plugin: p, tool };
    }
    throw Error('Unknown or disconnected plugin tool.');
  }
  validate(name, args) {
    const { plugin, tool } = this.find(name);
    if (!this.enabled(plugin.id)) throw Error('Plugin disabled.');
    if (!this.permitted(tool)) throw Error('Plugin permission disabled.');
    if (!args || typeof args !== 'object' || Array.isArray(args) || !tool.validateJSON(args))
      throw Error('Invalid tool arguments. Check the input schema and required fields.');
    const action = tool.validate
      ? tool.validate(args)
      : { tool: name, args: structuredClone(args), risk: tool.risk };
    return {
      ...action,
      plugin: plugin.id,
      parallelSafe: tool.parallelSafe === true && action.risk === 0,
      privacy:
        plugin.builtin && Object.hasOwn(action, 'privacy')
          ? action.privacy
          : action.privacy || tool.privacy || (!plugin.builtin ? 'external' : undefined),
    };
  }
  async prepare(action, signal, goal) {
    const { tool } = this.find(action.tool);
    if (tool.prepare) {
      const timeout = AbortSignal.timeout(this.config().toolTimeout || 30000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let abort;
      const interrupted = new Promise((_, reject) => {
        abort = () => reject(Error('Target preparation timed out or cancelled.'));
        combined.addEventListener('abort', abort, { once: true });
      });
      try {
        combined.throwIfAborted();
        action.target = await Promise.race([tool.prepare(action, combined, goal), interrupted]);
      } finally {
        combined.removeEventListener('abort', abort);
      }
      if (action.target?.automaticNavigation === true) {
        this.certifiedTargets.add(action.target);
        action.risk = 1;
      }
    }
    return action;
  }
  async execute(action, signal, approved = false) {
    // Recheck current permissions immediately before executing a frozen approval.
    const validated = this.validate(action.tool, action.args),
      { tool } = this.find(action.tool);
    if (
      Math.max(validated.risk, action.risk) >= 2 &&
      !approved &&
      !this.certifiedTargets.has(action.target)
    )
      throw Error('Confirmation required.');
    const timeout = AbortSignal.timeout(
      this.find(action.tool).plugin.id === 'blender'
        ? Math.min(
            action.tool === 'blender_design' ? 1800000 : 300000,
            action.tool === 'blender_design'
              ? 1800000
              : this.config().blenderTimeout || 90000,
          )
        : this.config().toolTimeout || 30000,
    );
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(Error('Plugin timed out or cancelled.'));
      combined.addEventListener('abort', abort, { once: true });
    });
    try {
      combined.throwIfAborted();
      if (this.config().mock && !this.find(action.tool).plugin.builtin)
        return result({ mock: true, verified: false, message: 'Plugin action simulated.' });
      const raw = await Promise.race([tool.execute(action, combined), interrupted]);
      if (
        tool.validateOutput &&
        !tool.validateOutput(this.find(action.tool).plugin.builtin ? raw : raw.observed_result)
      )
        throw Error('Invalid plugin output schema.');
      return result(raw);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.emit('tool-diagnostic', {
        tool: action.tool,
        code: error.code || error.name,
        error: require('../providers/diagnostics.cjs').safeError(error.message),
        issues: error.issues?.map((i) => ({ code: i.code, path: i.path })),
      });
      return failure(
        error,
        timeout.aborted ? 'tool_timeout' : 'plugin_failed',
        action.parallelSafe,
      );
    } finally {
      combined.removeEventListener('abort', abort);
    }
  }
  async connect(id, signal) {
    const s = this.config().mcpServers.find((s) => s.id === id);
    if (!s || this.config().pluginEnabled[id] !== true)
      throw Error('Enable and review this plugin first.');
    if (this.plugins.get(id)?.builtin) throw Error('Reserved built-in plugin name.');
    await this.disconnect(id);
    const connection = this.connector(s);
    try {
      const discovered = await connection.connect(signal);
      this.register({
        id,
        name: s.name,
        builtin: false,
        tools: discovered.map((t) => ({
          name: 'mcp_' + id + '_' + t.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
          description: (t.description || t.name).slice(0, 1000),
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          permissions: s.permissions,
          risk: 2,
          parallelSafe: false,
          execute: ({ args }, signal) =>
            connection.call(t.name, args, signal, this.config().toolTimeout),
        })),
      });
      this.connections.set(id, connection);
    } catch {
      await connection.close();
      throw Error('Plugin could not connect. Check server settings and credentials.');
    }
    this.emit('plugins', this.list());
    return this.list();
  }
  async disconnect(id) {
    await this.connections.get(id)?.close();
    this.connections.delete(id);
    if (!this.plugins.get(id)?.builtin) this.plugins.delete(id);
  }
  async reconcile() {
    for (const id of this.connections.keys())
      if (
        this.config().pluginEnabled[id] !== true ||
        !this.config().mcpServers.some(
          (s) =>
            s.id === id && JSON.stringify(s) === JSON.stringify(this.connections.get(id).server),
        )
      )
        await this.disconnect(id);
    this.emit('plugins', this.list());
  }
  async close() {
    await Promise.allSettled([...this.connections.keys()].map((id) => this.disconnect(id)));
  }
}
module.exports = { PluginRegistry };
