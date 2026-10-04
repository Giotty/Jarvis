const fs = require('node:fs');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');
const { illustrationPlan, toBatch } = require('./scene-plan.cjs');
const { safeError } = require('../providers/diagnostics.cjs');
const reviewSchema = z
  .object({
    accepted: z.boolean(),
    recognizable: z.boolean(),
    missingFeatures: z.array(z.string().max(160)).max(8),
    findings: z.array(z.string().max(240)).max(5),
  })
  .strict();
const instructions = `Design a recognizable simplified industrial illustration of the requested WHOLE object, not arbitrary stacked primitives or a different subcomponent. First return design: correct category, defining silhouette, coherent proportions, and 3-8 visually identifying features. Then construct those features with named materials and primitive objects. ALL rotations use DEGREES (90, never 1.57 radians). No scripts or paths.
Use normalized illustration units (meters): longest body dimension around 3, NOT manufacturer's millimeter dimensions. Coordinates, rotations, dimensions, camera and light locations are ARRAY triples [x,y,z], never objects. Colors and emission are RGBA arrays [r,g,b,1]. Bevel is at most 1 and smaller than part thickness. Camera orthoScale is at most 100. Use a consistent coordinate convention: longest body dimension X, width Y, thickness Z, main visible details on positive Z. Dimensions are local before rotation; cylinders point along Z. Rectangular devices need a beveled rectangular primary body and attached layered mechanical details. Circular cooling details need rings, hubs and repeated blades, not just solid cylinders. Use secondary parts to express connectors, vents, frames or controls when these identify the object. A futuristic style uses dark metallic structure with restrained cyan accents, not an overwhelmingly glowing body. Keep pieces attached and proportions plausible. Use 10-16 object groups; repeated details can yield up to 56 total mesh parts. Do not make an exact engineering replica.
Optional object.repeat replicates count copies including the original: rotate each around center by i*rotation DEGREES (X then Y then Z), then translate by i*translation. For radial blades place the first blade offset from its hub, center at hub, rotation=[0,0,360/count], translation=[0,0,0]. For vents or connectors use rotation zero and small linear translation. Assign each object a defined material. Use at most 4 materials. Bevels stay smaller than part thickness.
For EVERY cylinder, cone and torus supply normal: its WORLD-SPACE axial direction. A round detail lying flat on a horizontal top face needs normal=[0,0,1]; a wheel on a vertical side might use [0,1,0]. The compiler orients it for you. Set its rotation=[0,0,0]. Its dimensions ALWAYS mean [diameterX,diameterY,axialDepth] BEFORE orientation, so a shallow disc or ring uses something like [0.8,0.8,0.06], NEVER [0.06,0.8,0.8]. Both radial diameters must be comparable; a torus depth stays less than half its diameter. Do not rotate round parts a second time. This convention applies to all circular mechanical parts, not a particular object category.
Frame the broad detail face from an elevated three-quarter angle with substantial X/Y/Z components. Camera target is object center. Lights must illuminate dark surfaces without washing them out. Keep the silhouette and identifying features clearly visible. The host saves the blend project, renders and exports GLB. Return the complete scene plan in submit_blender_plan, never operations.`;
async function design(service, args, signal) {
  const contract = zodToJsonSchema(illustrationPlan);
  const tools = [
    {
      type: 'function',
      function: {
        name: 'submit_blender_plan',
        description: 'Decompose the object visually, then return its complete scene plan.',
        parameters: contract,
      },
    },
  ];
  const options = {
    forceTool: { type: 'function', function: { name: 'submit_blender_plan' } },
    outputTokens: 6000,
    compactTools: true,
    requestTimeout: 120000,
    profile: {
      modality: 'spatial',
      complexity: 'complex',
      latency: 'patient',
      confidence: 1,
      spatialReasoning: true,
    },
  };
  const plan = async (data) => {
    const reply = await service.ai.chat(
      [
        { role: 'system', content: instructions },
        { role: 'user', content: JSON.stringify(data) },
      ],
      tools,
      false,
      signal,
      undefined,
      options,
    );
    const value =
      reply.tool_calls?.find((c) => c.function.name === 'submit_blender_plan')?.function
        .arguments ?? JSON.parse(reply.content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    try {
      const parsed = illustrationPlan.parse(value);
      toBatch(parsed); // Validate geometry/materials and bounded expansion before mutation.
      return parsed;
    } catch (error) {
      error.code = 'DESIGN_PLAN_INVALID';
      error.rejectedPlan = value;
      service.emit('blender-plan-diagnostic', {
        stage: 'scene-plan-validation',
        reason: safeError(error.message),
        issues: error.issues?.map((i) => ({
          code: i.code,
          path: i.path,
          message: safeError(i.message),
        })),
      });
      throw error;
    }
  };
  let current;
  try {
    current = await plan({ goal: args.goal });
  } catch (error) {
    signal?.throwIfAborted();
    if (!error.issues && !/material|parts|names/.test(error.message)) throw error;
    current = await plan({
      goal: args.goal,
      rejectedPlan: error.rejectedPlan,
      validation: error.issues || error.message,
      instruction:
        'Repair ONLY the invalid fields. Preserve valid geometry and the design. Return the complete corrected scene plan, with actual values rather than schemas.',
    });
  }
  let result,
    reviews = 0,
    accepted = false,
    recognizable = false,
    findings = [],
    failureCode;
  const history = [];
  const limit = Math.max(1, Math.min(3, service.config().blenderIterations || 3));
  for (let iteration = 0; iteration < limit; iteration++) {
    signal?.throwIfAborted();
    const input = { ...toBatch(current), ...(result ? { projectId: result.projectId } : {}) };
    // Immutable new revision of this generated illustration, retaining all older
    // artifacts. Imported/private projects continue through the separate edit path.
    const job = service.queue.catch(() => {}).then(() => service.perform(input, signal, true));
    service.queue = job;
    result = await job;
    result.design = current.design;
    if (args.artifactSession)
      service.emit('blender-artifacts-ready', { sessionId: args.artifactSession, result });
    service.emit('blender-progress', {
      projectId: result.projectId,
      stage: 'visual-review',
      iteration: iteration + 1,
    });
    try {
      const render = result.exports.find((e) => e.format === 'PNG');
      const reply = await service.ai.chat(
        [
          {
            role: 'system',
            content:
              'Evaluate the actual rendered pixels against the user GOAL first. The design brief is a proposed interpretation, not an authoritative definition: reject a changed object category or a subcomponent instead of the requested whole device. Return accepted, recognizable, missingFeatures and findings. missingFeatures lists only ESSENTIAL identifying features; place optional styling omissions in findings. A few stacked solids are insufficient if they do not visually communicate the requested object category. Check silhouette, proportions, defining repeated details, coherent attachment, materials and framing. Reject hidden/edge-on details and generic shapes lacking identifying features. Do not trust names or claim detail invisible in the image. Accept a simplified artistic model if recognizable and its essential features are visible; do not demand manufacturing accuracy or every minor decorative detail.',
          },
          {
            role: 'user',
            content: JSON.stringify({ goal: args.goal, design: current.design }),
            images: ['data:image/png;base64,' + fs.readFileSync(render.path).toString('base64')],
          },
        ],
        undefined,
        true,
        signal,
        undefined,
        {
          schema: zodToJsonSchema(reviewSchema),
          outputTokens: 1536,
          manualVision: true,
          // Constrained nonstream vision has intermittently stalled in NIM.
          // Stream prompt JSON and validate the same strict review in the host.
          stream: true,
          promptSchema: true,
          requestTimeout: 90000,
          profile: { modality: 'image', complexity: 'normal', confidence: 1 },
        },
      );
      const review = reviewSchema.parse(
        JSON.parse(reply.content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()),
      );
      reviews++;
      recognizable = review.recognizable;
      accepted = review.accepted && recognizable && !review.missingFeatures.length;
      findings = [...review.missingFeatures, ...review.findings];
      history.push({ revision: result.revision, ...review, accepted });
      if (args.artifactSession)
        service.emit('blender-artifacts-ready', {
          sessionId: args.artifactSession,
          result: {
            ...result,
            quality: {
              reviewed: true,
              accepted,
              recognizable,
              findings,
              reviews,
              history: [...history],
            },
          },
        });
      if (accepted || iteration + 1 >= limit) break;
      service.emit('blender-progress', {
        projectId: result.projectId,
        stage: 'revision-planning',
        iteration: iteration + 2,
      });
      // Same compact semantic contract for revisions, avoiding the giant operation
      // union that previously timed out and failed NIM's grammar compiler.
      current = await plan({
        goal: args.goal,
        priorPlan: current,
        actualVisualReview: review,
        instruction:
          'Return an improved COMPLETE scene plan addressing these observed weaknesses. Preserve category and style, strengthen missing identifying features.',
      });
    } catch (error) {
      signal?.throwIfAborted();
      failureCode = error.code || error.name;
      service.emit('blender-plan-diagnostic', {
        stage: reviews ? 'correction' : 'visual-review',
        code: failureCode,
        reason: safeError(error.message),
      });
      findings.push(
        reviews
          ? 'Revision planning was unavailable; verified artifacts are retained.'
          : 'Visual review was unavailable; verified artifacts are retained.',
      );
      break;
    }
  }
  return {
    ...result,
    quality: {
      reviewed: reviews > 0,
      accepted,
      recognizable,
      findings,
      reviews,
      history,
      failureCode,
    },
    message: accepted
      ? 'Created a recognizable, visually reviewed Blender illustration.'
      : 'Created real artifacts; visual quality verification remains incomplete.',
  };
}
module.exports = { design, reviewSchema };
