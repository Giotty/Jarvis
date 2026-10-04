const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');

test('Reasoning-only vision responses get one audited same-model transport recovery', async () => {
  const { NvidiaProvider } = require('../core/providers/nvidia.cjs');
  const bodies = [],
    model = 'moonshotai/kimi-k3';
  const provider = new NvidiaProvider({
    config: () => ({ nvidiaFreeEndpoint: true, nvidiaDailyCap: 10 }),
    secrets: { get: () => 'fixture' },
    fetcher: async (_url, request) => {
      const body = JSON.parse(request.body);
      bodies.push(body);
      if (bodies.length === 1)
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: '', reasoning_content: 'Only reasoning' },
              },
            ],
          }),
        );
      return new Response(
        [
          { choices: [{ delta: { content: '{"accepted":true}' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ]
          .map((e) => 'data: ' + JSON.stringify(e) + '\n\n')
          .join(''),
      );
    },
  });
  const result = await provider.chat(
    [
      {
        role: 'user',
        content: 'Review generated illustration',
        images: ['data:image/png;base64,YWJj'],
      },
    ],
    undefined,
    true,
    undefined,
    undefined,
    { model, schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
  );
  assert.equal(JSON.parse(result.content).accepted, true);
  assert.equal(bodies.length, 2);
  assert(bodies.every((b) => b.model === model));
  assert.equal(bodies[1].stream, true);
  assert(!bodies[1].response_format);
  assert.match(bodies[1].messages[0].content, /contract/);
});

test('Compact NIM contracts resolve reused vectors as arrays, preserving length and numeric type', () => {
  assert.equal(
    require('../core/providers/task-profile.cjs').roleFor({
      spatialReasoning: true,
      complexity: 'simple',
      confidence: 1,
    }),
    'deep',
  );
  const { compactContract } = require('../core/providers/nvidia.cjs');
  const root = {
    type: 'object',
    properties: {
      location: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      rotation: { $ref: '#/properties/location' },
    },
  };
  const result = compactContract(root);
  assert.deepEqual(result.properties.rotation, result.properties.location);
  assert.equal(result.properties.rotation.type, 'array');
  assert.equal(result.properties.rotation.minItems, 3);
  assert.equal(result.properties.rotation.items.type, 'number');
});

test('A weak render causes a bounded revision using the same semantic contract and retains project identity', async (t) => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jarvis-revision-test-'));
  t.after(() => {
    assert(
      path.resolve(directory).startsWith(path.resolve(require('node:os').tmpdir()) + path.sep),
    );
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const render = path.join(directory, 'render.png');
  fs.writeFileSync(render, Buffer.from('fixture'));
  const plan = {
    title: 'Monitor',
    design: {
      category: 'Monitor',
      silhouette: 'Wide thin display on a stand',
      proportions: 'Display broader than base',
      features: ['display', 'bezel', 'stand'],
    },
    materials: [
      {
        name: 'Metal',
        color: [0.1, 0.1, 0.1, 1],
        metallic: 0.6,
        roughness: 0.3,
        emission: [0, 0, 0, 1],
        strength: 0,
      },
    ],
    objects: [
      {
        name: 'Display',
        kind: 'cube',
        location: [0, 0, 0],
        rotation: [0, 0, 0],
        dimensions: [3, 0.2, 2],
        material: 'Metal',
        bevel: 0.02,
      },
    ],
    lights: [{ name: 'Key', location: [3, 3, 4], energy: 500, size: 3 }],
    camera: { location: [5, 5, 5], target: [0, 0, 0], orthoScale: 5 },
  };
  let planning = 0,
    reviews = 0,
    builds = 0;
  const service = {
    queue: Promise.resolve(),
    config: () => ({ blenderIterations: 3 }),
    emit: () => {},
    ai: {
      chat: async (_messages, tools) => {
        if (tools) {
          planning++;
          assert(!JSON.stringify(tools).includes('create_mesh'));
          return { tool_calls: [{ function: { name: 'submit_blender_plan', arguments: plan } }] };
        }
        reviews++;
        return {
          content: JSON.stringify({
            accepted: reviews > 1,
            recognizable: reviews > 1,
            missingFeatures: reviews > 1 ? [] : ['Stand'],
            findings: [],
          }),
        };
      },
    },
    perform: async (input, _signal, rebuild) => {
      builds++;
      assert(rebuild);
      if (builds > 1) assert.equal(input.projectId, 'owned-project');
      return {
        verified: true,
        projectId: 'owned-project',
        revision: builds,
        exports: [{ format: 'PNG', path: render }],
      };
    },
  };
  const result = await require('../core/blender/illustration.cjs').design(
    service,
    { goal: 'Make a simplified monitor' },
    new AbortController().signal,
  );
  assert.equal(planning, 2);
  assert.equal(builds, 2);
  assert.equal(result.quality.reviews, 2);
  assert(result.quality.accepted && result.quality.recognizable);
  assert.equal(result.quality.history[0].accepted, false);
});
test('Text pagination preserves exact content, complete words and responsive capacity', () => {
  const ts = require('typescript'),
    module = { exports: {} };
  const js = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../frontend/MeasuredText.tsx'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  new Function('require', 'module', 'exports', js)(require, module, module.exports);
  const { paginateText } = module.exports;
  const text =
    'A coherent paragraph contains complete words and useful details. '.repeat(10) +
    '\n\nSecond paragraph ends here.';
  const sizes = [100, 250, 2000, 100];
  const counts = sizes.map((size) => {
    const pages = paginateText(text, (part) => part.length <= size);
    assert.equal(pages.map((p) => text.slice(p.start, p.end)).join(''), text);
    for (const p of pages) if (p.end < text.length) assert.match(text[p.end - 1], /\s/);
    return pages.length;
  });
  assert(counts[0] > counts[1]);
  assert.equal(counts[2], 1);
  assert.equal(counts[3], counts[0]);
});
test('Comparison relevance favors sourced core metrics over playback power without inventing values', () => {
  const { candidates } = require('../core/agent/chart-candidates.cjs');
  const source = {
    id: 'official',
    url: 'https://maker.example/specs',
    tables: [
      {
        rows: [
          ['', 'Product A', 'Product B'],
          ['Video Playback Power (W)', '11', '13'],
          ['CUDA Cores', '3000', '4000'],
        ],
      },
    ],
  };
  const result = candidates([source], ['Product A', 'Product B']);
  assert.equal(result[0].title, 'CUDA Cores');
  assert.deepEqual(
    result[0].data.map((d) => d.value),
    [3000, 4000],
  );
  assert(result[0].relevance > result[1].relevance);
});
test('Failed visual review cannot discard valid preview dependency or falsely complete the task', async () => {
  const { validatePlan, schedule } = require('../core/agent/task-graph.cjs');
  const plan = validatePlan({
    nodes: [
      { id: 'design', kind: 'design', goal: 'Make an industrial object', dependsOn: [] },
      { id: 'preview', kind: 'preview', goal: 'Show exported object', dependsOn: ['design'] },
      { id: 'save', kind: 'save', goal: 'Persist available files', dependsOn: ['preview'] },
    ],
  });
  const executed = [];
  await schedule(
    plan.nodes,
    async (node) => {
      executed.push(node.kind);
      if (node.kind === 'review')
        throw Object.assign(Error('Missing identifying features'), {
          code: 'DESIGN_QUALITY_REJECTED',
        });
    },
    () => {},
  );
  assert.deepEqual(executed, ['design', 'review', 'preview', 'save']);
  assert.equal(plan.nodes.find((n) => n.kind === 'review').state, 'FAILED');
  assert.equal(plan.nodes.find((n) => n.kind === 'preview').state, 'SUCCEEDED');
});
test('Generic repeated geometry expands radial and linear features with bounded unique names', () => {
  const { expandObjects } = require('../core/blender/scene-plan.cjs');
  const part = {
    name: 'Blade',
    location: [1, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 0.1, 0.1],
  };
  const radial = expandObjects([
    {
      ...part,
      repeat: { count: 4, center: [0, 0, 0], translation: [0, 0, 0], rotation: [0, 0, 90] },
    },
  ]);
  assert.equal(radial.length, 4);
  assert.equal(new Set(radial.map((p) => p.name)).size, 4);
  assert(Math.abs(radial[1].location[0]) < 1e-10);
  assert.equal(radial[1].location[1], 1);
  const linear = expandObjects([
    {
      ...part,
      repeat: { count: 3, center: [0, 0, 0], translation: [0.2, 0, 0], rotation: [0, 0, 0] },
    },
  ]);
  assert.equal(linear[2].location[0], 1.4);
  assert.throws(
    () =>
      expandObjects(
        Array.from({ length: 4 }, () => ({
          ...part,
          repeat: { count: 16, center: [0, 0, 0], translation: [0, 0, 0], rotation: [0, 0, 0] },
        })),
      ),
    /56/,
  );
});

test('Round-shape normals specify orientation once and reject swapped radial/thickness dimensions', () => {
  const { normalRotation, illustrationPlan, toBatch } = require('../core/blender/scene-plan.cjs');
  assert.deepEqual(normalRotation([0, 0, 1]), [0, 0, 0]);
  assert.deepEqual(normalRotation([0, 1, 0]), [0, 90, 90]);
  assert.deepEqual(normalRotation([1, 0, 0]), [0, 90, 0]);
  const base = {
    title: 'Wheel',
    design: {
      category: 'Wheel',
      silhouette: 'Circular wheel',
      proportions: 'Shallow round part',
      features: ['ring', 'rim', 'hub'],
    },
    materials: [{ name: 'Metal', color: [0.1, 0.1, 0.1, 1], metallic: 0.5, roughness: 0.3 }],
    objects: [
      {
        name: 'Rim',
        kind: 'torus',
        location: [0, 0, 0],
        rotation: [0, 0, 0],
        normal: [0, 1, 0],
        dimensions: [1, 1, 0.1],
        material: 'Metal',
      },
    ],
    lights: [{ name: 'Key', location: [3, 3, 4], energy: 500, size: 3 }],
    camera: { location: [3, 3, 3], target: [0, 0, 0], orthoScale: 4 },
  };
  const parsed = illustrationPlan.parse(base);
  const primitive = toBatch(parsed).operations.find((o) => o.op === 'create_primitive');
  assert.deepEqual(primitive.rotation, [0, 90, 90]);
  assert.deepEqual(primitive.dimensions, [1, 1, 0.1]);
  assert(!('normal' in primitive));
  assert(
    !illustrationPlan.safeParse({
      ...base,
      objects: [{ ...base.objects[0], dimensions: [0.1, 1, 1] }],
    }).success,
  );
  assert(
    !illustrationPlan.safeParse({
      ...base,
      objects: [{ ...base.objects[0], rotation: [90, 0, 0] }],
    }).success,
  );
});
test('Nine research cards have nonoverlapping automatic layouts and a dominant primary', () => {
  const { arrange, overlaps } = require('../core/research-choreography.cjs');
  const workspace = {
    responseMode: 'FULL_WORKSPACE',
    modules: Array.from({ length: 9 }, (_, i) => ({ id: String(i), state: 'ready' })),
  };
  arrange(workspace, '8');
  for (let i = 0; i < 9; i++)
    for (let j = i + 1; j < 9; j++)
      assert(!overlaps(workspace.modules[i].layout, workspace.modules[j].layout));
  const area = (m) => m.layout.width * m.layout.height;
  assert(area(workspace.modules[8]) > area(workspace.modules[0]) * 2);
});

test('A design deadline preserves only its verified call-scoped artifacts while review remains incomplete', async (t) => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jarvis-handoff-test-'));
  t.after(() => {
    assert(
      path.resolve(directory).startsWith(path.resolve(require('node:os').tmpdir()) + path.sep),
    );
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const blendPath = path.join(directory, 'scene.blend'),
    renderPath = path.join(directory, 'render.png'),
    glbPath = path.join(directory, 'model.glb');
  fs.writeFileSync(blendPath, Buffer.concat([Buffer.from('BLENDER'), Buffer.alloc(30)]));
  fs.writeFileSync(
    renderPath,
    Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(30)]),
  );
  const json = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, nodes: [], meshes: [] }).padEnd(80, ' '),
  );
  const glb = Buffer.alloc(20 + json.length);
  glb.write('glTF');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  fs.writeFileSync(glbPath, glb);
  const { TaskGraph } = require('../core/agent/task-graph.cjs');
  const graph = Object.create(TaskGraph.prototype);
  let session;
  const artifact = {
    verified: true,
    projectId: 'project',
    blendPath,
    revision: 2,
    exports: [
      { format: 'PNG', path: renderPath },
      { format: 'GLB', path: glbPath, assetId: 'asset' },
    ],
  };
  graph.agent = { controller: new AbortController() };
  graph.context = {};
  graph.outputs = {};
  graph.host = {
    workspace: { current: { modules: [{ id: 'model', panels: [{ assetId: 'asset' }] }] } },
    modelArtifacts: (id) => (id === session ? artifact : undefined),
    modelPreviewStatus: () => ({ loaded: true }),
  };
  graph.tool = async (_name, args) => {
    session = args.artifactSession;
    throw Object.assign(Error('Design deadline'), { code: 'tool_timeout' });
  };
  const result = await graph.design({ id: 'design', goal: 'Make a monitor' });
  assert.equal(result.artifactSession, session);
  assert.equal(result.artifacts.glbPath, glbPath);
  assert.equal(result.quality.accepted, false);
  graph.outputs.design = result;
  await assert.rejects(graph.review({ dependsOn: ['design'] }), {
    code: 'VISUAL_REVIEW_UNAVAILABLE',
  });
  assert.equal((await graph.preview({ dependsOn: ['design'] })).loaded, true);
  graph.host.modelArtifacts = () => undefined;
  await assert.rejects(graph.design({ goal: 'Another object' }), { code: 'tool_timeout' });
  graph.host.modelArtifacts = () => artifact;
  graph.agent.controller.abort();
  await assert.rejects(graph.design({ goal: 'Cancelled object' }), { name: 'AbortError' });
});
