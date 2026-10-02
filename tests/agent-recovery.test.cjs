const test = require('node:test');
const assert = require('node:assert/strict');
const { Planner } = require('../core/planner.cjs');
const { BrowserAgent } = require('../core/browser-agent.cjs');
const { fastIntent } = require('../core/agent-intake.cjs');
const { publicError } = require('../core/agent-errors.cjs');
const { validate } = require('../core/tools.cjs');
const { ScreenContext } = require('../core/screen-context.cjs');

test('ordinary typing runs automatically while sensitive typing still needs approval', () => {
  assert.equal(validate({ tool: 'type_text', args: { text: 'MrBeast', label: 'Search' } }).risk, 1);
  assert.equal(
    validate({ tool: 'type_text', args: { text: 'a command', confirmSensitive: true } }).risk,
    2,
  );
  assert.throws(() =>
    validate({ tool: 'type_text', args: { text: 'a command', allowSensitive: true } }),
  );
  assert.equal(validate({ tool: 'run_powershell', args: { command: 'Get-Date' } }).risk, 3);
});

test('voice priority cancels and suppresses background analysis', async () => {
  let probed = 0;
  const context = new ScreenContext({
    config: () => ({ vision: 'continuous' }),
    busy: () => false,
    probe: async () => {
      probed++;
    },
  });
  context.analysisController = new AbortController();
  context.prioritizeVoice();
  assert.equal(context.analysisController.signal.aborted, true);
  await context.tick();
  assert.equal(probed, 0);
});

test('a fresh image is encoded once rather than on every tool continuation', async () => {
  const agent = planner(),
    calls = [];
  agent.ollama = {
    chat: async (...args) => {
      calls.push(args);
      return { role: 'assistant', content: 'Ready' };
    },
  };
  agent.controller = new AbortController();
  agent.context.request = 'Inspect this screen';
  agent.messages = [
    { role: 'system', content: 'JARVIS' },
    { role: 'user', content: 'Fresh screen', images: ['fixture'] },
  ];
  agent.visualTurn = true;
  await agent.infer();
  await agent.infer();
  assert.equal(calls[0][2], true);
  assert.equal(calls[1][2], false);
  assert.equal(
    calls[1][0].some((m) => m.images?.length),
    false,
  );
});

test('an action batch takes one fresh follow-up screen observation', async () => {
  const agent = planner();
  let observations = 0;
  agent.config = () => ({ vision: 'manual' });
  agent.controller = new AbortController();
  agent.context.request = 'Open both websites';
  agent.messages = [{ role: 'system', content: 'JARVIS' }];
  agent.active = {
    id: 'fixture',
    status: 'running',
    steps: ['https://www.google.com/', 'https://www.youtube.com/'].map((url) => ({
      ...validate({ tool: 'open_url', args: { url } }),
      status: 'pending',
    })),
  };
  agent.executor.executeResult = async () => ({
    success: true,
    verified: true,
    message: 'Opened',
    observed_result: { url: 'fixture' },
  });
  agent.executor.observe = async () => {
    observations++;
    return { context: {}, image: 'fixture' };
  };
  agent.ollama = { chat: async () => ({ role: 'assistant', content: 'Done.' }) };
  await agent.run();
  assert.equal(observations, 1);
  assert.equal(agent.active.status, 'completed');
});

function planner() {
  return new Planner({
    executor: { host: {} },
    safety: { stop() {} },
    store: { task() {} },
    emit() {},
    audit: { write() {} },
    config: () => ({ websiteAliases: { youtube: 'https://www.youtube.com/' } }),
  });
}

test('screen-relative profile requests never become app launches', async () => {
  const apps = { all: async () => [{ Name: 'Steam', AppID: 'steam' }] };
  assert.equal(await fastIntent('Open the first profile on my stream', {}, apps, {}), null);
  assert.equal((await fastIntent('Jarvis open Steam', {}, apps, {})).tool, 'open_application');
});

test('empty navigation queries are repaired only for an explicitly requested site', () => {
  const agent = planner();
  agent.context.request = 'Open YouTube';
  assert.equal(
    agent.repairCall({
      function: { name: 'search_web', arguments: { site: 'youtube', query: '' } },
    }).tool,
    'open_url',
  );
  agent.context.request = 'Find a video about gardening';
  assert.throws(() =>
    agent.repairCall({
      function: { name: 'search_web', arguments: { site: 'youtube', query: '' } },
    }),
  );
  try {
    validate({ tool: 'search_web', args: { site: 'youtube', query: '' } });
  } catch (error) {
    assert.doesNotMatch(publicError(error), /too_small|minimum|path/);
  }
});

test('speech interrupts playback without abandoning a running action or approval', () => {
  const agent = planner();
  agent.isConversation = false;
  for (const status of ['running', 'waiting']) {
    agent.active = { status, steps: [] };
    assert.equal(agent.bargeIn().taskContinues, true);
    assert.equal(agent.active.status, status);
  }
  agent.busy = true;
  agent.isConversation = true;
  agent.active = { status: 'running', steps: [] };
  assert.equal(agent.bargeIn().taskContinues, false);
  assert.equal(agent.active.status, 'cancelled');
});

test('failed navigation cannot be reported as successful', async () => {
  let dispatched = 0;
  const browser = new BrowserAgent({
    config: () => ({ keyboard: true }),
    emit() {},
    openExternal: async () => {
      dispatched++;
    },
    native: async (tool) => (tool === 'browser_state' ? { windows: [] } : { dispatched: true }),
  });
  browser.verify = async () => ({ verified: false, observed_result: { windows: [] } });
  const outcome = await browser.open('https://www.youtube.com/');
  assert.equal(dispatched, 1);
  assert.equal(outcome.success, false);
  assert.equal(outcome.verified, false);
  assert.match(outcome.message, /couldn’t confirm/);
});

test('a verified website includes the observed destination', async () => {
  const browser = new BrowserAgent({
    config: () => ({}),
    emit() {},
    openExternal: async () => {},
    native: async () => ({
      windows: [{ hwnd: 7, foreground: true, url: 'www.youtube.com', title: 'YouTube' }],
    }),
  });
  const outcome = await browser.open('https://www.youtube.com/');
  assert.equal(outcome.verified, true);
  assert.equal(outcome.observed_result.hwnd, 7);
});

test('uncertain actions override model success claims', () => {
  const agent = planner();
  agent.context.request = 'Open YouTube';
  agent.active = {
    steps: [
      {
        risk: 1,
        result: { success: true, verified: false, message: 'I couldn’t confirm it opened.' },
      },
    ],
  };
  assert.equal(agent.safeReply('Done. YouTube is open.'), 'I couldn’t confirm it opened.');
  agent.active.steps = [];
  assert.doesNotMatch(agent.safeReply('YouTube is already open.'), /already open/);
});
