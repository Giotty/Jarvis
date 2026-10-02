const test = require('node:test');
const assert = require('node:assert/strict');
const { schema } = require('../core/config.cjs');
const { PluginRegistry } = require('../core/plugins/registry.cjs');
const { AgentLoop } = require('../core/agent/agent-loop.cjs');
const { ContextManager } = require('../core/agent/context-manager.cjs');
const { Safety } = require('../core/safety.cjs');
const { safeResponse } = require('../core/agent/response-generator.cjs');
function setup(overrides = {}) {
  const config = schema.parse({
    mock: false,
    memory: true,
    mouse: true,
    keyboard: true,
    browser: true,
    filesystem: true,
    vision: 'manual',
    powershell: true,
    ...overrides,
  });
  const events = [],
    executed = [],
    store = { task: () => {}, memories: () => [], remember: () => [], forget: () => [] };
  const executor = {
    host: { beginTask: () => {}, cancelTask: () => {}, screenState: () => ({}) },
    prepare: async () => ({ id: 'fresh', automaticNavigation: true }),
    executeResult: async (action, signal) => {
      signal.throwIfAborted();
      executed.push(action);
      return { success: true, verified: true, observed_result: { target: action.tool } };
    },
  };
  const emit = (type, data) => events.push({ type, data });
  const registry = new PluginRegistry({
    config: () => config,
    executor,
    store,
    secrets: { get: () => '' },
    emit,
  });
  const replies = [],
    ai = {
      chat: async () => {
        if (!replies.length) throw Error('No scripted reply');
        return typeof replies[0] === 'function' ? replies.shift()() : replies.shift();
      },
    };
  const agent = new AgentLoop({
    config: () => config,
    ai,
    registry,
    executor,
    store,
    safety: new Safety(),
    emit,
    audit: { write: () => {} },
  });
  return { agent, registry, config, executor, store, events, executed, replies, ai };
}
const answer = (content = 'Done.') => ({ role: 'assistant', content });
let id = 0;
const call = (name, args = {}) => ({ id: 'call-' + ++id, function: { name, arguments: args } });
const action = (...tool_calls) => ({ role: 'assistant', content: '', tool_calls });
test('repeated failures with intervening reads stop promptly and leave the next command usable', async () => {
  const s = setup();
  s.executor.prepare = async () => ({ automaticNavigation: true });
  s.executor.executeResult = async (a) => ({
    success: a.tool === 'list_windows',
    verified: a.tool === 'list_windows',
    retryable: true,
  });
  s.replies.push(
    action(call('navigate_ui', { label: 'Library' })),
    action(call('list_windows')),
    action(call('navigate_ui', { label: 'LIBRARY button' })),
    action(call('list_windows')),
    action(call('navigate_ui', { label: 'Library' })),
    answer('This must not run'),
  );
  await s.agent.command('Click the named navigation control.');
  assert.equal(s.agent.active.status, 'failed');
  assert.equal(s.agent.active.steps.length, 5);
  assert.equal(s.agent.busy, false);
  s.replies.length = 0;
  s.replies.push(answer('I am ready.'));
  await s.agent.command('Are you still there?');
  assert.equal(s.agent.active.status, 'completed');
});
test('target preparation has its own timeout and passes cancellation to the locator', async () => {
  const s = setup();
  s.config.toolTimeout = 15;
  let locatorSignal;
  s.executor.prepare = async (_a, signal) => {
    locatorSignal = signal;
    return new Promise(() => {});
  };
  const hold = setTimeout(() => {}, 100);
  try {
    await assert.rejects(
      () => s.registry.prepare(s.registry.validate('navigate_ui', { label: 'Reports' })),
      /timed out/,
    );
    assert.equal(locatorSignal.aborted, true);
  } finally {
    clearTimeout(hold);
  }
});
test('local preference uses the first general inference, then primary planning after tools', async () => {
  const s = setup({ preferLocalSimple: true });
  const decisions = [];
  s.ai.chat = async (...args) => {
    decisions.push(args[5].simple);
    return s.replies.shift();
  };
  s.replies.push(action(call('get_system_stats')), answer('Here are the live resource readings.'));
  await s.agent.command('What resources are constrained?');
  assert.deepEqual(decisions, [true, false]);
  assert.equal(s.agent.active.status, 'completed');
});
test('unseen intention composes discovery, real app selection, launch and focus through model calls', async () => {
  const s = setup();
  s.replies.push(
    action(call('list_installed_apps', { query: 'graphics' })),
    action(call('open_application', { name: 'A discovered editor' })),
    action(call('focus_application', { name: 'A discovered editor' })),
    answer('The editor is open.'),
  );
  await s.agent.command('Bring up an installed graphics editor and put it in front so I can draw.');
  assert.deepEqual(
    s.executed.map((a) => a.tool),
    ['list_installed_apps', 'open_application', 'focus_application'],
  );
  assert.equal(s.agent.active.status, 'completed');
  assert.equal(s.agent.busy, false);
  assert.equal(s.events.at(-1).data, 'IDLE');
});
test('tools expand dynamically without enabling plugins or a command phrase handler', async () => {
  const s = setup();
  let seen;
  const original = s.ai.chat;
  s.ai.chat = async (...args) => {
    seen = args[1];
    return original();
  };
  s.replies.push(
    action(call('discover_tools', { plugin: 'steam' })),
    action(call('list_installed_games')),
    answer('Here are the installed games.'),
  );
  await s.agent.command('Find a game I have not used recently, if its history is available.');
  assert.ok(seen.some((t) => t.function.name === 'list_installed_games'));
  assert.equal(s.executed.length, 1);
  assert.equal(s.executed[0].tool, 'list_installed_games');
  s.config.pluginEnabled.steam = false;
  assert.throws(() => s.registry.validate('list_installed_games', {}), /disabled/);
});
test('bad parameters return structured failures to the model, then recover instead of crashing', async () => {
  const s = setup();
  let observations;
  s.ai.chat = async (messages) => {
    observations = messages;
    return s.replies.shift();
  };
  s.replies.push(
    action(call('web_search', { query: '' })),
    action(call('web_search', { query: 'official drawing shortcuts' })),
    answer('I found a useful source.'),
  );
  await s.agent.command('Look up drawing shortcuts.');
  assert.equal(s.executed.length, 1);
  assert.equal(s.executed[0].args.query, 'official drawing shortcuts');
  assert.equal(s.agent.active.steps[0].result.error, 'invalid_arguments');
  assert.ok(observations.some((m) => m.role === 'tool' && m.tool_call_id));
  assert.equal(s.agent.active.status, 'completed');
});
test('parallel independent reads overlap while mutations remain sequential', async () => {
  const s = setup();
  let active = 0,
    maximum = 0;
  s.executor.executeResult = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((r) => setTimeout(r, 12));
    active--;
    return { success: true, verified: true };
  };
  s.replies.push(
    action(call('get_system_stats'), call('list_running_apps')),
    answer('RAM use is high.'),
  );
  await s.agent.command('Explain the lag using running processes and resource usage.');
  assert.equal(maximum, 2);
  maximum = 0;
  s.replies.push(
    action(
      call('open_application', { name: 'Calculator' }),
      call('focus_application', { name: 'Calculator' }),
    ),
    answer(),
  );
  await s.agent.command('Open Calculator, then focus it.');
  assert.equal(maximum, 1);
});
test('a failed prerequisite prevents pending dependent mutations and does not repeat non-retryable input', async () => {
  const s = setup();
  s.executor.executeResult = async (a) => {
    s.executed.push(a);
    return { success: false, verified: false, retryable: false, message: 'Not available' };
  };
  s.replies.push(
    action(
      call('open_application', { name: 'Missing app' }),
      call('type_text', { text: 'private text' }),
    ),
    action(call('open_application', { name: 'Missing app' })),
    answer('The application is unavailable.'),
  );
  await s.agent.command('Open the missing app and enter text.');
  assert.equal(s.executed.length, 1);
  assert.equal(s.agent.active.steps[1].status, 'skipped');
  assert.equal(s.agent.active.steps[2].result.error, 'invalid_arguments');
});
test('risky action waits for immutable one-use approval and enforces it outside the model', async () => {
  const s = setup();
  s.replies.push(
    action(call('delete_file', { path: 'sandbox.txt' })),
    answer('Recycled the sandbox file.'),
  );
  const running = s.agent.command('Recycle the sandbox file.');
  while (!s.agent.pending) await new Promise((r) => setTimeout(r, 1));
  assert.equal(s.executed.length, 0);
  assert.equal(s.agent.active.status, 'waiting');
  const pending = s.agent.pending;
  await assert.rejects(() => s.agent.confirm('wrong-id', true));
  await s.agent.confirm(pending.id, true);
  await running;
  assert.equal(s.executed.length, 1);
  assert.equal(s.executed[0].args.path, 'sandbox.txt');
  await assert.rejects(() => s.agent.confirm(pending.id, true));
});
test('denial cancels a sequence and next request works without restarting', async () => {
  const s = setup();
  s.replies.push(
    action(
      call('delete_file', { path: 'sandbox.txt' }),
      call('open_application', { name: 'Calculator' }),
    ),
  );
  const running = s.agent.command('Recycle the sandbox and then open Calculator.');
  while (!s.agent.pending) await new Promise((r) => setTimeout(r, 1));
  await s.agent.confirm(s.agent.pending.id, false);
  await running;
  assert.equal(s.executed.length, 0);
  s.replies.push(answer('Hello.'));
  await s.agent.command('How are you?');
  assert.equal(s.agent.active.status, 'completed');
});
test('stop cancels provider generation and a second command remains usable', async () => {
  const s = setup();
  let generationStarted;
  const started = new Promise((r) => {
    generationStarted = r;
  });
  s.ai.chat = (_m, _t, _v, signal) =>
    new Promise((_, reject) => {
      generationStarted();
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  const running = s.agent.command('Consider a plan.');
  await started;
  await s.agent.command('Jarvis, stop');
  await running;
  assert.equal(s.agent.active.status, 'cancelled');
  assert.equal(s.agent.busy, false);
  s.ai.chat = async () => answer('Ready.');
  await s.agent.command('Hello');
  assert.equal(s.agent.active.status, 'completed');
});
test('step limit stops an unbounded model loop', async () => {
  const s = setup({ agentMaxSteps: 3 });
  s.ai.chat = async () => action(call('get_system_stats'));
  await s.agent.command('Keep checking.');
  assert.equal(s.agent.active.steps.length, 3);
  assert.equal(s.agent.active.status, 'failed');
  assert.equal(s.agent.busy, false);
});
test('plugin timeout and crashes are isolated; malformed output is rejected', async () => {
  const s = setup();
  s.config.toolTimeout = 15;
  s.registry.register({
    id: 'broken',
    builtin: true,
    tools: [
      {
        name: 'broken_test',
        description: 'Test',
        inputSchema: { type: 'object' },
        permissions: [],
        risk: 0,
        parallelSafe: true,
        execute: () => new Promise(() => {}),
      },
    ],
  });
  const keepAlive = setTimeout(() => {}, 50);
  const r = await s.registry.execute(s.registry.validate('broken_test', {}));
  clearTimeout(keepAlive);
  assert.equal(r.error, 'tool_timeout');
  s.registry.plugins.get('broken').tools[0].execute = async () => {
    throw Error('private traceback');
  };
  assert.equal((await s.registry.execute(s.registry.validate('broken_test', {}))).success, false);
  s.registry.register({
    id: 'invalidoutput',
    builtin: true,
    tools: [
      {
        name: 'bad_output',
        description: 'Test',
        inputSchema: { type: 'object' },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
          required: ['success'],
        },
        permissions: [],
        risk: 0,
        execute: async () => ({ success: 'yes' }),
      },
    ],
  });
  assert.equal((await s.registry.execute(s.registry.validate('bad_output', {}))).success, false);
});
test('disabled plugins, disabled permissions, and spoofed safe targets cannot bypass safety', async () => {
  const s = setup();
  s.config.keyboard = false;
  assert.throws(() => s.registry.validate('type_text', { text: 'Hello' }), /permission/);
  s.config.pluginEnabled.browser = false;
  assert.equal(
    s.registry.schemas().some((t) => t.function.name === 'open_url'),
    false,
  );
  await assert.rejects(
    () =>
      s.registry.execute({
        tool: 'click_mouse',
        args: { x: 10, y: 10 },
        risk: 0,
        target: { automaticNavigation: true },
      }),
    /Confirmation/,
  );
});
test('host-certified ordinary navigation clicks automatically without blanket mouse access', async () => {
  const s = setup();
  s.replies.push(
    action(call('click_visible_target', { label: 'First safe navigation item' })),
    answer(),
  );
  await s.agent.command('Select the first visible navigation item.');
  assert.equal(s.executed.length, 1);
  assert.equal(
    s.events.some((e) => e.type === 'confirmation' && e.data),
    false,
  );
});
test('MCP tools are dynamically discovered, require approval regardless of server annotations and disconnect on disable', async () => {
  const s = setup();
  const server = {
    id: 'external',
    name: 'Example',
    transport: 'http',
    url: 'https://example.com/mcp',
    permissions: ['FILES_READ'],
  };
  s.config.mcpServers = [server];
  s.config.pluginEnabled.external = true;
  let closed = 0,
    calls = 0;
  s.registry.connector = () => ({
    server,
    connect: async () => [
      {
        name: 'custom_tool',
        description: 'Arbitrary tool',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      },
    ],
    call: async () => {
      calls++;
      return { success: true, verified: false };
    },
    close: async () => {
      closed++;
    },
  });
  await s.registry.connect('external');
  assert.equal(s.registry.list().find((p) => p.id === 'external').status, 'connected');
  const a = s.registry.validate('mcp_external_custom_tool', {});
  assert.equal(a.risk, 2);
  await assert.rejects(() => s.registry.execute(a), /Confirmation/);
  assert.equal(calls, 0);
  await s.registry.execute(a, undefined, true);
  assert.equal(calls, 1);
  s.config.pluginEnabled.external = false;
  await s.registry.reconcile();
  assert.equal(closed, 1);
  assert.equal(
    s.registry.schemas().some((t) => t.function.name === 'mcp_external_custom_tool'),
    false,
  );
});
test('context selection retains complete tool call/result pairs and the current request', () => {
  const c = new ContextManager();
  c.history = [
    { role: 'user', content: 'Old request' },
    { role: 'assistant', content: 'Old reply' },
  ];
  const m = c.begin('Actual request', schema.parse({}), [], null);
  for (let i = 0; i < 5; i++)
    m.push(action(call('inspect')), {
      role: 'tool',
      tool_call_id: 'call-' + id,
      content: 'x'.repeat(300),
    });
  const selected = c.select(m, 700);
  assert.ok(selected.some((m) => m.content === 'Actual request'));
  for (const m of selected.filter((m) => m.role === 'tool'))
    assert.ok(selected.some((a) => a.tool_calls?.some((call) => call.id === m.tool_call_id)));
});
test('unverified dispatches and raw error dumps cannot become success claims', () => {
  assert.equal(
    safeResponse('Done.', [
      {
        tool: 'open_application',
        risk: 1,
        status: 'failed',
        result: { success: false, message: 'The app did not open.' },
      },
    ]),
    'The app did not open.',
  );
  assert.match(
    safeResponse('YouTube is open.', [
      { risk: 1, status: 'done', result: { success: true, verified: false } },
    ]),
    /couldn’t verify/,
  );
  assert.equal(safeResponse('Traceback: ugly stack', []).includes('Traceback'), false);
  assert.match(safeResponse('I opened Steam.', []), /haven’t verified/);
});
test('restricted task contents stay local even after context pruning removes their original result', async () => {
  const s = setup({ cloudEnabled: true, provider: 'openai', cloudFiles: false });
  const routing = [],
    original = s.ai.chat;
  s.ai.chat = async (...args) => {
    routing.push(args[5]);
    return original();
  };
  s.replies.push(
    action(call('read_file', { path: 'sandbox.txt' })),
    action(call('get_system_stats')),
    answer('The file information is available locally.'),
  );
  await s.agent.command('Read the sandbox file, then check resources.');
  assert.equal(routing[0].localOnly, false);
  assert.equal(routing[1].localOnly, true);
  assert.equal(routing[2].localOnly, true);
  assert.equal(s.agent.context.history.at(-1)._privacy, 'sensitive');
});
test('approval expiry cancels the waiting task and releases the next command', async () => {
  const s = setup(),
    requireApproval = s.agent.safety.require.bind(s.agent.safety);
  s.agent.safety.require = (...args) => {
    const request = requireApproval(...args);
    request.expires = Date.now() + 10;
    return request;
  };
  s.replies.push(action(call('delete_file', { path: 'sandbox.txt' })));
  await s.agent.command('Recycle the sandbox file.');
  assert.equal(s.agent.active.status, 'cancelled');
  assert.equal(s.executed.length, 0);
  assert.equal(s.agent.busy, false);
  s.replies.push(answer('Ready.'));
  await s.agent.command('Hello');
  assert.equal(s.agent.active.status, 'completed');
});
test('disabled screen plugin removes cached screen contents from agent context', async () => {
  const s = setup({ pluginEnabled: { screen: false } });
  s.executor.host.screenState = () => ({
    activeWindow: { title: 'Private screen title' },
    summary: 'Private screen contents',
  });
  let input;
  s.ai.chat = async (messages) => {
    input = messages;
    return answer('Hello.');
  };
  await s.agent.command('Hello');
  assert.equal(JSON.stringify(input).includes('Private screen'), false);
  assert.equal(
    s.registry.schemas().some((t) => t.function.name === 'capture_screen'),
    false,
  );
});
