const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ts = require('typescript');
const { ResearchWorkspace, ResearchLibrary } = require('../core/workspace.cjs');
const { BriefingEngine } = require('../core/briefing.cjs');
const { sanitizeSpeech } = require('../core/speech-text.mjs');
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-research-'));
  let changes = 0;
  const library = new ResearchLibrary(folder, () => changes++),
    workspace = new ResearchWorkspace({ library }),
    briefing = new BriefingEngine({ workspace });
  briefing.begin('Fixture');
  const imageId = crypto.randomUUID();
  const [{ id }] = briefing.observe({
    tool: 'extract_page_text',
    result: {
      success: true,
      url: 'https://example.org/fixture',
      title: 'Public fixture',
      text: 'Fixture values: 12 and 18.',
      images: [
        {
          id: imageId,
          title: 'Fixture artwork',
          url: 'https://example.org/image.png',
          sourceUrl: 'https://example.org/fixture',
        },
      ],
    },
  });
  const panel = {
    type: 'metrics',
    title: 'Fixture',
    sourceIds: [id],
    items: [
      { label: 'First', value: '12' },
      { label: 'Second', value: '18' },
    ],
  };
  const scene = (title = 'Overview') => ({
    title,
    panels: [panel],
    segments: [
      { text: 'First value.', panel: 0, item: 0 },
      { text: 'Second value.', panel: 0, item: 1 },
    ],
  });
  const present = (scenes = [scene()], mode = 'replace') =>
    briefing.present({ title: 'Fixture', mode, scenes });
  const token = () => ({ sessionId: workspace.current.id, ...workspace.current.playback });
  return {
    folder,
    library,
    workspace,
    briefing,
    imageId,
    id,
    panel,
    scene,
    present,
    token,
    changes: () => changes,
  };
}
test('actual playback completion drives progressive narration and automatically docks sections', () => {
  const f = fixture();
  try {
    f.present();
    const old = f.token();
    f.present([f.scene('Results')], 'append');
    assert.equal(f.token().epoch, old.epoch);
    assert.equal(f.workspace.current.modules.length, 2);
    f.workspace.complete(old);
    assert.equal(f.workspace.current.playback.segment, 1);
    assert.equal(f.workspace.complete(old).stale, true);
    f.workspace.complete(f.token());
    assert.equal(f.workspace.current.modules[0].state, 'docked');
    assert.equal(f.workspace.current.modules[0].completed, true);
    assert.equal(f.workspace.current.playback.moduleId, f.workspace.current.modules[1].id);
    f.workspace.complete(f.token());
    f.workspace.complete(f.token());
    assert.equal(f.workspace.current.playback.state, 'waiting');
    f.present([f.scene('News')], 'append');
    assert.equal(f.workspace.current.playback.state, 'playing');
    f.workspace.endTask();
    f.workspace.complete(f.token());
    f.workspace.complete(f.token());
    assert.equal(f.workspace.current.playback.state, 'complete');
    assert.equal(f.workspace.current.modules.filter((m) => m.state === 'docked').length, 3);
  } finally {
    fs.rmSync(f.folder, { recursive: true, force: true });
  }
});
test('pause, stop and manual transport invalidate outstanding audio completion', () => {
  const f = fixture();
  try {
    f.present([f.scene(), f.scene('Second')]);
    for (const action of ['pause', 'stop']) {
      const old = f.token();
      f.workspace.control({ action });
      assert.equal(f.workspace.complete(old).stale, true);
      f.workspace.control({ action: 'resume' });
    }
    f.workspace.control({ action: 'next' });
    assert.equal(f.workspace.current.modules[1].state, 'active');
    f.workspace.control({ action: 'previous' });
    assert.equal(f.workspace.current.playback.moduleId, f.workspace.current.modules[0].id);
    f.workspace.complete(f.token());
    f.workspace.control({ action: 'repeat' });
    assert.equal(f.workspace.current.playback.segment, 0);
  } finally {
    fs.rmSync(f.folder, { recursive: true, force: true });
  }
});
test('modules stay bounded, support comparison and retain closed contents for reopening', () => {
  const f = fixture();
  try {
    f.present([f.scene(), f.scene('Second'), f.scene('Third')]);
    const [a, b, c] = f.workspace.current.modules;
    f.workspace.control({ action: 'move', moduleId: a.id, x: 1, y: 1 });
    assert.equal(a.layout.x + a.layout.width, 1);
    assert.equal(a.layout.y + a.layout.height, 1);
    f.workspace.control({ action: 'resize', moduleId: a.id, width: 1, height: 1 });
    assert.equal(a.layout.x, 0);
    f.workspace.control({ action: 'expand', moduleId: a.id });
    f.workspace.control({ action: 'compare', moduleId: a.id, otherModuleId: b.id });
    assert.equal(f.workspace.current.modules.filter((m) => m.state === 'active').length, 2);
    assert.ok(a.layout.x + a.layout.width <= b.layout.x);
    f.workspace.control({ action: 'pin', moduleId: c.id });
    assert.equal(f.workspace.current.modules.filter((m) => m.state === 'active').length, 2);
    f.workspace.control({ action: 'close', moduleId: b.id });
    assert.equal(b.state, 'closed');
    assert.ok(b.panels.length);
    f.workspace.control({ action: 'focus', moduleId: b.id });
    assert.equal(b.state, 'active');
    f.workspace.control({ action: 'minimize', moduleId: b.id });
    assert.equal(b.state, 'docked');
    assert.throws(() => f.workspace.control({ action: 'move', moduleId: a.id, x: -1, y: 0 }));
  } finally {
    fs.rmSync(f.folder, { recursive: true, force: true });
  }
});
test('focus targets must exist and failed append is atomic', () => {
  const f = fixture();
  try {
    f.present();
    const before = JSON.stringify(f.workspace.current);
    assert.throws(
      () =>
        f.present([{ ...f.scene(), segments: [{ text: 'Missing', panel: 0, item: 3 }] }], 'append'),
      /focus/,
    );
    assert.equal(JSON.stringify(f.workspace.current), before);
    const id = f.workspace.current.modules[0].id;
    assert.throws(() =>
      f.workspace.control({ action: 'highlight', moduleId: id, panel: 0, datum: 5 }),
    );
    f.workspace.control({ action: 'highlight', moduleId: id, panel: 0, item: 1 });
    assert.equal(f.workspace.current.modules[0].focus.item, 1);
    assert.equal(f.workspace.current.playback.state, 'paused');
    assert.equal(f.workspace.summary(id).module.panels[0].items[1].value, '18');
  } finally {
    fs.rmSync(f.folder, { recursive: true, force: true });
  }
});
test('saved sessions preserve images, sources and layouts across restart; rename and delete are bounded', () => {
  const f = fixture();
  try {
    f.present([
      {
        title: 'Image',
        panels: [{ type: 'images', title: 'Artwork', sourceIds: [f.id], imageIds: [f.imageId] }],
        segments: [{ text: 'The subject.', panel: 0, imageId: f.imageId }],
      },
    ]);
    const m = f.workspace.current.modules[0];
    f.workspace.control({ action: 'move', moduleId: m.id, x: 0.4, y: 0 });
    const { entry } = f.workspace.save();
    assert.equal(f.changes(), 1);
    const library = new ResearchLibrary(f.folder);
    let restored;
    const workspace = new ResearchWorkspace({
      library,
      images: { restoreImages: (s) => (restored = s) },
    });
    workspace.open(entry.id);
    assert.equal(workspace.current.playback.state, 'paused');
    assert.equal(workspace.current.modules[0].layout.x, 0.4);
    assert.equal(restored[0].images[0].url, 'https://example.org/image.png');
    assert.equal(workspace.summary(m.id)._privacy, 'files');
    library.rename(entry.id, 'Renamed');
    assert.equal(library.list()[0].topic, 'Renamed');
    fs.writeFileSync(path.join(f.folder, crypto.randomUUID() + '.json'), 'broken');
    assert.equal(library.list().length, 1);
    assert.throws(() => library.open('../config'));
    assert.throws(() => library.delete('../config'));
    library.delete(entry.id);
    assert.equal(library.list().length, 0);
  } finally {
    fs.rmSync(f.folder, { recursive: true, force: true });
  }
});
test('sanitizer separates readable display formatting from speech across engines', () => {
  assert.equal(sanitizeSpeech('<script>unfinished code.'), '');
  assert.equal(sanitizeSpeech('{"unfinished":'), '');
  assert.equal(
    sanitizeSpeech(
      '## **Recent results** 🏒 [Official roster](https://example.org/roster) [source-12] https://example.org/a',
    ),
    'Recent results Official roster',
  );
  assert.equal(sanitizeSpeech('{"text":"JSON must not be spoken"}'), '');
  assert.equal(
    sanitizeSpeech('Visible prose. ```json\n{"x": 3}\n``` <script>bad()</script> <b>Good.</b>'),
    'Visible prose. Good.',
  );
  assert.equal(
    sanitizeSpeech('Source source-a1b2 turn2search0 【2】 767da13b-008a-45af-a339-cd5a27fc7fcb'),
    'Source',
  );
});
test('unused research observations do not fill saved workspaces or prevent future-topic sources', () => {
  const f = fixture();
  try {
    f.present();
    for (let i = 0; i < 100; i++)
      f.briefing.observe({
        tool: 'extract_page_text',
        result: {
          success: true,
          url: 'https://example.org/unused-' + i,
          title: 'Unused ' + i,
          text: 'Synthetic unused observation.',
        },
      });
    assert.ok(f.briefing.sources.size <= 80);
    assert.equal(f.workspace.current.sources.length, 1);
    f.briefing.begin('Another topic');
    const [{ id }] = f.briefing.observe({
      tool: 'extract_page_text',
      result: {
        success: true,
        url: 'https://example.org/new-topic',
        title: 'New topic',
        text: 'New synthetic evidence.',
      },
    });
    f.briefing.present({
      title: 'New topic',
      scenes: [
        {
          title: 'New overview',
          panels: [
            { type: 'text', title: 'New topic', sourceIds: [id], body: 'New synthetic evidence.' },
          ],
        },
      ],
    });
    assert.equal(f.workspace.current.sources.length, 1);
    assert.equal(f.workspace.current.sources[0].id, id);
    assert.equal(f.workspace.current.modules.length, 1);
  } finally {
    fs.rmSync(f.folder, { recursive: true, force: true });
  }
});
test('fragmented streamed links and fenced JSON never enter synthesis; ordinary sentences start early', async () => {
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../frontend/speechPlayback.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', code)(mod.exports, mod, () => ({ sanitizeSpeech }));
  const spoken = [],
    tick = () => new Promise((r) => setImmediate(r));
  let complete = 0;
  const player = new mod.exports.SpeechPlayback({
    synthesize: async (t) => {
      spoken.push(t);
      return t;
    },
    play: () => ({ done: Promise.resolve(), stop() {} }),
    state() {},
    error: (e) => {
      throw e;
    },
    complete: () => complete++,
  });
  player.append('A normal sentence. ');
  await tick();
  assert.deepEqual(spoken, ['A normal sentence.']);
  player.append('[The official');
  player.append(' roster](https://example.');
  player.append('org/longpath) ');
  player.append('```json\n{"secret":');
  player.append(' "should not speak"}\n``` Final prose.');
  player.finish();
  await tick();
  await tick();
  assert.ok(spoken.join(' ').includes('The official roster'));
  assert.ok(spoken.join(' ').includes('Final prose'));
  assert.doesNotMatch(spoken.join(' '), /https|example|json|secret|should not speak|\[|\*|```/);
  assert.equal(complete, 1);
});
