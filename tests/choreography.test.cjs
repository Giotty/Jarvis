const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ResearchWorkspace, ResearchLibrary } = require('../core/workspace.cjs');
const { BriefingEngine } = require('../core/briefing.cjs');
function fixture() {
  const directory = fs.mkdtempSync(path.join(__dirname, '../tmp/choreography-'));
  const library = new ResearchLibrary(directory),
    workspace = new ResearchWorkspace({ library }),
    briefing = new BriefingEngine({ workspace });
  briefing.begin('Generic explanation');
  const [{ id }] = briefing.observe({
    tool: 'extract_page_text',
    result: {
      success: true,
      url: 'https://example.org/source',
      title: 'Synthetic source',
      text: 'Observed 12 and 18.',
      images: [],
    },
  });
  const panel = {
    type: 'text',
    title: 'Sourced fact',
    body: 'Observed explanation.',
    sourceIds: [id],
  };
  const scenes = [
    {
      key: 'person-a',
      groupId: 'a',
      groupTitle: 'Subject A',
      title: 'Subject A',
      panels: [panel],
      segments: [
        { text: 'Subject A.', focusObjectId: 'person-a', panel: 0 },
        { text: 'Location A.', focusObjectId: 'place-a', relatedObjectIds: ['person-a'], panel: 0 },
        { text: 'Subject B.', focusObjectId: 'person-b', panel: 0 },
      ],
    },
    {
      key: 'place-a',
      groupId: 'a',
      groupTitle: 'Subject A',
      title: 'Location A',
      panels: [panel],
      narration: 'Location.',
    },
    {
      key: 'person-b',
      groupId: 'b',
      groupTitle: 'Subject B',
      title: 'Subject B',
      panels: [panel],
      narration: 'Subject B.',
    },
  ];
  briefing.present({ title: 'Generic explanation', scenes });
  const token = () => ({ sessionId: workspace.current.id, ...workspace.current.playback });
  const hold = (moduleId, phase = 'USER_GRABBED') => {
    const token = crypto.randomUUID();
    workspace.gesture({ sessionId: workspace.current.id, moduleId, token, phase });
    return token;
  };
  const release = (moduleId, token, layout) =>
    workspace.gesture({
      sessionId: workspace.current.id,
      moduleId,
      token,
      phase: 'RELEASE',
      ...(layout ? { layout } : {}),
    });
  return {
    library,
    workspace,
    briefing,
    scenes,
    panel,
    token,
    hold,
    release,
    clean: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
test('narration focuses different objects, shrinks previous files and retains the entire wall', () => {
  const f = fixture();
  try {
    const [a, b, c] = f.workspace.current.modules;
    assert.equal(a.visualRole, 'PRIMARY');
    f.workspace.complete(f.token());
    assert.equal(b.visualRole, 'PRIMARY');
    assert.equal(a.visualRole, 'SECONDARY');
    assert.ok(a.layout.width < b.layout.width);
    f.workspace.complete(f.token());
    assert.equal(c.visualRole, 'PRIMARY');
    assert.notEqual(a.visualRole, 'PRIMARY');
    assert.equal(f.workspace.current.modules.length, 3);
    assert.ok(f.workspace.current.modules.every((m) => m.state !== 'closed'));
  } finally {
    f.clean();
  }
});
test('held files never move or resize while narration continues; latest staging reconciles on release', () => {
  const f = fixture();
  try {
    const [a, b, c] = f.workspace.current.modules;
    const before = { layout: { ...a.layout }, zIndex: a.zIndex, role: a.visualRole };
    const token = f.hold(a.id, 'USER_DRAGGING');
    assert.equal(f.workspace.current.playback.state, 'playing');
    f.workspace.complete(f.token());
    f.workspace.complete(f.token());
    assert.deepEqual(a.layout, before.layout);
    assert.equal(a.zIndex, before.zIndex);
    assert.equal(a.visualRole, before.role);
    assert.equal(f.workspace.current.pendingFocus, c.id);
    assert.equal(c.visualRole, 'STACKED');
    assert.equal(
      f.workspace.control({ action: 'resize', moduleId: a.id, width: 0.4, height: 0.8 }).deferred,
      true,
    );
    const placed = { x: 0.01, y: 0.3, width: 0.25, height: 0.5 };
    f.release(a.id, token, placed);
    assert.deepEqual(a.layout, placed);
    assert.equal(a.userPositioned, true);
    assert.equal(c.visualRole, 'PRIMARY');
    assert.equal(f.workspace.current.pendingFocus, undefined);
    assert.equal(f.workspace.current.playback.state, 'playing');
    assert.ok(b.panels.length);
  } finally {
    f.clean();
  }
});
test('stale release tokens cannot unlock a file and renderer cleanup releases orphan locks', () => {
  const f = fixture();
  try {
    const a = f.workspace.current.modules[0],
      token = f.hold(a.id);
    assert.equal(f.release(a.id, crypto.randomUUID()).stale, true);
    assert.equal(a.userLocked, true);
    f.workspace.releaseLocks();
    assert.equal(a.userLocked, false);
    assert.equal(f.release(a.id, token).stale, true);
  } finally {
    f.clean();
  }
});
test('new sourced files stage during a grab without changing the held object', () => {
  const f = fixture();
  try {
    const a = f.workspace.current.modules[0],
      token = f.hold(a.id);
    const before = { ...a.layout };
    f.briefing.present({
      title: 'Generic explanation',
      mode: 'append',
      scenes: [{ key: 'new', title: 'New detail', panels: [f.panel], narration: 'New detail.' }],
    });
    const held = f.workspace.module(a.id);
    assert.deepEqual(held.layout, before);
    assert.equal(held.userLocked, true);
    assert.equal(f.workspace.current.modules.at(-1).visualRole, 'STACKED');
    f.release(a.id, token);
    assert.equal(f.workspace.locks.size, 0);
  } finally {
    f.clean();
  }
});
test('pins and manual positions survive future narration and agent movement attempts', () => {
  const f = fixture();
  try {
    const [a, b] = f.workspace.current.modules;
    f.workspace.control({ action: 'move', moduleId: a.id, x: 0, y: 0.2 }, 'user');
    f.workspace.control({ action: 'pin', moduleId: a.id }, 'user');
    const before = { ...a.layout };
    f.workspace.complete(f.token());
    assert.deepEqual(a.layout, before);
    assert.equal(
      f.workspace.control({ action: 'move', moduleId: a.id, x: 0.5, y: 0.1 }).blocked,
      true,
    );
    f.workspace.control({ action: 'pin', moduleId: a.id }, 'user');
    f.workspace.complete(f.token());
    assert.deepEqual(a.layout, before);
    assert.ok(b.panels.length);
  } finally {
    f.clean();
  }
});
test('individual/group/workspace saves and folders survive reload; trash preserves saved copies', () => {
  const f = fixture();
  try {
    const [a, b] = f.workspace.current.modules,
      folder = f.library.createFolder('Research A');
    const object = f.workspace.save({ moduleIds: [a.id], folderId: folder.id }).entry;
    assert.equal(object.kind, 'object');
    const group = f.workspace.save({ groupId: 'a', folderId: folder.id }).entry;
    assert.equal(group.kind, 'group');
    assert.equal(group.moduleCount, 2);
    const entire = f.workspace.save().entry;
    assert.equal(entire.kind, 'workspace');
    f.workspace.control({ action: 'trash', moduleId: a.id });
    assert.ok(f.library.read(object.id));
    assert.equal(
      f.workspace.current.modules.some((m) => m.id === a.id),
      false,
    );
    const library = new ResearchLibrary(f.library.directory),
      w = new ResearchWorkspace({ library });
    const result = w.openFolder(folder.id);
    assert.equal(result.partial, false);
    assert.equal(w.current.modules.length, 2);
    assert.ok(w.current.modules.some((m) => m.id === b.id));
    assert.ok(w.current.modules.every((m) => !m.userLocked));
    assert.equal(library.list('', folder.id).length, 2);
    library.move(object.id, null);
    assert.equal(library.list('', folder.id).length, 1);
    assert.equal(library.folders()[0].name, 'Research A');
    assert.throws(() => library.folder('../bad'));
  } finally {
    f.clean();
  }
});
test('cross-object narration references are validated atomically', () => {
  const f = fixture();
  try {
    const before = JSON.stringify(f.workspace.current);
    assert.throws(
      () =>
        f.briefing.present({
          title: 'Bad',
          mode: 'append',
          scenes: [
            {
              key: 'bad',
              title: 'Bad',
              panels: [f.panel],
              segments: [{ text: 'Invalid.', focusObjectId: 'missing', panel: 0 }],
            },
          ],
        }),
      /Unknown/,
    );
    assert.equal(JSON.stringify(f.workspace.current), before);
  } finally {
    f.clean();
  }
});

test('trashing a referenced object retargets narration without losing saved evidence', () => {
  const f = fixture();
  try {
    const [a, b] = f.workspace.current.modules;
    f.workspace.control({ action: 'trash', moduleId: b.id }, 'user');
    assert.ok(a.segments.every((s) => s.focusObjectId !== b.id));
    for (let i = 0; i < 3; i++) f.workspace.complete(f.token());
  } finally {
    f.clean();
  }
});

test('visual assist stays one file across updates; deleted saved badges retain private-library provenance', () => {
  const f = fixture();
  try {
    f.workspace.responseMode = 'VISUAL_ASSIST';
    f.briefing.present({
      title: 'One useful card',
      scenes: [
        { title: 'First', panels: [f.panel], narration: 'Fact.' },
        { title: 'Second', panels: [f.panel], narration: 'Detail.' },
      ],
    });
    assert.equal(f.workspace.current.modules.length, 1);
    f.briefing.present({
      title: 'Updated card',
      mode: 'append',
      scenes: [{ title: 'Updated', panels: [f.panel], narration: 'New fact.' }],
    });
    assert.equal(f.workspace.current.modules.length, 1);
    const saved = f.workspace.save().entry;
    f.workspace.open(saved.id);
    f.library.delete(saved.id);
    f.workspace.forgetSaved(saved.id);
    assert.equal(f.workspace.current.savedId, null);
    assert.ok(f.workspace.current.modules.every((m) => !m.savedId));
    assert.equal(f.workspace.summary().fromLibrary, true);
  } finally {
    f.clean();
  }
});
