const { test } = require('node:test');
const assert = require('node:assert/strict');
const { directIntent, screenRequest } = require('./legacy/intents.cjs');
const { ScreenTargets } = require('../core/screen-targets.cjs');
const { WindowsApps } = require('../core/windows-system.cjs');
const { Planner } = require('./legacy/planner.cjs');
const { Safety } = require('../core/safety.cjs');
const { Vision } = require('../core/vision.cjs');
test('reported profile requests route to screen targets, while Steam and Epic launch normally', () => {
  for (const text of [
    'Open the first profile',
    'Could you please click on the first profile in this team launcher?',
    'Jarvis, look at this Steam map and open the first profile out of the two profiles in this Steam map.',
    'Jarvis, open the first profile out of the two inside of this team app.',
  ]) {
    assert.equal(directIntent(text).tool, 'click_visible_target', text);
  }
  assert.equal(directIntent('Alright, Jarvis, can you please open the steam?').args.name, 'Steam');
  assert.equal(
    directIntent('Could you please open the Epic Game launcher?').args.name,
    'Epic Games Launcher',
  );
  assert.equal(directIntent('open Discord').tool, 'open_application');
  assert.equal(screenRequest("don't click the first profile"), null);
  assert.equal(screenRequest('What do you see?').click, false);
});
test('Win32 known-folder paths and Store app IDs dispatch through separate launchers', async () => {
  const apps = new WindowsApps();
  apps.all = async () => [
    { Name: 'Steam', AppID: '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\Steam\\Steam.exe' },
    { Name: 'Store App', AppID: 'Package_123!App' },
    {
      Name: 'Uninstall Example',
      AppID: '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\Example\\unins.exe',
    },
  ];
  const calls = [];
  const namespace = async (id) => calls.push(['namespace', id]);
  const desktop = async (id, risk) => calls.push(['desktop', id, risk]);
  await apps.open('Steam', 1, namespace, desktop);
  await apps.open('Store App', 1, namespace, desktop);
  assert.equal(calls[0][0], 'desktop');
  assert.deepEqual(calls[1], ['namespace', 'shell:AppsFolder\\Package_123!App']);
  await assert.rejects(apps.open('Uninstall Example', 1, namespace, desktop), /confirmation/);
  assert.equal(calls.length, 2);
});
function fixture() {
  let window = {
    hwnd: 12,
    pid: 34,
    title: 'Steam',
    bounds: { x: 0, y: 0, width: 1000, height: 700 },
  };
  let pixels = Buffer.alloc(16, 30),
    clicks = 0;
  const targets = new ScreenTargets({
    withTarget: (fn) => fn(),
    window: async () => window,
    capture: async () => ({ bounds: window.bounds, pixels }),
    locate: async () => ({ x: 150, y: 200, label: 'Account A' }),
    fingerprint: (frame) => Buffer.from(frame.pixels),
    click: async () => {
      clicks++;
      return { dispatched: true };
    },
  });
  return {
    targets,
    get clicks() {
      return clicks;
    },
    switchWindow: () => {
      window = { ...window, hwnd: 99 };
    },
    changeTarget: () => {
      pixels = Buffer.alloc(16, 180);
    },
  };
}
test('an observed target is single-use and changed windows or target images cannot be clicked', async () => {
  const good = fixture();
  const review = await good.targets.prepare('first profile');
  assert.equal(good.clicks, 0);
  assert.equal(review.windowTitle, 'Steam');
  assert.equal((await good.targets.execute(review)).dispatched, true);
  assert.equal(good.clicks, 1);
  await assert.rejects(good.targets.execute(review), /expired/);
  for (const mutation of ['switchWindow', 'changeTarget']) {
    const f = fixture();
    const target = await f.targets.prepare('first profile');
    f[mutation]();
    await assert.rejects(f.targets.execute(target), /changed/);
    assert.equal(f.clicks, 0);
  }
});
function planner(executor, ollama) {
  return new Planner({
    executor,
    ollama,
    safety: new Safety(),
    store: { task() {} },
    audit: { write() {} },
    emit() {},
  });
}
test('screen questions receive a screenshot before inference, and profile clicks locate before approval', async () => {
  let observed = false;
  const p = planner(
    {
      observe: async () => {
        observed = true;
        return { image: 'fixture', context: { title: 'Steam' } };
      },
    },
    {
      chat: async (messages, _tools, vision) => {
        assert.equal(observed, true);
        assert.equal(vision, true);
        assert.deepEqual(messages.at(-1).images, ['fixture']);
        return { content: 'Two Steam profiles are visible.' };
      },
    },
  );
  await p.command('What is on my screen?');
  let prepared = false,
    executed = false;
  const click = planner(
    {
      observe: async () => ({ image: 'fixture', context: { title: 'Steam' } }),
      prepare: async () => {
        prepared = true;
        return { id: 'target', label: 'Account A', windowTitle: 'Steam', x: 150, y: 200 };
      },
      execute: async (action) => {
        assert.equal(action.target.label, 'Account A');
        executed = true;
        return { message: 'Clicked Account A.' };
      },
    },
    {
      chat: async (messages) =>
        messages.some((m) => m.role === 'tool')
          ? { content: 'Clicked Account A.' }
          : {
              tool_calls: [
                {
                  function: { name: 'click_visible_target', arguments: { label: 'first profile' } },
                },
              ],
            },
    },
  );
  await click.command('Open the first profile');
  assert.equal(prepared, true);
  assert.equal(executed, false);
  assert.equal(click.active.status, 'waiting');
  const pending = [...click.safety.pending.values()][0];
  assert.equal(pending.action.target.windowTitle, 'Steam');
  await click.confirm(pending.id, true);
  assert.equal(executed, true);
});
test('vision maps screenshot pixels and actual accessible target centers to physical coordinates', async () => {
  const frame = {
    image: 'fixture',
    width: 1000,
    height: 700,
    bounds: { x: 1920, y: 0, width: 2000, height: 1400 },
    monitor: '2',
  };
  let reply = { x: 250, y: 200, confidence: 0.9, label: 'First profile' };
  const vision = new Vision({
    config: () => ({ vision: 'manual' }),
    capture: async () => frame,
    ollama: { chat: async () => ({ content: JSON.stringify(reply) }) },
  });
  assert.deepEqual((({ x, y }) => ({ x, y }))(await vision.locate('first profile')), {
    x: 2420,
    y: 400,
  });
  reply = { accessibleIndex: 0, confidence: 0.95 };
  const result = await vision.locate('first profile', frame, undefined, [
    { x: 2441, y: 401, label: 'Account A', kind: 'ButtonControl' },
  ]);
  assert.equal(result.x, 2441);
  assert.equal(result.label, 'Account A');
});
