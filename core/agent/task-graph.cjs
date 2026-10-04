const crypto = require('node:crypto');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');
const { publicError } = require('../agent-errors.cjs');
const planSchema = z
  .object({
    requirements: z
      .object({
        images: z.boolean(),
        chart: z.boolean(),
        comparison: z.boolean(),
        folder: z.string().max(80).nullable(),
        model3d: z.boolean(),
        render: z.boolean(),
      })
      .strict()
      .optional(),
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            kind: z.enum([
              'inspect',
              'research',
              'images',
              'presentation',
              'design',
              'preview',
              'save',
              'action',
            ]),
            goal: z.string().min(1).max(1800),
            dependsOn: z.array(z.string()).max(12),
            component: z.enum(['gpu', 'cpu', 'memory', 'all']).optional(),
            folder: z.string().max(80).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(18),
  })
  .strict();
function ordered(nodes) {
  const ids = new Set(nodes.map((n) => n.id)),
    seen = new Set(),
    pending = [...nodes],
    result = [];
  if (ids.size !== nodes.length || nodes.some((n) => n.dependsOn.some((id) => !ids.has(id))))
    throw Error('Task graph has a duplicate, missing or cyclic dependency.');
  while (pending.length) {
    const at = pending.findIndex((n) => n.dependsOn.every((id) => seen.has(id)));
    if (at < 0) throw Error('Task graph has a duplicate, missing or cyclic dependency.');
    const [node] = pending.splice(at, 1);
    seen.add(node.id);
    result.push(node);
  }
  return result;
}
function validatePlan(plan) {
  const p = planSchema.parse(plan);
  p.nodes = ordered(p.nodes);
  const design = p.nodes.find((n) => n.kind === 'design');
  if (design) {
    // Design already renders, exports and verifies its project.
    for (const render of p.nodes.filter(
      (n) =>
        n.kind === 'action' &&
        /\brender\b/i.test(n.goal) &&
        /\b(?:blender|3d|scene|model)\b/i.test(n.goal),
    )) {
      design.goal += ' ' + render.goal;
      p.nodes = p.nodes.filter((n) => n !== render);
      for (const node of p.nodes)
        node.dependsOn = [
          ...new Set(node.dependsOn.map((id) => (id === render.id ? design.id : id))),
        ].filter((id) => id !== node.id);
    }
  }
  // Enforce capability dependencies in the host, rather than trusting an LLM
  // to label every preceding goal as indispensable. The runner checks actual
  // evidence/files before declaring a stage successful.
  for (const node of p.nodes) {
    if (['design', 'images', 'presentation'].includes(node.kind))
      node.dependsOn = node.dependsOn.filter((id) =>
        ['inspect', 'action'].includes(p.nodes.find((n) => n.id === id).kind),
      );
    if (node.kind === 'save') node.dependsOn = [];
  }
  const firstPresentation = p.nodes.find((n) => n.kind === 'presentation');
  const firstResearch = p.nodes.find((n) => n.kind === 'research');
  if (firstResearch) {
    for (const duplicate of p.nodes.filter((n) => n.kind === 'research' && n !== firstResearch)) {
      firstResearch.goal += ' ' + duplicate.goal;
      p.nodes = p.nodes.filter((n) => n !== duplicate);
      for (const node of p.nodes)
        node.dependsOn = [
          ...new Set(node.dependsOn.map((id) => (id === duplicate.id ? firstResearch.id : id))),
        ].filter((id) => id !== node.id);
    }
    const researchIndex = p.nodes.indexOf(firstResearch);
    const firstDisplayIndex = p.nodes.findIndex((n) => ['images', 'presentation'].includes(n.kind));
    if (firstDisplayIndex >= 0 && researchIndex > firstDisplayIndex) {
      p.nodes.splice(researchIndex, 1);
      p.nodes.splice(firstDisplayIndex, 0, firstResearch);
    }
  }
  if (firstPresentation) {
    for (const duplicate of p.nodes.filter(
      (n) => n.kind === 'presentation' && n !== firstPresentation,
    )) {
      firstPresentation.goal += ' ' + duplicate.goal;
      p.nodes = p.nodes.filter((n) => n !== duplicate);
      for (const node of p.nodes)
        node.dependsOn = [
          ...new Set(node.dependsOn.map((id) => (id === duplicate.id ? firstPresentation.id : id))),
        ];
    }
  }
  if (firstPresentation) {
    for (const node of p.nodes.filter(
      (n) => n.kind === 'images' && p.nodes.indexOf(n) > p.nodes.indexOf(firstPresentation),
    )) {
      if (
        !node.dependsOn.some(
          (id) =>
            p.nodes.indexOf(p.nodes.find((n) => n.id === id)) >= p.nodes.indexOf(firstPresentation),
        )
      ) {
        p.nodes.splice(p.nodes.indexOf(node), 1);
        p.nodes.splice(p.nodes.indexOf(firstPresentation), 0, node);
      }
    }
    const earlySaves = p.nodes.filter(
      (n) => n.kind === 'save' && p.nodes.indexOf(n) < p.nodes.indexOf(firstPresentation),
    );
    for (const node of earlySaves) {
      p.nodes.splice(p.nodes.indexOf(node), 1);
      p.nodes.splice(p.nodes.indexOf(firstPresentation) + 1, 0, node);
    }
  }
  const requirements = p.requirements;
  if (requirements?.images && !p.nodes.some((n) => n.kind === 'images')) {
    const at = p.nodes.findIndex((n) => n.kind === 'presentation');
    p.nodes.splice(at < 0 ? p.nodes.length : at, 0, {
      id: 'required-images-' + crypto.randomUUID(),
      kind: 'images',
      goal: 'Retrieve relevant attributed images for the requested workspace.',
      dependsOn: [],
    });
  }
  if (requirements?.folder) {
    for (const node of p.nodes.filter((n) => n.kind === 'save')) node.folder = requirements.folder;
    const designIndex = p.nodes.findIndex((n) => n.kind === 'design');
    if (designIndex >= 0 && !p.nodes.slice(0, designIndex).some((n) => n.kind === 'save'))
      p.nodes.splice(designIndex, 0, {
        id: 'save-research-' + crypto.randomUUID(),
        kind: 'save',
        goal: 'Persist the verified research workspace before independent creation.',
        folder: requirements.folder,
        dependsOn: [],
      });
  }
  p.nodes = ordered(p.nodes);
  return p;
}
async function schedule(nodes, run, changed, signal) {
  for (const node of nodes) {
    signal?.throwIfAborted();
    if (node.dependsOn.some((id) => nodes.find((n) => n.id === id)?.state !== 'SUCCEEDED')) {
      node.state = 'BLOCKED';
      node.error = 'Required input is unavailable.';
      changed();
      continue;
    }
    node.state = 'RUNNING';
    changed();
    try {
      await run(node);
      node.state = 'SUCCEEDED';
    } catch (error) {
      signal?.throwIfAborted();
      node.state = 'FAILED';
      node.error = publicError(error);
      node.errorCode = error.code || error.name;
      node.diagnostic = error.issues?.map((i) => ({ code: i.code, path: i.path }));
      node.nonSecretReason = require('../providers/diagnostics.cjs').safeError(error.message);
    }
    changed();
  }
  return nodes;
}
class TaskGraph {
  constructor(agent) {
    this.agent = agent;
    this.host = agent.executor.host;
    this.outputs = {};
    this.sources = new Set();
    this.context = {};
  }
  async structured(
    system,
    data,
    schema,
    outputTokens = 2048,
    profile = { complexity: 'simple', confidence: 1 },
  ) {
    const contract = zodToJsonSchema(schema);
    const tools = [
      {
        type: 'function',
        function: {
          name: 'submit_task_result',
          description:
            'Return the requested planning data only. This function never executes computer actions.',
          parameters: contract,
        },
      },
    ];
    const options = {
      forceTool: { type: 'function', function: { name: 'submit_task_result' } },
      outputTokens,
      localOnly: this.agent.taskProfile?.privacy === 'local',
      profile,
    };
    const reply = await this.agent.ai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(data) },
      ],
      tools,
      false,
      this.agent.controller.signal,
      undefined,
      options,
    );
    let result = reply.tool_calls?.find((c) => c.function.name === 'submit_task_result')?.function
      .arguments;
    const parsed = schema.safeParse(result);
    if (parsed.success) return parsed.data;
    // Repair schema drift with the exact rejected fields; no tool executed yet.
    const repaired = await this.agent.ai.chat(
      [
        {
          role: 'system',
          content:
            system +
            '\nThe prior response was missing or invalid. Return the required function arguments, with concise goals and no prose outside the function. Match this exact JSON contract: ' +
            JSON.stringify(zodToJsonSchema(schema)),
        },
        { role: 'user', content: JSON.stringify({ data, validation: parsed.error.issues }) },
      ],
      tools,
      false,
      this.agent.controller.signal,
      undefined,
      { ...options, outputTokens: Math.min(8192, outputTokens + 1024) },
    );
    result = repaired.tool_calls?.find((c) => c.function.name === 'submit_task_result')?.function
      .arguments;
    return schema.parse(result);
  }
  async plan(request) {
    const p = await this.structured(
      'Decompose the original user request into a small ordered task graph. Do not execute it. Supported kinds: inspect (actual local hardware, component gpu/cpu/memory/all), research (one combined stage for all background public evidence and comparisons), images (public source images, before presentation), presentation (source-backed visual cards, specifications, strengths/weaknesses and requested charts), design (real Blender geometry/render/export/vision review/interactive GLB), preview (verify the interactive model has loaded; do not use action for this), save (persist the current workspace including 3D in the explicitly requested Library folder), action (other authorized tools). Separate unrelated goals. dependsOn contains ONLY indispensable inputs from earlier nodes: a design inspired by a subject depends on identity if necessary, never on successful research/images/presentation. A save after design should not depend on presentation succeeding. Include a research save AFTER presentation but before design and a final save after design when requested. Images failure must not block presentation. No summary node. Goal text preserves the user intent and all requested outputs; never guess the hardware model. Do not make browser interaction part of background research. Do not add actions beyond the request. Combine each capability into one node; use at most eight nodes with concise one-sentence goals.',
      {
        request,
        contractInstruction:
          'Always include requirements: whether images, chart, comparison, model3d and render were requested, and the exact requested folder name (or null). Do not omit requirements.',
      },
      planSchema.required({ requirements: true }),
      2300,
    );
    return validatePlan(p);
  }
  async tool(name, args, node) {
    const action = this.agent.registry.validate(name, args);
    const step = { ...action, callId: crypto.randomUUID(), nodeId: node.id, status: 'pending' };
    this.agent.active.steps.push(step);
    await this.agent.perform(step);
    if (!step.result?.success || !step.result.verified)
      throw Object.assign(Error(step.result?.message || 'Tool result was not verified.'), {
        code: step.result?.error || 'unverified_tool',
      });
    const ids = this.host.briefing?.observe(step) || [];
    ids.forEach((source) => this.sources.add(typeof source === 'string' ? source : source.id));
    return step.result;
  }
  evidence() {
    const all = [...this.sources].map((id) => this.host.briefing.sources.get(id)).filter(Boolean);
    const gpu = require('./product-hierarchy.cjs').gpuIdentity(this.context.hardware?.identity);
    if (!gpu || gpu.laptop) return all;
    const { authority } = require('../research-search.cjs');
    return all.filter(
      (s) =>
        s.url === 'https://jarvis.local/hardware' ||
        (authority(s) > 0 &&
          (this.context.researchPlan?.entities || [this.context.hardware.identity]).some(
            (entity) => {
              const subject = require('./product-hierarchy.cjs').gpuIdentity(entity);
              return subject && new RegExp('\\b' + subject.number + '\\b').test(s.title);
            },
          ) &&
          !/\b(?:laptop|notebook|i[3579][- ]?\d{4,5}[a-z]{1,3})\b/i.test(s.title)),
    );
  }
  publicContext() {
    return { hardware: this.context.hardware, researchPlan: this.context.researchPlan };
  }
  async inspect(node) {
    const r = await this.tool('inspect_hardware', { component: node.component || 'all' }, node);
    const selected =
      node.component === 'cpu' ? r.cpu : node.component === 'memory' ? r.memory : r.primaryGpu;
    this.context.hardware = {
      component: r.component,
      identity:
        r.component === 'memory'
          ? (r.memory.totalBytes / 1024 ** 3).toFixed(2) + ' GiB system memory'
          : selected?.name || r.primaryGpu?.name,
      graphics: ['gpu', 'all'].includes(r.component)
        ? r.graphics.map((g) => ({ name: g.name, vramMiB: g.vramMiB, verified: g.verified }))
        : undefined,
      cpu: ['cpu', 'all'].includes(r.component) ? r.cpu : undefined,
      memory: ['memory', 'all'].includes(r.component) ? r.memory : undefined,
    };
    if (this.agent.active.graph.some((n) => n.kind === 'presentation')) {
      const id = 'hardware:' + this.agent.active.id;
      const source = {
        id,
        title: 'Verified local hardware',
        url: 'https://jarvis.local/hardware',
        readable: true,
        text: JSON.stringify(this.context.hardware),
        images: [],
        fetchedAt: Date.now(),
      };
      this.host.briefing.sources.set(id, source);
      this.sources.add(id);
      await this.tool(
        'present_briefing',
        {
          title: 'Verified hardware',
          mode: 'replace',
          scenes: [
            {
              title: selected?.name || 'Local hardware',
              narration: 'I verified the hardware identity using local system tools.',
              panels: [
                {
                  type: 'metrics',
                  title: 'Detected hardware',
                  sourceIds: [id],
                  body: 'I identified this hardware using local system information.',
                  items: [
                    {
                      label: 'Hardware',
                      value: this.context.hardware.identity,
                      detail: 'Detected on this computer.',
                    },
                    ...(selected?.vramMiB
                      ? [
                          {
                            label: 'Video memory',
                            value: selected.vramMiB + ' MiB',
                            detail: 'Memory reported by the device.',
                          },
                        ]
                      : []),
                    ...(selected?.driver
                      ? [
                          {
                            label: 'Driver',
                            value: selected.driver,
                            detail: 'Installed driver version.',
                          },
                        ]
                      : []),
                  ],
                },
              ],
            },
          ],
        },
        node,
      );
    }
    return r;
  }
  async research(node) {
    if (this.context.researchPlan && node.dependsOn.some((id) => this.outputs[id]?.entities))
      return {
        ...this.outputs[node.dependsOn.find((id) => this.outputs[id]?.entities)],
        reusedVerifiedEvidence: true,
      };
    const schema = z
      .object({
        entities: z
          .array(z.string().min(1).max(100))
          .min(this.requirements?.comparison ? 2 : 1)
          .max(4),
        comparisonMode: this.requirements?.comparison
          ? z.enum(['adjacent', 'specified', 'multiple'])
          : z.enum(['none', 'adjacent', 'specified', 'multiple']),
        interpretation: z.string().max(300),
        queries: z.array(z.string().min(1).max(250)).min(1).max(5),
        officialUrls: z.array(z.string().url()).max(3),
        reviewUrls: z.array(z.string().url()).max(3),
      })
      .strict();
    const plan = await this.structured(
      'Plan precise background research using verified identity. Hardware comparisons stay in the same manufacturer, product generation, desktop/laptop class and adjacent performance tier; a suffix upgrade within the same tier comes before the next numbered tier if it exists. Briefly state the interpretation and verify it from official sources. Do not jump to newer generations. Use exact model identifiers in queries. Prioritize manufacturer specifications, then established independent reviews/benchmarks. No retail/affiliate pages or rumor/leak articles when official specifications exist. officialUrls/reviewUrls are optional known public pages; no invented facts. Static product specifications do not need the current year appended. For nonhardware requests apply the corresponding official and trustworthy public sources. Include strengths/weaknesses evidence.',
      {
        goal: node.goal,
        originalGoal: this.agent.request,
        requirements: this.requirements,
        instruction:
          'Choose the actual comparison model now, not just a query to identify it later. Use SHORT queries: exact product name + specifications or review; avoid long lists of desired metrics. Include an official-domain focused query.',
        ...this.publicContext(),
      },
      schema,
      1300,
    );
    this.context.researchPlan = plan;
    if (plan.comparisonMode === 'adjacent' && plan.entities.length > 2) {
      plan.entities = plan.entities.slice(0, 2);
      const identify = require('../research-search.cjs').productIdentifiers;
      const identifiers = plan.entities.flatMap(identify);
      plan.queries = plan.queries.filter((q) => !identify(q).some((n) => !identifiers.includes(n)));
      plan.officialUrls = plan.officialUrls.filter(
        (q) => !identify(q).some((n) => !identifiers.includes(n)),
      );
      plan.reviewUrls = plan.reviewUrls.filter(
        (q) => !(/rtx-|gtx-|rx-/i.test(q) && identify(q).some((n) => !identifiers.includes(n))),
      );
    }
    // Short identity queries recover engines that silently broaden long requests.
    // These are generated from the verified subject, never a particular device.
    const focus = plan.entities[0].replace(/^(?:NVIDIA\s+)?GeForce\s+/i, '');
    if (this.context.hardware?.identity)
      plan.queries = [
        ...new Set([
          focus + ' specifications',
          focus + ' review',
          focus + ' review site:techpowerup.com',
          focus + ' review conclusion pros cons',
          ...plan.queries,
        ]),
      ].slice(0, 6);
    const before = this.sources.size;
    for (const url of [...plan.officialUrls, ...plan.reviewUrls]) {
      try {
        await this.tool('extract_page_text', { url }, node);
      } catch (error) {
        this.agent.controller.signal.throwIfAborted();
        this.agent.emit('task-recovery', { node: node.id, code: error.code });
      }
    }
    for (const query of plan.queries) {
      try {
        await this.tool('web_search', { query, purpose: 'background' }, node);
      } catch (error) {
        this.agent.controller.signal.throwIfAborted();
        this.agent.emit('task-recovery', { node: node.id, code: error.code });
      }
      const readable = this.evidence().filter(
        (s) => s.readable !== false && s.url !== 'https://jarvis.local/hardware',
      );
      if (
        readable.length >= 3 &&
        new Set(readable.map((s) => new URL(s.url).hostname)).size >= 2 &&
        (!this.context.hardware?.graphics?.length ||
          readable.some(
            (s) =>
              require('../research-search.cjs').authority(s) === 0.5 &&
              /review|benchmark|spec/i.test(s.title),
          )) &&
        require('./chart-candidates.cjs')
          .quotes(readable, plan.entities)
          .some((quote) => quote.kind === 'limitation') &&
        plan.entities.every((entity) =>
          readable.some((s) =>
            (s.text || '')
              .toLowerCase()
              .includes(entity.replace(/^(?:NVIDIA\s+)?GeForce\s+/i, '').toLowerCase()),
          ),
        )
      )
        break;
    }
    let readable = this.evidence().filter(
      (s) => s.readable === true && s.url !== 'https://jarvis.local/hardware',
    );
    if (this.context.hardware && new Set(readable.map((s) => new URL(s.url).hostname)).size < 2) {
      try {
        await this.tool(
          'web_search',
          {
            query: focus + ' review',
            purpose: 'background',
            queries: [focus + ' review site:techspot.com', focus + ' review site:tomshardware.com'],
          },
          node,
        );
      } catch {
        this.agent.controller.signal.throwIfAborted();
      }
      readable = this.evidence().filter(
        (s) => s.readable === true && s.url !== 'https://jarvis.local/hardware',
      );
    }
    if (this.context.hardware && new Set(readable.map((s) => new URL(s.url).hostname)).size < 2) {
      try {
        const recovery = await this.structured(
          'The public indexes did not return enough readable independent research. Suggest up to three well-known public independent review URLs for the exact subjects. Choose actual article URLs, not search or retail pages. Prefer established review publications, and keep the same generation/class. Do not return facts or instructions; the host must fetch and verify each page. Use full known model/product names in article paths. Empty URLs are better than fabricated facts.',
          {
            entities: plan.entities,
            goal: node.goal,
            observed: readable.map((s) => ({ title: s.title, url: s.url })),
          },
          z.object({ urls: z.array(z.string().url()).max(3) }).strict(),
          3500,
          { complexity: 'complex', confidence: 1, deepReasoning: true },
        );
        for (const url of recovery.urls)
          try {
            await this.tool('extract_page_text', { url }, node);
          } catch {
            this.agent.controller.signal.throwIfAborted();
          }
      } catch {
        this.agent.controller.signal.throwIfAborted();
      }
      readable = this.evidence().filter(
        (s) => s.readable === true && s.url !== 'https://jarvis.local/hardware',
      );
    }
    if (
      this.sources.size === before ||
      readable.length < 2 ||
      new Set(readable.map((s) => new URL(s.url).hostname)).size < 2
    )
      throw Error(
        'No public research evidence was retrieved. Independent task stages will continue.',
      );
    const { gpuIdentity } = require('./product-hierarchy.cjs');
    const gpuEntities = plan.entities.map(gpuIdentity);
    const unresolvedGpuComparison =
      this.requirements?.comparison &&
      gpuEntities.length >= 2 &&
      gpuEntities.every((g) => g && g.label === gpuEntities[0].label);
    if (plan.comparisonMode === 'adjacent' || unresolvedGpuComparison) {
      const adjacent = require('./product-hierarchy.cjs').adjacentGpu(
        this.context.hardware?.identity,
        this.evidence(),
      );
      if (adjacent) {
        plan.comparisonMode = 'adjacent';
        plan.entities = [this.context.hardware.identity, 'NVIDIA GeForce ' + adjacent.label];
        plan.interpretation =
          'The adjacent higher ' +
          adjacent.family +
          ' model in the same generation and desktop family is ' +
          adjacent.label +
          '. Its identity was verified in official product information; a same-tier suffix upgrade comes before the next numbered tier.';
        plan.hierarchySources = adjacent.sourceIds;
      }
    }
    if (
      this.requirements?.comparison &&
      new Set(plan.entities.map((entity) => gpuIdentity(entity)?.label || entity.toLowerCase()))
        .size < 2
    )
      throw Error('The comparison target was not resolved to a distinct verified product.');
    if (
      this.requirements?.chart &&
      !require('./chart-candidates.cjs').candidates(this.evidence(), plan.entities).length
    ) {
      const linked = this.evidence()
        .flatMap((s) => s.links || [])
        .filter(
          (link) =>
            require('../research-search.cjs').authority(link) === 1 &&
            /spec|product|comparison/i.test(link.title),
        )
        .filter((link, index, all) => all.findIndex((other) => other.url === link.url) === index)
        .slice(0, 3);
      for (const link of linked) {
        try {
          await this.tool('extract_page_text', { url: link.url }, node);
        } catch {
          this.agent.controller.signal.throwIfAborted();
        }
        if (require('./chart-candidates.cjs').candidates(this.evidence(), plan.entities).length)
          break;
      }
    }
    // Require identity in evidence, not merely in a generated search query.
    for (const entity of plan.entities) {
      const identifiers = entity.match(/\d{3,5}(?:\s*Ti|\s*Super)?/gi) || [];
      if (
        identifiers.length &&
        !this.evidence().some((s) =>
          identifiers.every((v) =>
            (s.text || s.snippet || '').toLowerCase().includes(v.toLowerCase()),
          ),
        )
      )
        throw Error('The requested entity was not verified in the retrieved evidence.');
    }
    return {
      entities: plan.entities,
      interpretation: plan.interpretation,
      sources: this.sources.size - before,
    };
  }
  async images(node) {
    let images = this.evidence().flatMap((s) => s.images || []);
    if (!images.length) {
      for (const entity of this.context.researchPlan?.entities || []) {
        try {
          await this.tool('find_images', { query: entity + ' product' }, node);
        } catch {
          this.agent.controller.signal.throwIfAborted();
        }
      }
      images = this.evidence().flatMap((s) => s.images || []);
    }
    const verified = [];
    for (const image of images) {
      try {
        const result = await this.host.workspace.images.image(
          image.id,
          this.agent.controller.signal,
        );
        if (result.dataUrl?.length > 200) verified.push(image.id);
      } catch {
        this.agent.controller.signal.throwIfAborted();
      }
      if (verified.length === 3) break;
    }
    this.context.imageIds = verified;
    if (!verified.length)
      throw Error('No relevant public image could be loaded. Text research can continue.');
    return { images: verified.length, ids: verified, bytesVerified: true };
  }
  async presentation(node) {
    const { draftSchema, selectionDraftSchema, makeBriefing } = require('./presentation-draft.cjs');
    const evidence = this.evidence()
      .filter((s) => s.readable !== false)
      .map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        text: (s.text || s.snippet || '').slice(0, 12000),
        tables: s.tables || [],
        images: s.images || [],
      }));
    if (!evidence.some((s) => s.url !== 'https://jarvis.local/hardware'))
      throw Error(
        'No readable public research evidence is available. Independent creation can continue.',
      );
    const chartCandidates = require('./chart-candidates.cjs').candidates(
      evidence,
      this.context.researchPlan?.entities,
    );
    const factCandidates = require('./chart-candidates.cjs').facts(
      evidence,
      this.context.researchPlan?.entities,
    );
    const { z } = require('zod');
    const quoteCandidates = require('./chart-candidates.cjs').quotes(
      evidence,
      this.context.researchPlan?.entities,
    );
    const cardSchema = selectionDraftSchema.shape.cards.element.extend({
      quoteIds: quoteCandidates.length
        ? z.array(z.enum(quoteCandidates.map((q) => q.id))).max(2)
        : z.array(z.string()).max(0),
      factIds: factCandidates.length
        ? z.array(z.enum(factCandidates.map((f) => f.id))).max(4)
        : z.array(z.string()).max(0),
      sourceIds: z
        .array(z.enum(evidence.map((s) => s.id)))
        .min(1)
        .max(4),
    });
    const selectionSchema = selectionDraftSchema.extend({
      cards: z.array(cardSchema).min(2).max(4),
      chartId: chartCandidates.length
        ? z.enum(chartCandidates.map((c) => c.id)).nullable()
        : z.null(),
    });
    const draft = await this.structured(
      'Organize actual evidence into two to four cards: subject specifications, comparison specifications, and performance strengths AND weaknesses. Pick factIds from factCandidates for each subject, preferably official specs. Pick quoteIds from quoteCandidates for qualitative analysis: include both a strength and a limitation, preferably from independent reviews. Do not write prose, values, source IDs inside titles or other fields. Cite exact sourceIds. For chartId prefer a crossChecked core/specification metric, never price. The host extracts exact facts, source excerpts, chart numbers, attributed images and source cards. Core counts are not frame-rate benchmarks.',
      {
        goal: node.goal,
        requirements: this.requirements,
        ...this.publicContext(),
        factCandidates,
        quoteCandidates,
        chartCandidates: chartCandidates.map(
          ({ selection: _selection, ...candidate }) => candidate,
        ),
        evidence: evidence.map((s) => ({ id: s.id, title: s.title, text: s.text })),
      },
      selectionSchema,
      2200,
    );
    for (const card of draft.cards) {
      const quotes = card.quoteIds.map((id) => quoteCandidates.find((q) => q.id === id));
      if (quotes.some((q) => !q)) throw Error('Card selected an unobserved source excerpt.');
      card.body = quotes.map((q) => q.text).join(' ');
      card.sourceIds = [...new Set([...quotes.map((q) => q.sourceId), ...card.sourceIds])].slice(
        0,
        4,
      );
      card.facts = card.factIds.map((id) => {
        const fact = factCandidates.find((f) => f.id === id);
        if (!fact) throw Error('Card selected an unobserved fact.');
        card.sourceIds = [...new Set([...card.sourceIds, fact.sourceId])].slice(0, 4);
        return {
          label: fact.label,
          value: fact.value,
          detail: 'As published in the cited source.',
        };
      });
    }
    // Specification values are materialized for every actual research subject,
    // independently of the model's card labels or choice of fact identifiers.
    const specifications = (this.context.researchPlan?.entities || [])
      .map((entity) => {
        const facts = factCandidates
          .filter((fact) => fact.entity === entity)
          .sort(
            (a, b) =>
              require('../research-search.cjs').authority(
                evidence.find((s) => s.id === b.sourceId),
              ) -
                require('../research-search.cjs').authority(
                  evidence.find((s) => s.id === a.sourceId),
                ) || b.priority - a.priority,
          )
          .filter(
            (fact, index, all) => all.findIndex((other) => other.label === fact.label) === index,
          )
          .slice(0, 4);
        return {
          title: entity.slice(0, 75) + ' specifications',
          body: 'Published specifications from the cited sources.',
          quoteIds: [],
          sourceIds: [...new Set(facts.map((fact) => fact.sourceId))],
          facts: facts.map((fact) => ({
            label: fact.label,
            value: fact.value,
            detail: 'As published in the cited source.',
          })),
        };
      })
      .filter((card) => card.facts.length);
    const selectedQuotes = [...new Set(draft.cards.flatMap((card) => card.quoteIds))].map((id) =>
      quoteCandidates.find((quote) => quote.id === id),
    );
    const analysis = ['strength', 'limitation']
      .map((kind) => {
        const quotes = selectedQuotes.filter((q) => q.kind === kind);
        if (!quotes.length) {
          const observed = quoteCandidates
            .filter((q) => q.kind === kind)
            .sort(
              (a, b) =>
                require('../research-search.cjs').authority(
                  evidence.find((s) => s.id === a.sourceId),
                ) -
                require('../research-search.cjs').authority(
                  evidence.find((s) => s.id === b.sourceId),
                ),
            );
          if (observed.length) quotes.push(observed[0]);
        }
        return {
          title: kind === 'strength' ? 'Reported strengths' : 'Reported limitations',
          body: quotes
            .slice(0, 2)
            .map((q) => q.text)
            .join(' '),
          quoteIds: quotes.slice(0, 2).map((q) => q.id),
          sourceIds: [...new Set(quotes.slice(0, 2).map((q) => q.sourceId))],
          facts: [],
        };
      })
      .filter((card) => card.body);
    draft.cards = [...specifications.slice(0, 2), ...analysis].slice(0, 4);
    if (draft.cards.length < 2)
      throw Error(
        'Not enough observed specifications or source excerpts for a supported presentation.',
      );
    const selected =
      chartCandidates.find((candidate) => candidate.id === draft.chartId) ||
      (this.requirements?.chart ? chartCandidates[0] : undefined);
    if (this.requirements?.chart && !selected)
      throw Error('No source-verified comparison chart was selected.');
    draft.chart = selected
      ? { title: selected.title, unit: selected.unit, values: [], table: selected.selection }
      : null;
    let input;
    try {
      input = makeBriefing(draft, evidence, this.context.imageIds, this.requirements);
    } catch (error) {
      this.host.emit?.('task-recovery', {
        stage: 'presentation-validation',
        reason: error.message,
        chartId: draft.chartId,
      });
      if (!/Chart|chart|Selected table/.test(error.message)) throw error;
      const fixed = await this.structured(
        'Repair only this comparison chart. Prefer selecting an actual source table by sourceId, zero-based tableIndex, axis rows or columns, metricIndex (column for rows axis, row for columns axis), and exact product labels from column 0 or row 0 respectively. Set values to [] with a table selection; the host extracts numbers from real cells. Select the same numeric specification for both subjects, never Price. If no table exists copy quote VERBATIM from source text containing the numeric value and use product names as labels. Do not rewrite a table row or invent FPS. Return null only if no chart can be supported.',
        {
          chart: draft.chart,
          validation: error.message,
          entities: this.context.researchPlan?.entities,
          evidence: evidence
            .filter((s) => s.url !== 'https://jarvis.local/hardware')
            .map((s) => ({ id: s.id, text: s.text, tables: s.tables })),
        },
        draftSchema.pick({ chart: true }),
        1200,
      );
      draft.chart = fixed.chart;
      input = makeBriefing(draft, evidence, this.context.imageIds, this.requirements);
    }
    const result = await this.tool('present_briefing', input, node);
    return {
      ...result,
      chart: input.scenes.flatMap((s) => s.panels).find((p) => p.type === 'bar'),
      comparison: this.context.researchPlan?.entities,
      chartCrossChecked: selected?.crossChecked,
      sourceExcerptCount: draft.cards.reduce((n, card) => n + card.quoteIds.length, 0),
    };
  }
  async design(node) {
    const result = await this.tool(
      'blender_design',
      {
        goal:
          node.goal +
          '\nVerified public subject context: ' +
          JSON.stringify({ subject: this.context.hardware?.identity }) +
          '\nCreate a simple stylized object, not manufacturing geometry. Include real PNG render, saved blend project, GLB export, visual review and interactive preview.',
      },
      node,
    );
    const formats = new Set(result.exports?.map((e) => e.format));
    if (
      !formats.has('PNG') ||
      !formats.has('GLB') ||
      !result.quality?.reviewed ||
      !result.quality.accepted
    )
      throw Error(
        '3D output or visual inspection is incomplete. The verified files remain available.',
      );
    if (this.host.modelPreviewStatus) {
      const asset = result.exports.find((e) => e.format === 'GLB');
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !this.host.modelPreviewStatus(asset.assetId)) {
        this.agent.controller.signal.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!this.host.modelPreviewStatus(asset.assetId)?.loaded)
        throw Error('The real GLB was exported, but interactive preview loading did not verify.');
    }
    return {
      projectId: result.projectId,
      assetId: result.exports.find((e) => e.format === 'GLB').assetId,
      previewLoaded: true,
      quality: result.quality,
      formats: [...formats],
    };
  }
  async preview() {
    const created = Object.values(this.outputs).find((r) => r.projectId && r.assetId);
    if (!created || !this.host.modelPreviewStatus?.(created.assetId)?.loaded)
      throw Error('No interactive model has loaded.');
    return { projectId: created.projectId, assetId: created.assetId, loaded: true };
  }
  async save(node) {
    let folder;
    if (node.folder) {
      folder = this.host.workspace.library
        .folders()
        .find((f) => f.name.toLowerCase() === node.folder.toLowerCase());
      if (!folder)
        folder = (
          await this.tool(
            'workspace_library_manage',
            { action: 'create_folder', name: node.folder },
            node,
          )
        ).entry;
    }
    const saved = await this.tool(
      'workspace_save',
      {
        ...(folder ? { folderId: folder.id } : {}),
        topic:
          this.context.researchPlan?.entities.join(' compared with ') ||
          this.host.workspace.current?.topic,
      },
      node,
    );
    const actual = this.host.workspace.library.read(saved.entry.id);
    if (actual.folderId !== (folder?.id || null) || !actual.workspace.modules.length)
      throw Error('Saved Library item did not verify.');
    return {
      id: saved.entry.id,
      folder: folder?.name,
      modules: actual.workspace.modules.length,
      models: actual.workspace.modules.flatMap((m) => m.panels).filter((p) => p.type === 'model3d')
        .length,
    };
  }
  async action(node) {
    const schemas = this.agent.registry.schemas(
      new Set(
        this.agent.registry
          .list()
          .filter((p) => p.enabled)
          .map((p) => p.id),
      ),
    );
    const messages = [
      {
        role: 'system',
        content:
          'Execute only this authorized task stage using the available tools. Never claim unverified success. Do not perform unrelated or destructive actions. Host safety approval remains required.',
      },
      { role: 'user', content: node.goal },
    ];
    let verified = 0;
    for (let i = 0; i < 6; i++) {
      const reply = await this.agent.ai.chat(
        messages,
        schemas,
        false,
        this.agent.controller.signal,
        undefined,
        { outputTokens: 2048, profile: { complexity: 'simple', confidence: 1 } },
      );
      if (!reply.tool_calls?.length) {
        if (!verified) throw Error('No verified action was performed.');
        return { verified };
      }
      messages.push(reply);
      for (const call of reply.tool_calls) {
        const result = await this.tool(call.function.name, call.function.arguments, node);
        verified++;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
          _privacy: this.agent.registry.validate(call.function.name, call.function.arguments)
            .privacy,
        });
      }
    }
    throw Error('Task stage reached its bounded action limit.');
  }
  async run(plan) {
    const a = this.agent;
    this.requirements = plan.requirements;
    a.active.requirements = plan.requirements;
    a.active.graph = plan.nodes.map((n) => ({ ...n, state: 'PENDING' }));
    a.active.stage = 'task-graph';
    a.save();
    if (plan.nodes.some((n) => n.kind === 'presentation')) {
      await this.tool(
        'set_response_mode',
        {
          mode: 'FULL_WORKSPACE',
          reason: 'The requested outputs require multiple sourced visual objects.',
          imageQueries: [],
        },
        { id: 'presentation-mode' },
      );
    }
    await schedule(
      a.active.graph,
      async (node) => {
        a.active.stage = node.kind;
        const result = await this[node.kind](node);
        this.outputs[node.id] = result;
        node.result = result;
      },
      () => a.save(),
      a.controller.signal,
    );
    const failed = a.active.graph.filter((n) => n.state !== 'SUCCEEDED');
    a.active.status = failed.length ? 'incomplete' : 'completed';
    a.active.stage = 'finished';
    a.active.finished = Date.now();
    a.save();
    const hardware = this.context.hardware?.identity;
    const saved = Object.values(this.outputs)
      .filter((v) => v.folder)
      .at(-1);
    const message =
      (hardware ? 'Your detected hardware is ' + hardware + '. ' : '') +
      (failed.length
        ? 'Completed the verified stages; still incomplete: ' +
          failed.map((n) => n.kind + ' (' + n.error + ')').join('; ') +
          '.'
        : 'The sourced workspace and requested 3D outputs are complete.') +
      (saved ? ' Saved ' + saved.modules + ' objects in ' + saved.folder + '.' : '');
    a.emit('reply', message);
    a.context.finish(a.request, message, false);
    return { nodes: a.active.graph, outputs: this.outputs };
  }
}
module.exports = { TaskGraph, planSchema, validatePlan, schedule };
