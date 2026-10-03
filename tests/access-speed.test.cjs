const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const ts = require('typescript');
const {
  chooseApp,
  requiresAppApproval,
  settingsUri,
  resolveFile,
  readFile,
} = require('../core/windows-system.cjs');
const { directIntent, conversationOnly } = require('./legacy/intents.cjs');
const { validate } = require('../core/tools.cjs');
const { Planner } = require('./legacy/planner.cjs');
const { Safety } = require('../core/safety.cjs');
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('installed app routing expands names without guessing ambiguous apps or trusting installer aliases', () => {
  assert.deepEqual(directIntent('open Discord'), {
    tool: 'open_application',
    args: { name: 'Discord' },
  });
  const apps = [
    { Name: 'Discord', AppID: 'discord' },
    { Name: 'Visual Studio Code', AppID: 'code' },
    { Name: 'Visual Studio Installer', AppID: 'install' },
  ];
  assert.equal(chooseApp('discord', apps).selected.AppID, 'discord');
  assert.equal(chooseApp('visual studio', apps).selected, null);
  assert.equal(requiresAppApproval('Visual Studio Installer'), true);
  assert.equal(
    validate({ tool: 'open_application', args: { name: 'Visual Studio Installer' } }).risk,
    3,
  );
  assert.equal(directIntent('open Bluetooth settings').tool, 'open_settings');
  assert.equal(settingsUri('microphone'), 'ms-settings:privacy-microphone');
  assert.throws(() => settingsUri('https://example.com'));
});
test('file scope expands explicitly while selected-folder mode stays restricted', async () => {
  const parent = path.resolve(__dirname, '../tmp');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'access-'));
  assert.equal(path.dirname(root), parent); // Verify the recursive cleanup target.
  try {
    const selected = path.join(root, 'selected');
    await fs.mkdir(selected);
    const other = path.join(root, 'other.txt');
    await fs.writeFile(other, 'fixture content');
    await assert.rejects(resolveFile({ fileRoot: selected, fileAccess: 'selected' }, other));
    assert.equal(
      (await readFile({ fileRoot: selected, fileAccess: 'computer' }, other)).content,
      'fixture content',
    );
    await assert.rejects(
      resolveFile({ fileRoot: selected, fileAccess: 'computer' }, path.parse(root).root, true),
      /drive root/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('general PowerShell, file overwrites and executable paths always retain critical confirmation', async () => {
  const action = {
    tool: 'run_powershell',
    args: { command: 'Set-ItemProperty HKCU:\\Software\\Example -Name Test -Value 1' },
  };
  assert.equal(validate(action).risk, 3);
  assert.equal(
    validate({ tool: 'write_file', args: { path: 'x', content: 'a', overwrite: true } }).risk,
    3,
  );
  assert.equal(validate({ tool: 'launch_executable', args: { path: 'C:\\example.exe' } }).risk, 3);
  let executions = 0;
  const safety = new Safety();
  const planner = new Planner({
    ollama: {
      chat: async () => ({
        tool_calls: [{ function: { name: action.tool, arguments: action.args } }],
      }),
    },
    executor: {
      execute: async () => {
        executions++;
      },
    },
    safety,
    store: { task() {} },
    emit() {},
    audit: { write() {} },
  });
  await planner.command('Run the requested PowerShell settings change');
  assert.equal(planner.active.status, 'waiting');
  assert.equal(executions, 0);
  await planner.confirm([...safety.pending.keys()][0], false);
  assert.equal(planner.active.status, 'cancelled');
  assert.equal(executions, 0);
});
test('ordinary conversation skips tool-schema prefill and streams speech; computer questions keep tools', async () => {
  assert.equal(conversationOnly('Why is the sky blue?'), true);
  assert.equal(conversationOnly('What is on my screen?'), false);
  const events = [];
  let tools;
  const planner = new Planner({
    ollama: {
      chat: async (_messages, schemas, _vision, _signal, delta) => {
        tools = schemas;
        delta('Hello, sir.');
        return { content: 'Hello, sir.' };
      },
    },
    executor: {},
    safety: new Safety(),
    store: { task() {} },
    emit: (type) => events.push(type),
    audit: { write() {} },
  });
  await planner.command('How are you?');
  assert.equal(tools, undefined);
  assert.ok(events.includes('speech-chunk'));
});
test('sentence playback starts before a full reply and cannot replay pre-interruption chunks', async () => {
  const source = await fs.readFile(
    path.resolve(__dirname, '../frontend/speechPlayback.ts'),
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', code)(module.exports, module);
  const played = [],
    synthesis = [];
  let finish;
  const player = new module.exports.SpeechPlayback({
    synthesize: async (text) => {
      synthesis.push(text);
      return text;
    },
    play: (audio) => {
      played.push(audio);
      return {
        done: new Promise((resolve) => {
          finish = resolve;
        }),
        stop: () => finish(),
      };
    },
    state() {},
    error: (error) => {
      throw error;
    },
  });
  player.begin();
  player.append('Hello, sir. ');
  await tick();
  assert.deepEqual(played, ['Hello, sir.']);
  player.append('This is the older reply. ');
  await tick();
  assert.ok(synthesis.includes('This is the older reply.'));
  player.stop();
  player.speak('New request understood.');
  await tick();
  assert.deepEqual(played, ['Hello, sir.', 'New request understood.']);
  finish();
  await tick();
  assert.equal(player.speaking, false);
});
