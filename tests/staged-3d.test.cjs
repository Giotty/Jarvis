const test = require('node:test'),
  assert = require('node:assert/strict');
const { TrellisProvider, endpoint } = require('../core/blender/trellis.cjs');
const { ResourceScheduler } = require('../core/resource-scheduler.cjs');
const { cameraPlan, stage, structured, exactTextVerified } = require('../core/blender/staged.cjs');
const { z } = require('zod');
function glb() {
  const json = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, nodes: [], meshes: [] }).padEnd(80, ' '),
  );
  const b = Buffer.alloc(20 + json.length);
  b.write('glTF');
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(json.length, 12);
  b.writeUInt32LE(0x4e4f534a, 16);
  json.copy(b, 20);
  return b;
}
test('Optional TRELLIS stays disabled with no network or secret reads', async () => {
  const p = new TrellisProvider({
    config: () => ({ trellisEnabled: false }),
    fetcher: () => {
      throw Error('Unexpected network');
    },
    secrets: {
      get: () => {
        throw Error('Unexpected credential read');
      },
    },
  });
  assert.equal((await p.healthCheck()).ready, false);
  await assert.rejects(p.generate({ mode: 'text', prompt: 'fixture' }), /disabled/);
});
test('Future TRELLIS adapter validates actual embedded GLB and never sends NGC credentials', async () => {
  const requests = [],
    reads = [];
  const config = {
    trellisEnabled: true,
    trellisUrl: 'https://mesh.example',
    trellisVariant: 'large:text',
  };
  const p = new TrellisProvider({
    config: () => config,
    secrets: {
      get: (n) => {
        reads.push(n);
        return 'fixture-hosted-token';
      },
    },
    fetcher: async (url, args) => {
      requests.push({ url, args });
      return new Response(JSON.stringify({ artifacts: [{ base64: glb().toString('base64') }] }));
    },
  });
  const r = await p.generate({ mode: 'text', prompt: 'An original abstract object' });
  assert.deepEqual(r.buffer, glb());
  assert.deepEqual(reads, ['trellis']);
  assert.equal(requests[0].args.headers.Authorization, 'Bearer fixture-hosted-token');
  assert.equal(JSON.parse(requests[0].args.body).mode, 'text');
  assert.equal(p.status().state, 'ready');
  config.trellisUrl = 'http://localhost:8000';
  reads.length = 0;
  await p.generate({ mode: 'text', prompt: 'fixture' });
  assert.equal(reads.length, 0);
  assert(!requests[1].args.headers.Authorization);
});
test('Future adapter rejects unsafe endpoints, unsupported modes and malformed meshes', async () => {
  for (const value of [
    'http://remote.example',
    'ftp://localhost',
    'https://user:password@remote.example',
    'https://remote.example?token=x',
  ])
    assert.throws(() => endpoint(value));
  const config = {
    trellisEnabled: true,
    trellisUrl: 'http://localhost:8000',
    trellisVariant: 'large:image',
  };
  const p = new TrellisProvider({
    config: () => config,
    fetcher: async () =>
      new Response(
        JSON.stringify({ artifacts: [{ base64: Buffer.from('fake mesh').toString('base64') }] }),
      ),
  });
  await assert.rejects(p.generate({ mode: 'text', prompt: 'fixture' }), /text input/);
  await assert.rejects(
    p.generate({ mode: 'image', image: 'data:image/png;base64,YWJj' }),
    /Invalid GLB/,
  );
  assert.equal(p.status().state, 'unavailable');
});
test('Resource leases preserve FIFO through cancellation and release only once', async () => {
  const changes = [];
  const s = new ResourceScheduler({ emit: (_, v) => changes.push(v) });
  const first = await s.acquire('first');
  const aborted = new AbortController();
  const middle = s.acquire('cancelled', aborted.signal);
  const last = s.acquire('last');
  aborted.abort();
  await assert.rejects(middle, { name: 'AbortError' });
  assert.equal(s.active, 'first');
  first();
  first();
  const releaseLast = await last;
  assert.equal(s.active, 'last');
  releaseLast();
  assert.equal(s.active, null);
  assert.deepEqual(
    changes.map((c) => [c.label, c.busy]),
    [
      ['first', true],
      ['first', false],
      ['last', true],
      ['last', false],
    ],
  );
});
test('Camera critique needs three genuinely distinct, named nonzero directions', () => {
  const view = (name, location) => ({ name, location, target: [0, 0, 0] });
  const valid = {
    views: [view('main', [3, -3, 3]), view('side', [3, 3, 1]), view('back', [-3, 3, -2])],
  };
  assert(cameraPlan.safeParse(valid).success);
  assert(!cameraPlan.safeParse({ views: valid.views.slice(0, 2) }).success);
  assert(
    !cameraPlan.safeParse({
      views: [valid.views[0], view('duplicate', [6, -6, 6]), valid.views[2]],
    }).success,
  );
  assert(
    !cameraPlan.safeParse({ views: [valid.views[0], view('main', [0, 0, 0]), valid.views[2]] })
      .success,
  );
});
test('Structured plan recovers once from malformed JSON instead of breaking in error handling', async () => {
  let calls = 0;
  const service = {
    emit: () => {},
    ai: { chat: async () => ({ content: ++calls === 1 ? 'broken json' : '{"value":42}' }) },
  };
  const result = await structured(
    service,
    z.object({ value: z.number() }),
    'fixture',
    {},
    undefined,
  );
  assert.equal(result.value, 42);
  assert.equal(calls, 2);
});
test('Failed modeling batch repairs against the unchanged scene without replaying committed objects', async () => {
  const scene = { objects: [{ name: 'Existing' }], materials: [] },
    requests = [];
  let runs = 0;
  const service = {
    emit: () => {},
    ai: {
      chat: async (messages) => {
        requests.push(JSON.parse(messages[1].content));
        return {
          content: JSON.stringify({
            reason: 'Fit new support to existing body',
            operations: [{ op: 'create_primitive', kind: 'cube', name: 'Support' }],
          }),
        };
      },
    },
    run: async () => {
      if (++runs === 1) throw Error('Invalid original dimensions');
      return { projectId: 'fixture', revision: 2, scene };
    },
  };
  const result = await stage(
    service,
    'STRUCTURE',
    {},
    { projectId: 'fixture', revision: 1, scene },
    undefined,
    false,
  );
  assert.equal(result.revision, 2);
  assert.equal(runs, 2);
  assert.deepEqual(requests[1].scene.objects, [{ name: 'Existing' }]);
  assert.match(requests[1].executionRepair.instruction, /rolled back/);
});
test('Requested lettering is verified against exact procedural text or applied cutter provenance', () => {
  const spec = { exactText: [{ text: 'MAATOUK INDUSTRIES' }] };
  assert(exactTextVerified({ objects: [{ appliedText: ['MAATOUK INDUSTRIES'] }] }, spec));
  assert(!exactTextVerified({ objects: [{ text: 'MAATOUK INDUSTRIE' }] }, spec));
});
test('Stage references are validated in execution order, including consumed cutters and material creation', () => {
  const { validateStagePlan } = require('../core/blender/staged.cjs');
  const scene = { objects: [{ name: 'Body' }], materials: ['Metal'] };
  assert.throws(
    () => validateStagePlan({ operations: [{ op: 'transform', object: 'Imaginary' }] }, scene),
    /Unavailable object/,
  );
  assert.throws(
    () => validateStagePlan({ operations: [{ op: 'create_primitive', name: 'Body' }] }, scene),
    /already exists/,
  );
  validateStagePlan(
    {
      operations: [
        { op: 'create_primitive', name: 'Cutter' },
        { op: 'boolean', object: 'Body', cutter: 'Cutter', apply: true, removeCutter: true },
      ],
    },
    scene,
  );
  assert.throws(
    () =>
      validateStagePlan(
        {
          operations: [
            { op: 'create_primitive', name: 'Cutter' },
            { op: 'boolean', object: 'Body', cutter: 'Cutter', apply: true, removeCutter: true },
            { op: 'transform', object: 'Cutter' },
          ],
        },
        scene,
      ),
    /Unavailable object/,
  );
  assert.throws(
    () =>
      validateStagePlan(
        { operations: [{ op: 'assign_material', object: 'Body', material: 'New' }] },
        scene,
      ),
    /Unknown material/,
  );
  validateStagePlan(
    {
      operations: [
        { op: 'create_material', name: 'New' },
        { op: 'assign_material', object: 'Body', material: 'New' },
      ],
    },
    scene,
  );
});
test('General blockout uses standard Blender axes and normalizes the complete composition consistently', () => {
  const { blockoutPlan, toBatch } = require('../core/blender/scene-plan.cjs');
  const plan = blockoutPlan.parse({
    title: 'Abstract assembly',
    design: {
      category: 'abstract',
      silhouette: 'continuous',
      proportions: 'long and thin',
      features: ['tube', 'support', 'shell'],
    },
    materials: [{ name: 'Surface', color: [0.2, 0.2, 0.2, 1], metallic: 0.4, roughness: 0.3 }],
    objects: [
      {
        name: 'Body',
        kind: 'cylinder',
        location: [0, 0, 100],
        rotation: [90, 0, 0],
        dimensions: [20, 20, 200],
        material: 'Surface',
        bevel: 2,
      },
    ],
    lights: [{ name: 'Key', location: [100, 200, 200], energy: 500, size: 50 }],
    camera: { location: [300, 200, 300], target: [0, 0, 100], orthoScale: 250 },
  });
  const batch = toBatch(plan, { normalize: true });
  const body = batch.operations.find((o) => o.op === 'create_primitive');
  assert.deepEqual(body.rotation, [90, 0, 0]);
  assert(Math.abs(body.dimensions[2] - 3) < 1e-8);
  assert.deepEqual(body.location, [0, 0, 0]);
  const camera = batch.operations.find((o) => o.op === 'set_camera');
  assert.deepEqual(camera.target, [0, 0, 0]);
  assert.equal(camera.orthoScale, 3.75);
});

test('Partial stage recovery preserves valid independent operations and rejects unsafe or missing dependencies', () => {
  const { recoverStage } = require('../core/blender/staged.cjs');
  const diagnostics = [];
  const recovered = recoverStage(
    {
      operations: [
        { op: 'create_mesh', name: 'Broken', vertices: [], faces: [] },
        { op: 'create_primitive', name: 'Support', kind: 'cube' },
        { op: 'transform', object: 'Broken', location: [0, 0, 0] },
        { op: 'transform', object: 'Support', location: [1, 0, 0] },
        { op: 'exec', code: 'arbitrary code' },
      ],
    },
    ['create_mesh', 'create_primitive', 'transform'],
    { objects: [] },
    { emit: (_, data) => diagnostics.push(data) },
  );
  assert.deepEqual(
    recovered.operations.map((o) => o.op),
    ['create_primitive', 'transform'],
  );
  assert.equal(recovered.skipped.length, 3);
  assert.equal(diagnostics[0].accepted, 2);
});

test('Repair service failure can preserve validated original operations but cancellation never does', async () => {
  const { recoverStage, stageSchema } = require('../core/blender/staged.cjs');
  const kinds = ['create_mesh', 'create_primitive'];
  let calls = 0;
  const service = {
    emit: () => {},
    ai: {
      chat: async () => {
        if (++calls === 2) throw Error('Provider unavailable');
        return {
          content: JSON.stringify({
            reason: 'Build support',
            operations: [
              { op: 'create_mesh', name: 'Invalid', vertices: [], faces: [] },
              { op: 'create_primitive', name: 'Valid', kind: 'cube' },
            ],
          }),
        };
      },
    },
  };
  const result = await structured(service, stageSchema(kinds), 'fixture', {}, undefined, {
    recover: (value) => recoverStage(value, kinds, { objects: [] }, service),
  });
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].name, 'Valid');
  const cancelled = AbortSignal.abort();
  await assert.rejects(
    structured(
      {
        emit: () => {},
        ai: {
          chat: async () => {
            throw Error('Network');
          },
        },
      },
      z.object({ value: z.number() }),
      'fixture',
      {},
      cancelled,
    ),
    { name: 'AbortError' },
  );
});

test('Color contract accepts standard RGB, hex and byte colors while preserving alpha bounds', () => {
  const { color } = require('../core/blender/schema.cjs');
  assert.deepEqual(color.parse('#fff'), [1, 1, 1, 1]);
  assert.deepEqual(color.parse([255, 0, 128, 1]), [1, 0, 128 / 255, 1]);
  assert.deepEqual(color.parse([0.2, 0.3, 0.4]), [0.2, 0.3, 0.4, 1]);
  assert(!color.safeParse([256, 0, 0, 1]).success);
  assert(!color.safeParse([0, 0, 0, 2]).success);
});

test('Older scene inventories and vector camera targets are valid without material metadata', () => {
  const { validateStagePlan } = require('../core/blender/staged.cjs');
  validateStagePlan({ operations: [{ op: 'set_camera', target: [0, 0, 0] }] }, { objects: [] });
  validateStagePlan(
    { operations: [{ op: 'assign_material', object: 'Body', material: 'Metal' }] },
    { objects: [{ name: 'Body', materials: ['Metal'] }] },
  );
});

test('Reversible part removal updates dependencies and radial copies retain predictable names', () => {
  const { validateStagePlan } = require('../core/blender/staged.cjs');
  const scene = { objects: [{ name: 'Prototype' }] };
  validateStagePlan(
    {
      operations: [
        { op: 'radial_array', object: 'Prototype', namePrefix: 'Copy', count: 3 },
        { op: 'transform', object: 'Copy_2' },
      ],
    },
    scene,
  );
  assert.throws(
    () =>
      validateStagePlan(
        {
          operations: [
            { op: 'remove_object', object: 'Prototype' },
            { op: 'transform', object: 'Prototype' },
          ],
        },
        scene,
      ),
    /Unavailable object/,
  );
  assert.throws(
    () =>
      validateStagePlan(
        {
          operations: [
            { op: 'radial_array', object: 'Prototype', namePrefix: 'Copy', count: 3 },
            { op: 'create_primitive', name: 'Copy_1' },
          ],
        },
        scene,
      ),
    /already exists/,
  );
});

test('Studio staging never changes normalization scale of the actual object', () => {
  const { normalizePlan } = require('../core/blender/scene-plan.cjs');
  const body = {
    name: 'Body',
    dimensions: [10, 5, 1],
    location: [0, 0, 0],
    rotation: [0, 0, 0],
    bevel: 0,
  };
  const plan = normalizePlan({
    objects: [
      body,
      { ...body, name: 'Stage', role: 'STUDIO', dimensions: [100, 100, 1], location: [0, 0, -1] },
    ],
    lights: [],
    camera: { location: [30, 30, 30], target: [0, 0, 0], orthoScale: 20 },
  });
  assert.equal(plan.objects[0].dimensions[0], 3);
  assert.equal(plan.objects[1].dimensions[0], 30);
});

test('A truncated modeling batch retains only complete, independently validated operation objects', () => {
  const { completeOperationPrefix, recoverStage } = require('../core/blender/staged.cjs');
  const value = completeOperationPrefix(
    '{"reason":"Build a \\"quoted\\" surface","operations":[{"op":"create_primitive","kind":"cube","name":"Whole"},{"op":"create_mesh","name":"Cut", "vertices":[[0',
  );
  assert.equal(value.operations.length, 1);
  const result = recoverStage(
    value,
    ['create_primitive', 'create_mesh'],
    { objects: [] },
    { emit: () => {} },
  );
  assert.equal(result.operations[0].name, 'Whole');
  assert.equal(result.skipped.length, 1);
  assert.equal(completeOperationPrefix('{"reason":"fake \\"operations\\":['), null);
  assert.equal(completeOperationPrefix('{"operations":[{"op":"create_mesh"'), null);
});

test('Partial replacement plans preserve existing geometry; complete finish batches may exceed forty operations', () => {
  const { recoverStage, stageSchema } = require('../core/blender/staged.cjs');
  const scene = { objects: [{ name: 'Body' }] };
  const partial = recoverStage(
    {
      operations: [
        { op: 'remove_object', object: 'Body' },
        { op: 'create_primitive', name: 'Body', kind: 'cube' },
      ],
    },
    ['remove_object', 'create_primitive'],
    scene,
    { emit: () => {} },
  );
  assert.equal(partial.operations.length, 0);
  assert.equal(partial.skipped.length, 2);
  assert(
    stageSchema(['assign_material']).safeParse({
      reason: 'Apply coherent finish',
      operations: Array.from({ length: 55 }, (_, i) => ({
        op: 'assign_material',
        object: 'Part_' + i,
        material: 'Surface',
      })),
    }).success,
  );
});

test('Quality ranking does not reward polish that loses recognizability or user intent', () => {
  const { reviewRank } = require('../core/blender/staged.cjs');
  assert(
    reviewRank({ scores: { overall: 7, recognizability: 8, userIntent: 8 } }) >
      reviewRank({ scores: { overall: 9, recognizability: 2, userIntent: 4 } }),
  );
  assert(
    reviewRank({ scores: { overall: 7, recognizability: 8, userIntent: 8 } }) >
      reviewRank({ scores: { overall: 0, recognizability: 0, userIntent: 0 } }),
  );
});

test('Detailed spatial plans enable reasoning and normalize only unambiguous operation discriminators', async () => {
  const { replyValue } = require('../core/blender/staged.cjs');
  const parsed = replyValue({
    content: JSON.stringify({
      operations: [
        { name: 'assign_material', object: 'Body', material: 'Metal' },
        { op: 'create_primitive', name: 'Body', kind: 'cube' },
        { name: 'Unknown' },
      ],
    }),
  });
  assert.deepEqual(parsed.operations[0], {
    op: 'assign_material',
    object: 'Body',
    material: 'Metal',
  });
  assert.equal(parsed.operations[1].name, 'Body');
  assert.equal(parsed.operations[2].op, undefined);
  let options;
  await structured(
    {
      emit: () => {},
      ai: {
        chat: async (...args) => {
          options = args[5];
          return { content: '{"value":42}' };
        },
      },
    },
    z.object({ value: z.number() }),
    'fixture',
    {},
    undefined,
    { deepReasoning: true },
  );
  assert.equal(options.profile.deepReasoning, true);
});

test('Corrective geometry planning receives only images from the actual current revision', async () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-revision-'));
  try {
    const file = path.join(directory, 'render.png');
    fs.writeFileSync(file, 'fixture');
    let messages, options;
    const scene = { objects: [{ name: 'Body' }], materials: [] };
    await stage(
      {
        emit: () => {},
        ai: {
          chat: async (...args) => {
            messages = args[0];
            options = args[5];
            return { content: '{"reason":"Correct actual proportions","operations":[]}' };
          },
        },
      },
      'REVISION',
      {},
      {
        revision: 2,
        scene,
        exports: [
          { format: 'PNG', revision: 1, path: file },
          { format: 'PNG', revision: 2, path: file },
        ],
      },
      undefined,
      false,
    );
    assert.equal(messages[1].images.length, 1);
    assert.equal(options.manualVision, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Resuming an unreviewed intermediate keeps the best complete historical visual checkpoint', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const { reviewedCheckpoint } = require('../core/blender/staged.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-best-review-'));
  try {
    const folder = path.join(root, 'good');
    fs.mkdirSync(folder);
    fs.writeFileSync(
      path.join(folder, 'result.json'),
      JSON.stringify({ objects: [{ name: 'Preserved' }] }),
    );
    fs.writeFileSync(path.join(folder, 'scene.blend'), 'fixture');
    const result = reviewedCheckpoint(
      { file: (_id, name) => path.join(root, name) },
      {
        id: 'fixture',
        revision: 3,
        exports: [{ format: 'GLB', revision: 1, file: path.join(folder, 'model.glb') }],
      },
      [{ revision: 1, scores: { overall: 8, userIntent: 8, recognizability: 8 }, accepted: true }],
    );
    assert.equal(result.result.revision, 1);
    assert.equal(result.result.scene.objects[0].name, 'Preserved');
    assert.equal(result.accepted, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
