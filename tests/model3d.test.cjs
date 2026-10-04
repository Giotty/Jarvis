const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { batch } = require('../core/blender/schema.cjs');
const { BlenderService, inside, validateGlb } = require('../core/blender/service.cjs');
const { ResearchWorkspace, ResearchLibrary } = require('../core/workspace.cjs');
const { Store } = require('../core/store.cjs');
const { SemanticMemory } = require('../core/semantic-memory.cjs');
test('Blender schema blocks arbitrary scripts, unbounded geometry and unsafe numbers', () => {
  for (const input of [
    { operations: [{ op: 'execute_script', code: 'anything' }] },
    { operations: [{ op: 'transform', object: 'Cube', location: [Infinity, 0, 0] }] },
    { operations: [{ op: 'export', format: 'GLB', path: 'C:/unrelated/file' }] },
  ])
    assert.equal(batch.safeParse(input).success, false);
  assert.equal(
    batch.parse({ operations: [{ op: 'create_primitive', kind: 'cylinder', name: 'Part' }] }).units,
    'meters',
  );
  assert.throws(() => inside('C:/owned', 'C:/other/file'));
});
test('3D cards survive library save/reopen with exact immutable asset identities', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-3d-library-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new ResearchLibrary(dir);
  const workspace = new ResearchWorkspace({ library });
  const service = new BlenderService({
    directory: path.join(dir, 'models'),
    config: () => ({}),
    workspace,
  });
  const project = {
      id: crypto.randomUUID(),
      title: 'Created mesh',
      revision: 1,
      scene: { objects: [], totalVertices: 8 },
    },
    asset = { assetId: crypto.randomUUID() };
  service.present(project, asset);
  const saved = library.save(workspace.current);
  const restored = library.read(saved.id).workspace;
  assert.equal(restored.modules[0].panels[0].assetId, asset.assetId);
  assert.equal(restored.modules[0].panels[0].projectId, project.id);
  const module = workspace.current.modules[0];
  module.pinned = true;
  const old = module.layout;
  service.present({ ...project, revision: 2 }, { assetId: crypto.randomUUID() });
  assert.equal(workspace.current.modules.length, 1);
  assert.equal(module.pinned, true);
  assert.deepEqual(module.layout, old);
});
test('A new model takes focus after paused research while pinned cards keep their layout', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-3d-focus-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workspace = new ResearchWorkspace({ library: new ResearchLibrary(dir) });
  const service = new BlenderService({
    directory: path.join(dir, 'models'),
    config: () => ({}),
    workspace,
  });
  const project = {
    id: crypto.randomUUID(),
    title: 'First model',
    revision: 1,
    scene: { objects: [], totalVertices: 8 },
  };
  service.present(project, { assetId: crypto.randomUUID() });
  const first = workspace.current.modules[0];
  first.pinned = true;
  const pinnedLayout = structuredClone(first.layout);
  workspace.control({ action: 'pause' });
  const next = { ...project, id: crypto.randomUUID(), title: 'Next model' };
  service.present(next, { assetId: crypto.randomUUID() });
  const created = workspace.current.modules.find((m) =>
    m.panels.some((p) => p.projectId === next.id),
  );
  assert.equal(workspace.current.playback.moduleId, created.id);
  assert.equal(created.visualRole, 'PRIMARY');
  assert.deepEqual(workspace.current.modules.find((m) => m.id === first.id).layout, pinnedLayout);
});
test('GLB validation rejects remote resources and corrupt lengths', () => {
  const glb = (data) => {
    const json = Buffer.from(JSON.stringify(data));
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
    json.copy(padded);
    const b = Buffer.alloc(20 + padded.length);
    b.write('glTF');
    b.writeUInt32LE(2, 4);
    b.writeUInt32LE(b.length, 8);
    b.writeUInt32LE(padded.length, 12);
    b.writeUInt32LE(0x4e4f534a, 16);
    padded.copy(b, 20);
    return b;
  };
  assert.equal(validateGlb(glb({ asset: { version: '2.0' } })).asset.version, '2.0');
  assert.throws(() => validateGlb(glb({ buffers: [{ uri: 'https://example.com/private' }] })));
  assert.throws(() => validateGlb(Buffer.from('broken')));
});
test('Private semantic retrieval persists local vectors and forget removes them immediately', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-semantic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = await new Store().init(directory);
  store.remember('preference', 'I like ice hockey');
  store.remember('preference', 'I collect cookbooks');
  let calls = 0;
  const semantic = new SemanticMemory({
    store,
    config: () => ({
      memory: true,
      embeddingProvider: 'ollama',
      embeddingModel: 'synthetic',
      ollamaUrl: 'http://127.0.0.1:11434',
    }),
    fetcher: async (url, init) => {
      assert.equal(new URL(url).hostname, '127.0.0.1');
      calls++;
      const input = JSON.parse(init.body).input;
      const v = input.includes('cook') ? [0, 1, 0, 0, 0, 0, 0, 0] : [1, 0, 0, 0, 0, 0, 0, 0];
      return new Response(JSON.stringify({ embeddings: [v] }));
    },
  });
  const found = await semantic.search('skating');
  assert.equal(found[0].content, 'I like ice hockey');
  assert.equal(store.rows('SELECT * FROM vectors').length, 2);
  await semantic.search('skating');
  assert.equal(calls, 4);
  store.forget(found[0].id);
  assert.equal(store.rows('SELECT * FROM vectors').length, 1);
  store.clear();
  assert.equal(store.rows('SELECT * FROM vectors').length, 0);
});

test('Blender mock mode cannot create files or consume AI calls, and explicit export paths require approval', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-3d-safety-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = new BlenderService({
    directory: dir,
    config: () => ({ mock: true, filesystem: true, blenderEnabled: true }),
    ai: {
      chat: () => {
        throw Error('Mock mode contacted AI');
      },
    },
  });
  assert.equal((await service.design({ goal: 'Create a cube' })).verified, false);
  assert.equal((await service.openProject('missing.blend')).verified, false);
  assert.equal(fs.readdirSync(dir).length, 0);
  const plugin = service.plugin(),
    tool = plugin.tools.find((t) => t.name === 'blender_export');
  assert.equal(tool.validate({ format: 'GLB', path: path.join(dir, 'new.glb') }).risk, 2);
  fs.writeFileSync(path.join(dir, 'existing.glb'), 'original');
  assert.equal(tool.validate({ format: 'GLB', path: path.join(dir, 'existing.glb') }).risk, 3);
});

test('Optional future mesh generators start disabled and cannot return executable scripts', async () => {
  const { Generative3DProviders } = require('../core/blender/generators.cjs');
  const p = new Generative3DProviders();
  p.register({
    id: 'synthetic',
    modalities: ['text'],
    generate: async () => ({ operations: [{ op: 'execute_script', code: 'unsafe' }] }),
  });
  await assert.rejects(() => p.generate('synthetic', {}), /disabled/);
  p.enable('synthetic', true);
  await assert.rejects(() => p.generate('synthetic', {}));
});
