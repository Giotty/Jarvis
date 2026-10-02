const { test } = require('node:test');
const assert = require('node:assert/strict');
const { targetWindow } = require('../core/window-target.cjs');
const { directIntent, earlyIntent } = require('../core/intents.cjs');
const { validate } = require('../core/tools.cjs');
const { Planner } = require('../core/planner.cjs');
const { Safety } = require('../core/safety.cjs');
const fs = require('node:fs');
const ts = require('typescript');

test('failed and nested automation always restores a previously visible HUD', async () => {
  let visible = true;
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => false,
    hide() {
      visible = false;
      calls.push('hide');
    },
    showInactive() {
      visible = true;
      calls.push('restore');
    },
  };
  const target = targetWindow(
    () => win,
    async () => {},
  );
  await assert.rejects(
    target(() =>
      target(async () => {
        throw Error('No confident target');
      }),
    ),
    /No confident target/,
  );
  assert.equal(visible, true);
  assert.deepEqual(calls, ['hide', 'restore']);
  visible = false;
  calls.length = 0;
  await target(async () => 'done');
  assert.deepEqual(calls, []);
});

test('ordinal video navigation is automatic and general clicks remain guarded', () => {
  assert.deepEqual(directIntent('click on the first video on the page'), {
    tool: 'open_youtube_result',
    args: { index: 1 },
  });
  assert.equal(directIntent('open the third video on YouTube').args.index, 3);
  assert.equal(validate(directIntent('play the second video')).risk, 1);
  assert.equal(validate({ tool: 'click_mouse', args: { x: 1, y: 2 } }).risk, 2);
  assert.equal(validate({ tool: 'delete_file', args: { path: 'x' } }).risk, 3);
});

test('partial transcripts cannot execute games, arbitrary forms, or destructive actions', () => {
  assert.equal(earlyIntent('open YouTube and search MrBeast').tool, 'open_url');
  for (const text of [
    'open Roblox',
    'delete files',
    'send a message',
    'click first video',
    'open YouTube and delete files',
    "don't open YouTube",
    'open YouTube unless I say yes',
  ])
    assert.equal(earlyIntent(text), null);
});

test('partial speech cannot launch an app before the complete request arrives', async () => {
  const actions = [],
    events = [];
  const p = new Planner({
    config: () => ({
      conversationMode: true,
      websiteAliases: { youtube: 'https://www.youtube.com/' },
    }),
    executor: {
      execute: async (action) => {
        actions.push(action);
        return { success: true };
      },
    },
    ollama: {
      chat: () => {
        throw Error('No inference necessary');
      },
    },
    safety: new Safety(),
    store: { task() {} },
    audit: { write() {} },
    emit: (type, data) => events.push({ type, data }),
  });
  assert.equal((await p.preview('open YouTube', 'turn')).started, false);
  await p.preview('open YouTube', 'turn');
  await p.command('open YouTube', 'turn');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].args.url, 'https://www.youtube.com/');
  assert.equal(
    events.some((e) => e.type === 'confirmation'),
    false,
  );
  p.config = () => ({ conversationMode: false });
  assert.equal((await p.preview('open calculator', 'next')).started, false);
});

function captureModule() {
  const code = ts.transpileModule(
    fs.readFileSync(require.resolve('../frontend/speechCapture.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', code)(module.exports, module);
  return module.exports;
}
test('capture ignores silence, emits a turn after a brief pause, then detects interruption', () => {
  const { SpeechCapture } = captureModule();
  const capture = new SpeechCapture(16000);
  const silence = new Float32Array(1024),
    speech = new Float32Array(1024).fill(0.05);
  for (let i = 0; i < 100; i++) assert.equal(capture.push(silence, true).final, undefined);
  let onsets = 0,
    previews = 0,
    utterance;
  for (let i = 0; i < 40; i++) {
    const event = capture.push(speech, true);
    onsets += Number(event.onset);
    previews += Number(!!event.preview);
  }
  for (let i = 0; i < 14; i++) utterance = capture.push(silence, true).final || utterance;
  assert.equal(onsets, 1);
  assert.equal(previews, 0); // Short turns no longer incur a second transcription.
  assert.ok(utterance.length > 30);
  for (let i = 0; i < 6; i++) onsets += Number(capture.push(speech, true).onset);
  assert.equal(onsets, 2);
  for (let i = 0; i < 80; i++) previews += Number(!!capture.push(speech, true).preview);
  assert.equal(previews, 1); // Long spoken requests can still start navigation early.
});

test('speech buffers encode real mono PCM WAV with the actual capture rate', () => {
  const { wavBase64 } = captureModule();
  const wav = Buffer.from(wavBase64([new Float32Array([0, -1, 1])], 48000), 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.equal(wav.readInt16LE(46), -32768);
  assert.equal(wav.readInt16LE(48), 32767);
});
