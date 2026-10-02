const test = require('node:test');
const assert = require('node:assert/strict');
const { Planner } = require('../core/planner.cjs');
const { BrowserAgent } = require('../core/browser-agent.cjs');
const { fastIntent } = require('../core/agent-intake.cjs');
const { publicError } = require('../core/agent-errors.cjs');
const { validate } = require('../core/tools.cjs');

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
