const test = require('node:test');
const assert = require('node:assert/strict');
const { findControl, actionSignature } = require('../core/control-matching.cjs');
const { ordinaryNavigation } = require('../core/navigation-safety.cjs');
const { Vision } = require('../core/vision.cjs');
const { Executor, validate, toolSchemas } = require('../core/tools.cjs');
const { PluginRegistry } = require('../core/plugins/registry.cjs');
const { schema } = require('../core/config.cjs');
function control(label, kind = 'ButtonControl', x = 50) {
  return { label, kind, x, y: 40, bounds: { x: x - 20, y: 30, width: 40, height: 20 } };
}
test('ordinary control selection works with menus, case, Unicode, mnemonics and role suffixes', () => {
  for (const [request, observed, kind] of [
    ['Library', '&LIBRARY', 'MenuItemControl'],
    ['Reports tab', 'Reports', 'TabItemControl'],
    ['Réglages', 'RÉGLAGES…', 'TextControl'],
    ['Collections', 'Collections (12)', 'CustomControl'],
  ])
    assert.equal(findControl(request, [control(observed, kind)]).label, observed);
});
test('nested text and interactive duplicates collapse without picking arbitrary distinct controls', () => {
  assert.equal(
    findControl('Documents', [control('Documents', 'TextControl'), control('Documents')]).kind,
    'ButtonControl',
  );
  assert.equal(
    findControl('Documents', [control('Documents'), control('Documents', 'ButtonControl', 150)]),
    null,
  );
  assert.equal(
    findControl('Library', [control('Library'), control('Shared Library', 'ButtonControl', 150)])
      .label,
    'Library',
  );
  assert.equal(findControl('Missing', [control('Library')]), null);
});
test('named accessible controls bypass model vision while ambiguous targets keep fallback', async () => {
  let calls = 0;
  const vision = new Vision({
    config: () => ({ vision: 'manual' }),
    ollama: {
      chat: async () => {
        calls++;
        return { content: JSON.stringify({ x: 50, y: 40, confidence: 0.8, label: 'Icon' }) };
      },
    },
  });
  const frame = {
    image: 'fixture',
    width: 200,
    height: 100,
    bounds: { x: 0, y: 0, width: 200, height: 100 },
  };
  assert.equal(
    (await vision.locate('Library', frame, undefined, [control('LIBRARY', 'MenuItemControl')]))
      .source,
    'Windows UI Automation',
  );
  assert.equal(calls, 0);
  await vision.locate('a blue unnamed icon', frame, undefined, []);
  assert.equal(calls, 1);
});
test('navigation uses the selected label rather than the entire utterance and shares target execution', async () => {
  const labels = [];
  const target = { id: 'actual-observed-proof' };
  const ex = new Executor({
    config: () => ({ mouse: true, mock: false }),
    worker: 'unused',
    audit: { write: () => {} },
    host: {
      prepareTarget: async (label) => {
        labels.push(label);
        return target;
      },
      clickTarget: async (t) => ({ verified: t === target }),
    },
  });
  for (const tool of ['navigate_ui', 'click_visible_target']) {
    const action = { tool, args: { label: 'Documents' } };
    action.target = await ex.prepare(
      action,
      undefined,
      'Jarvis please click the Documents button in this application',
    );
    assert.equal((await ex.execute(action)).verified, true);
  }
  assert.deepEqual(labels, ['Documents', 'Documents']);
});
test('navigation has no label whitelist but consequential parent actions still require approval', async () => {
  const c = schema.parse({ mock: false, mouse: true, keyboard: true, vision: 'manual' });
  const registry = new PluginRegistry({
    config: () => c,
    store: {},
    executor: {
      executeResult: async () => ({ success: true }),
      prepare: async () => ({ automaticNavigation: false }),
    },
  });
  const send = registry.validate('navigate_ui', { label: 'Send' });
  await registry.prepare(send);
  await assert.rejects(() => registry.execute(send), /Confirmation/);
  assert.equal(
    ordinaryNavigation(
      { ...control('Account', 'TextControl'), actionLabel: 'Delete account' },
      { application: 'app.exe' },
    ),
    false,
  );
  assert.equal(
    ordinaryNavigation(control('Library', 'TextControl'), { application: 'steamwebhelper.exe' }),
    true,
  );
  assert.equal(
    ordinaryNavigation(control('Off', 'RadioButtonControl'), { application: 'systemsettings.exe' }),
    false,
  );
  assert.equal(
    ordinaryNavigation(
      { ...control('Off', 'CustomControl'), actionLabel: 'Windows Defender protection' },
      { application: 'systemsettings.exe' },
    ),
    false,
  );
  assert.equal(
    ordinaryNavigation(
      { ...control('Library'), contextUnavailable: true },
      { application: 'app.exe' },
    ),
    false,
  );
  assert.throws(() => validate({ tool: 'set_volume', args: { action: 'lower' } }));
  assert.equal(
    validate({ tool: 'set_volume', args: { action: 'lower', percent: 1 } }).args.percent,
    1,
  );
  assert.throws(() => validate({ tool: 'set_volume', args: { action: 'set', percent: 101 } }));
});
test('model schemas preserve numeric bounds, required amounts, defaults and full instructions', () => {
  const tools = toolSchemas(['set_volume', 'fill_search', 'click_visible_target']);
  const volume = tools.find((t) => t.function.name === 'set_volume').function;
  assert.ok(volume.parameters.required.includes('percent'));
  assert.equal(volume.parameters.properties.percent.minimum, 0);
  assert.equal(volume.parameters.properties.percent.maximum, 100);
  assert.ok(volume.parameters.properties.percent.description.includes('one point'));
  const edit = tools.find((t) => t.function.name === 'fill_search').function;
  assert.equal(edit.parameters.properties.text.minLength, 1);
  assert.equal(edit.parameters.properties.text.maxLength, 500);
  assert.equal(edit.parameters.properties.label.default, 'Search');
  assert.ok(
    tools.find((t) => t.function.name === 'click_visible_target').function.description.length > 180,
  );
});
test('volume, settings and fresh accessibility are discoverable in the first general tool list', () => {
  const c = schema.parse({ mock: false, keyboard: true, mouse: true, vision: 'manual' });
  const registry = new PluginRegistry({ config: () => c, store: {}, executor: {} });
  const tools = registry.schemas(new Set()).map((t) => t.function.name);
  for (const name of [
    'set_volume',
    'get_audio_state',
    'media',
    'open_settings',
    'list_ui_elements',
  ])
    assert.ok(tools.includes(name), name);
  assert.equal(
    actionSignature('navigate_ui', { label: 'LIBRARY button' }),
    actionSignature('navigate_ui', { label: 'Library' }),
  );
});
