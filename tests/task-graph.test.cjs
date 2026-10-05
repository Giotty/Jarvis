const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, schedule } = require('../core/agent/task-graph.cjs');
const { input, normalize, NvidiaProvider } = require('../core/providers/nvidia.cjs');
const { ProviderError } = require('../core/providers/base.cjs');
const { safeError } = require('../core/providers/diagnostics.cjs');
const { makeBriefing } = require('../core/agent/presentation-draft.cjs');
const { extract } = require('../core/research-agent.cjs');
test('Missing structured planner output gets one bounded repair with a larger allowance', async () => {
  const { TaskGraph } = require('../core/agent/task-graph.cjs');
  const { z } = require('zod');
  const graph = Object.create(TaskGraph.prototype),
    allowances = [];
  graph.agent = {
    controller: new AbortController(),
    ai: {
      chat: async (...args) => {
        allowances.push(args[5].outputTokens);
        return allowances.length === 1
          ? { content: 'incomplete' }
          : { tool_calls: [{ function: { name: 'submit_task_result', arguments: { value: 7 } } }] };
      },
    },
  };
  assert.deepEqual(
    await graph.structured('Return data', {}, z.object({ value: z.number() }).strict(), 2300),
    { value: 7 },
  );
  assert.deepEqual(allowances, [2300, 3324]);
});
test('All evidence reaches semantic assessment without topic-specific filtering', () => {
  const { TaskGraph } = require('../core/agent/task-graph.cjs');
  const sources = new Map([
    [
      'correct',
      {
        id: 'correct',
        title: 'GeForce RTX 5090 Review',
        url: 'https://www.techspot.com/review/123-gpu/',
      },
    ],
    [
      'wrong',
      {
        id: 'wrong',
        title: 'Intel Arc A380 Review',
        url: 'https://www.techspot.com/review/124-rtx-5090/',
      },
    ],
    [
      'generic',
      { id: 'generic', title: 'GPU Mining is Dead', url: 'https://www.techspot.com/article/125/' },
    ],
  ]);
  const graph = Object.create(TaskGraph.prototype);
  graph.sources = new Set(sources.keys());
  graph.host = { briefing: { sources } };
  graph.context = {
    hardware: { identity: 'NVIDIA GeForce RTX 5090' },
    researchPlan: { entities: ['NVIDIA GeForce RTX 5090'] },
  };
  assert.deepEqual(
    graph.evidence().map((s) => s.id),
    ['correct','wrong','generic'],
  );
});
test('Graph recovery continues independent creation and saving after research/image failure', async () => {
  const plan = validatePlan({
    nodes: [
      {
        id: 'identity',
        kind: 'inspect',
        goal: 'Identify a processor',
        component: 'cpu',
        dependsOn: [],
      },
      {
        id: 'research',
        kind: 'research',
        goal: 'Find reliable processor evidence',
        dependsOn: ['identity'],
      },
      { id: 'images', kind: 'images', goal: 'Find imagery', dependsOn: ['research'] },
      {
        id: 'present',
        kind: 'presentation',
        goal: 'Present sourced evidence',
        dependsOn: [], optionalDependsOn:['research','images'],
      },
      {
        id: 'design',
        kind: 'design',
        goal: 'Create an illustrative processor sculpture',
        dependsOn: [], optionalDependsOn:['research'],
      },
      {
        id: 'save',
        kind: 'save',
        goal: 'Save available outputs',
        dependsOn: [], optionalDependsOn:['design','present'],
        folder: 'Processors',
      },
    ],
  });
  const executed = [];
  await schedule(
    plan.nodes,
    async (n) => {
      executed.push(n.kind);
      if (['research', 'images'].includes(n.kind)) throw Error('Fixture source outage');
    },
    () => {},
  );
  assert.deepEqual(executed,['inspect','research','presentation','design','save','review']);
  assert.equal(plan.nodes.find(n=>n.id==='images').state,'BLOCKED');
  assert.equal(plan.nodes.find(n=>n.id==='design').state,'SUCCEEDED');
});
test('Semantic action nodes are preserved without prompt-string rewriting',()=>{
 const plan=validatePlan({nodes:[{id:'design',kind:'design',goal:'Create an illustrated monitor',dependsOn:[]},{id:'render',kind:'action',goal:'Render the Blender scene',dependsOn:['design']},{id:'preview',kind:'preview',goal:'Load the GLB',dependsOn:['render']}]});
 assert.deepEqual(plan.nodes.map(n=>n.kind),['design','action','preview','review']);
 assert.deepEqual(plan.nodes[2].dependsOn,['render']);
});

test('Graph rejects cycles/missing predecessors and blocks genuine unavailable identity', async () => {
  assert.throws(
    () => validatePlan({ nodes: [{ id: 'x', kind: 'research', goal: 'Read', dependsOn: ['x'] }] }),
    /dependency/,
  );
  const plan = validatePlan({
    nodes: [
      { id: 'i', kind: 'inspect', goal: 'Read monitor identity', dependsOn: [] },
      { id: 'r', kind: 'research', goal: 'Research the verified monitor', dependsOn: ['i'] },
      { id: 's', kind: 'save', goal: 'Save whatever exists', dependsOn: ['r'] },
    ],
  });
  await schedule(
    plan.nodes,
    async (n) => {
      if (n.kind === 'inspect') throw Error('No device');
    },
    () => {},
  );
  assert.deepEqual(
    plan.nodes.map((n) => n.state),
    ['FAILED', 'BLOCKED', 'BLOCKED'],
  );
});
test('Valid forward references are ordered while cycles remain invalid', () => {
  const plan = validatePlan({
    nodes: [
      { id: 'read', kind: 'research', goal: 'Research after identity', dependsOn: ['identity'] },
      { id: 'identity', kind: 'inspect', goal: 'Inspect actual processor', dependsOn: [] },
    ],
  });
  assert.deepEqual(
    plan.nodes.map((n) => n.id),
    ['identity', 'read'],
  );
  assert.throws(
    () =>
      validatePlan({
        nodes: [
          { id: 'a', kind: 'action', goal: 'A', dependsOn: ['b'] },
          { id: 'b', kind: 'action', goal: 'B', dependsOn: ['a'] },
        ],
      }),
    /cyclic/,
  );
});
test('Independent entity research branches retain semantic dependencies',()=>{
 const plan=validatePlan({nodes:[{id:'a',kind:'research',goal:'Read moon A',dependsOn:[]},{id:'b',kind:'research',goal:'Read moon B',dependsOn:[]},{id:'p',kind:'presentation',goal:'Compare moons',dependsOn:['a','b']}]});
 assert.equal(plan.nodes.filter(n=>n.kind==='research').length,2);
 assert.deepEqual(plan.nodes[2].dependsOn,['a','b']);
});

test('NIM has one combined system instruction including the host contract', () => {
  const m = input([
    { role: 'system', content: 'EXACT CONTRACT' },
    { role: 'system', content: 'TASK INSTRUCTIONS' },
    { role: 'user', content: 'REQUEST' },
  ]);
  assert.deepEqual(
    m.map((x) => x.role),
    ['system', 'user'],
  );
  assert.match(m[0].content, /EXACT CONTRACT[\s\S]*TASK INSTRUCTIONS/);
});
test('Token-limited responses remain visibly truncated; incomplete tool arguments never execute', () => {
  assert.equal(
    normalize({ choices: [{ finish_reason: 'length', message: { content: 'Partial answer' } }] })
      .truncated,
    true,
  );
  assert.throws(
    () =>
      normalize({
        choices: [
          {
            finish_reason: 'length',
            message: { tool_calls: [{ function: { name: 'write_file', arguments: '{"text":' } }] },
          },
        ],
      }),
    { code: 'malformed_tool_call' },
  );
});
test('Provider error categories distinguish HTTP, capability, parsing and transport failures', () => {
  for (const [code, category] of Object.entries({
    http_401: 'AUTH_ERROR',
    http_404: 'MODEL_NOT_FOUND',
    http_429: 'RATE_LIMIT',
    timeout: 'TIMEOUT',
    http_400: 'BAD_REQUEST',
    unsupported_parameter: 'UNSUPPORTED_PARAMETER',
    vision_unsupported: 'VISION_NOT_SUPPORTED',
    tools_unsupported: 'TOOLS_NOT_SUPPORTED',
    malformed_stream: 'STREAM_PARSE_ERROR',
    empty_response: 'MALFORMED_RESPONSE',
    network: 'NETWORK_OFFLINE',
    http_500: 'SERVER_ERROR',
    structured_output_unsupported: 'ROUTER_CAPABILITY_MISMATCH',
  }))
    assert.equal(new ProviderError(code).category, category);
  assert.equal(
    safeError('Bearer nvapi-fixture-secret https://example.com/a C:\\Private\\file'),
    '[REDACTED] [URL] [PATH]',
  );
});
test('A rejected constrained JSON format recovers on the same model with a changed request', async () => {
  const bodies = [];
  const model = 'nvidia/nemotron-3.5-lightning-30b-a3b';
  const provider = new NvidiaProvider({
    config: () => ({ nvidiaFreeEndpoint: true, nvidiaDailyCap: 10, nvidiaModel: model }),
    secrets: { get: () => 'fixture' },
    fetcher: async (_url, request) => {
      const body = JSON.parse(request.body);
      bodies.push(body);
      if (body.response_format)
        return new Response(
          JSON.stringify({ error: { message: 'Failed to parse chat completion response' } }),
          { status: 500 },
        );
      return new Response(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: '{"value":7}' }, finish_reason: 'stop' }],
          }) +
          '\n\n',
      );
    },
  });
  const result = await provider.chat(
    [
      { role: 'system', content: 'Return a number' },
      { role: 'user', content: '7' },
    ],
    undefined,
    false,
    undefined,
    undefined,
    { schema: { type: 'object', properties: { value: { type: 'integer' } } }, jsonObject: true },
  );
  assert.equal(JSON.parse(result.content).value, 7);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].model, bodies[1].model);
  assert.ok(!bodies[1].response_format);
  assert.equal(bodies[1].stream, true);
  assert.match(bodies[1].messages[0].content, /contract/);
});
test('Table charts use retrieved cell values and reject invented rows or mixed units', () => {
  const source = {
    id: 'review',
    readable: true,
    ...extract(
      '<title>Processor review</title><table><tr><th>CPU</th><th>Cores</th><th>Boost</th></tr><tr><td>Processor A</td><td>8</td><td>4.8 GHz</td></tr><tr><td>Processor B</td><td>12</td><td>5200 MHz</td></tr></table>',
      'https://example.com/review',
    ),
  };
  const draft = {
    title: 'Processors',
    cards: [{ title: 'Comparison', body: 'Verified table', sourceIds: ['review'], facts: [] }],
    chart: {
      title: 'Requested comparison',
      unit: '',
      values: [{ label: 'Invented', value: 999 }],
      table: {
        sourceId: 'review',
        tableIndex: 0,
        axis: 'rows',
        metricIndex: 1,
        labels: ['Processor A', 'Processor B'],
      },
    },
  };
  const b = makeBriefing(structuredClone(draft), [source]);
  assert.deepEqual(b.scenes.find((s) => s.panels[0].type === 'bar').panels[0].data, [
    { label: 'Processor A', value: 8 },
    { label: 'Processor B', value: 12 },
  ]);
  const mixed = structuredClone(draft);
  mixed.chart.table.metricIndex = 2;
  assert.throws(() => makeBriefing(mixed, [source]), /different units/);
  const invented = structuredClone(draft);
  invented.chart.table.labels[1] = 'Processor C';
  assert.throws(() => makeBriefing(invented, [source]), /not a single/);
});
test('Image panels bind loaded registered IDs to their actual owning sources', () => {
  const id = 'b663703d-94b2-4e26-9627-179cbd72be0b';
  const draft = {
    title: 'Monitor',
    cards: [{ title: 'Details', body: 'Public specs', sourceIds: ['specs'], facts: [] }],
    chart: null,
  };
  const sources = [
    { id: 'specs', url: 'https://example.com/specs', images: [] },
    { id: 'photos', url: 'https://example.com/photos', images: [{ id }] },
  ];
  const briefing = makeBriefing(draft, sources, [id], { images: true });
  assert.deepEqual(briefing.scenes.find((s) => s.panels[0].type === 'images').panels[0].sourceIds, [
    'photos',
  ]);
  assert.throws(() => makeBriefing(draft, sources, [], { images: true }), /image bytes/);
});
test('Transposed manufacturer tables extract one metric across product columns', () => {
  const source = {
    id: 'official',
    url: 'https://example.com/specs',
    tables: [
      {
        rows: [
          ['', 'CPU A', 'CPU B'],
          ['Cores', '8', '12'],
          ['Boost (GHz)', '4.8', '5.2'],
        ],
      },
    ],
    text: '',
  };
  const draft = {
    title: 'Processors',
    cards: [
      { title: 'Specs', body: 'Observed manufacturer table', facts: [], sourceIds: ['official'] },
    ],
    chart: {
      title: 'Comparison',
      unit: '',
      values: [],
      table: {
        sourceId: 'official',
        tableIndex: 0,
        axis: 'columns',
        metricIndex: 1,
        labels: ['CPU A', 'CPU B'],
      },
    },
  };
  const panel = makeBriefing(draft, [source]).scenes.find((s) => s.panels[0].type === 'bar')
    .panels[0];
  assert.deepEqual(panel.data, [
    { label: 'CPU A', value: 8 },
    { label: 'CPU B', value: 12 },
  ]);
  assert.equal(panel.unit, 'Cores');
});
test('Semantic facts bind arbitrary entities to exact retrieved evidence',()=>{
 const {verifyFacts}=require('../core/agent/semantic-research.cjs');
 const source={id:'observation',url:'https://example.com',readable:true,text:'Europa has a diameter of 3,122 km.'};
 const fact={entity:'Europa',label:'Diameter',value:'3,122 km',quote:source.text,sourceId:source.id};
 assert.equal(verifyFacts([fact],[source])[0].value,'3,122 km');
 assert.throws(()=>verifyFacts([{...fact,value:'4,000 km'}],[source]),/quotation/);
 assert.throws(()=>verifyFacts([{...fact,sourceId:'invented'}],[source]),/quotation/);
});

test('Large tool grammars are compact before the first request and retain host constraints', async () => {
  const bodies = [],
    model = 'nvidia/nemotron-3.5-lightning-30b-a3b';
  const provider = new NvidiaProvider({
    config: () => ({ nvidiaFreeEndpoint: true, nvidiaDailyCap: 10, nvidiaModel: model }),
    secrets: { get: () => 'fixture' },
    fetcher: async (_url, r) => {
      const body = JSON.parse(r.body);
      bodies.push(body);
      if (body.tools[0].function.parameters.properties.objects.items.anyOf)
        return new Response('{"error":"Internal server error"}', { status: 500 });
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'scene',
                      arguments: '{"objects":[{"kind":"cube","size":2}]}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    },
  });
  const union = {
    anyOf: Array.from({ length: 30 }, (_, i) => ({
      type: 'object',
      properties: {
        kind: { enum: ['shape' + i], description: 'x'.repeat(200) },
        size: { type: 'number' },
      },
    })),
  };
  const tools = [
    {
      type: 'function',
      function: {
        name: 'scene',
        parameters: { type: 'object', properties: { objects: { type: 'array', items: union } } },
      },
    },
  ];
  await provider.chat([{ role: 'user', content: 'Make a scene' }], tools, false);
  assert.equal(bodies.length, 1);
  assert.ok(!bodies[0].tools[0].function.parameters.properties.objects.items.anyOf);
  assert.match(bodies[0].messages[0].content, /complete contracts/);
  const { compactContract } = require('../core/providers/nvidia.cjs');
  assert.equal(compactContract({ type: 'number' }, 10).type, 'number');
});
test('Local vision fallback converts cloud data URLs to the raw base64 Ollama protocol', async () => {
  const { Ollama } = require('../core/ollama.cjs');
  const local = new Ollama(() => ({ model: 'vision-fixture', visionModel: 'vision-fixture' }));
  local.capabilities = async () => ['vision'];
  let body;
  local.request = async (route, payload) => {
    assert.equal(route, '/api/chat');
    body = payload;
    return { message: { role: 'assistant', content: 'red' }, done_reason: 'stop' };
  };
  await local.chat(
    [{ role: 'user', content: 'Inspect render', images: ['data:image/png;base64,YWJj', 'YWJj'] }],
    undefined,
    true,
  );
  assert.deepEqual(body.messages[0].images, ['YWJj', 'YWJj']);
});
test('Comparison catalog pairs exact products and publishes only observed, cross-checked values', () => {
  const { candidates, facts } = require('../core/agent/chart-candidates.cjs');
  const a = {
    id: 'manufacturer',
    url: 'https://maker.example/specs',
    tables: [
      {
        rows: [
          ['CPU', 'Cores', 'Price'],
          ['Processor A', '8', '$300'],
          ['Processor B', '12', '$400'],
          ['Processor C', '24', '$600'],
        ],
      },
    ],
  };
  const b = {
    id: 'review',
    url: 'https://review.example/article',
    tables: [
      {
        rows: [
          ['', 'Processor A', 'Processor B'],
          ['Cores', '8', '12'],
        ],
      },
    ],
  };
  const result = candidates([a, b], ['Processor A', 'Processor B']);
  assert.equal(result.filter(c=>c.title==='Cores').length, 2);
  assert.ok(result.filter(c=>c.title==='Cores').every((c) => c.crossChecked));
  assert.ok(result.every(c=>c.title==='Cores'));
  assert.deepEqual(
    result[0].data.map((d) => d.value),
    [8, 12],
  );
  assert.ok(
    facts([a, b], ['Processor A', 'Processor B']).filter(f=>f.label==='Cores').every((f) => ['8', '12'].includes(f.value)),
  );
  assert.deepEqual(candidates([a], ['Processor A', 'Unobserved product']), []);
  assert.deepEqual(candidates([a], ['Processor A', 'Processor A']), []);
  assert.deepEqual(
    facts([a], ['Processor A', 'Processor B']).map((f) => f.id),
    ['f1', 'f2', 'f3', 'f4'],
  );
});
test('Closed logging pipes cannot crash the desktop; unrelated stream errors remain visible', () => {
  const { spawnSync } = require('node:child_process');
  const guard = require.resolve('../core/log-pipe.cjs');
  const script = `require(${JSON.stringify(guard)}).protectLogPipes();process.stdout.emit('error',Object.assign(new Error('closed'),{code:process.argv[1]}));process.stdout.write('alive');`;
  const pipe = spawnSync(process.execPath, ['-e', script, 'EPIPE'], { encoding: 'utf8' });
  assert.equal(pipe.status, 0);
  assert.equal(pipe.stdout, 'alive');
  const other = spawnSync(process.execPath, ['-e', script, 'EIO'], { encoding: 'utf8' });
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /closed/);
});
test('Unverified benchmark prose is omitted while sourced cards retain qualitative analysis', () => {
  const { qualitativeNarration } = require('../core/agent/presentation-draft.cjs');
  assert.deepEqual(
    qualitativeNarration(
      'Efficient for compact systems. It is 35% faster in games. Limited memory can constrain demanding workloads.',
    ),
    {
      text: 'Efficient for compact systems. Limited memory can constrain demanding workloads.',
      removed: 1,
    },
  );
  assert.deepEqual(qualitativeNarration('It achieves 100 FPS.'), { text: '', removed: 1 });
});
test('Generic excerpt catalog retains observed text without topic-specific classification',()=>{
 const {quotes}=require('../core/agent/chart-candidates.cjs');
 const sentence='This moon has a surface dominated by bright icy terrain and a dark fractured crust.';
 const result=quotes([{id:'science',text:sentence+'\nMetric | 8 | 9'}]);
 assert.equal(result[0].text,sentence);assert.equal(result[0].kind,'context');assert.equal(result.length,1);
});
