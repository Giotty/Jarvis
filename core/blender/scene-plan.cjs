const { z } = require('zod');
const { color } = require('./schema.cjs');
const vector = z.array(z.number().finite().min(-1000).max(1000)).length(3);
const scenePlan = z
  .object({
    title: z.string().min(1).max(90),
    materials: z
      .array(
        z
          .object({
            name: z.string().max(80),
            color,
            metallic: z.number().min(0).max(1),
            roughness: z.number().min(0).max(1),
            emission: color.default([0, 0, 0, 1]),
            strength: z.number().min(0).max(10).default(0),
          })
          .strip(),
      )
      .min(1)
      .max(12),
    objects: z
      .array(
        z
          .object({
            name: z.string().max(80),
            kind: z.enum(['cube', 'sphere', 'cylinder', 'cone', 'torus']),
            role: z.enum(['MODEL', 'STUDIO', 'CONSTRUCTION']).default('MODEL'),
            location: vector,
            rotation: vector.default([0, 0, 0]),
            normal: vector.nullish(),
            dimensions: z.array(z.number().positive().max(1000)).length(3),
            material: z.string().max(80),
            bevel: z.number().min(0).max(1000).default(0),
            repeat: z
              .object({
                count: z.number().int().min(1).max(16),
                translation: vector,
                rotation: vector,
                center: vector,
              })
              .strict()
              .nullish(),
          })
          .strip(),
      )
      .min(1)
      .max(24),
    lights: z
      .array(
        z
          .object({
            name: z.string().max(80),
            location: vector,
            energy: z.number().positive().max(10000),
            size: z.number().positive().max(100),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    camera: z
      .object({ location: vector, target: vector, orthoScale: z.number().positive().max(1000) })
      .strict(),
  })
  .strip();
const illustrationBase = scenePlan.extend({
  design: z
    .object({
      category: z.string().min(1).max(100),
      silhouette: z.string().min(1).max(1000),
      proportions: z.string().min(1).max(1000),
      features: z.array(z.string().min(1).max(350)).min(3).max(16),
    })
    .strict(),
});
function checkRoundShapes(plan, context) {
  plan.objects.forEach((object, index) => {
    if (!['cylinder', 'cone', 'torus'].includes(object.kind)) return;
    const [x, y, depth] = object.dimensions;
    if (!object.normal || Math.hypot(...object.normal) < 0.001)
      context.addIssue({
        code: 'custom',
        path: ['objects', index, 'normal'],
        message:
          'Round shapes need an explicit nonzero world-space axial normal, for example [0,0,1] for a disc lying flat in XY.',
      });
    if (object.rotation.some((v) => Math.abs(v) > 0.001))
      context.addIssue({
        code: 'custom',
        path: ['objects', index, 'rotation'],
        message:
          'Round-shape orientation comes only from normal. Set rotation to [0,0,0]; do not tilt it twice.',
      });
    if (
      Math.max(x, y) / Math.min(x, y) > 2 ||
      (object.kind === 'torus' && depth > Math.min(x, y) / 2)
    )
      context.addIssue({
        code: 'custom',
        path: ['objects', index, 'dimensions'],
        message:
          'Round-shape LOCAL dimensions are [diameterX,diameterY,axialDepth]. Do not put disc thickness in X or Y. Rings must be shallow.',
      });
  });
}
const illustrationPlan = illustrationBase.superRefine(checkRoundShapes);
const blockoutPlan = illustrationBase.extend({
  materials: scenePlan.shape.materials.max(6),
  objects: scenePlan.shape.objects.max(12),
});
function normalRotation(normal) {
  const length = Math.hypot(...normal);
  if (length < 0.001) throw Error('A surface normal cannot be zero.');
  return [
    0,
    (Math.acos(Math.max(-1, Math.min(1, normal[2] / length))) * 180) / Math.PI,
    (Math.atan2(normal[1], normal[0]) * 180) / Math.PI,
  ];
}
function expandObjects(objects) {
  const expanded = [];
  for (const { repeat, ...object } of objects) {
    for (let i = 0; i < (repeat?.count || 1); i++) {
      let location = [...object.location];
      if (repeat) {
        location = location.map((v, a) => v - repeat.center[a]);
        for (let axis = 0; axis < 3; axis++) {
          const a = (axis + 1) % 3,
            b = (axis + 2) % 3;
          const angle = (i * repeat.rotation[axis] * Math.PI) / 180;
          const x = location[a],
            y = location[b];
          location[a] = x * Math.cos(angle) - y * Math.sin(angle);
          location[b] = x * Math.sin(angle) + y * Math.cos(angle);
        }
        location = location.map((v, a) => v + repeat.center[a] + i * repeat.translation[a]);
      }
      expanded.push({
        ...object,
        name: repeat ? object.name + '_' + i : object.name,
        location,
        rotation: object.rotation.map((v, a) => v + i * (repeat?.rotation[a] || 0)),
      });
      if (object.normal && repeat) {
        const normal = [...object.normal];
        for (let axis = 0; axis < 3; axis++) {
          const a = (axis + 1) % 3,
            b = (axis + 2) % 3,
            angle = (i * repeat.rotation[axis] * Math.PI) / 180,
            x = normal[a],
            y = normal[b];
          normal[a] = x * Math.cos(angle) - y * Math.sin(angle);
          normal[b] = x * Math.sin(angle) + y * Math.cos(angle);
        }
        expanded.at(-1).normal = normal;
      }
      if (expanded.length > 96)
        throw Error(
          'Blockout exceeds 96 mesh parts. Keep major forms here and defer repeated detail to later stages.',
        );
    }
  }
  return expanded;
}
function normalizePlan(plan) {
  const normalized = structuredClone(plan),
    expanded = expandObjects(normalized.objects),
    points = [];
  for (const object of expanded) {
    if (object.role && object.role !== 'MODEL') continue;
    const angles = (
      object.normal &&
      ['cylinder', 'cone', 'torus'].includes(object.kind) &&
      Math.hypot(...object.normal) > 0.001 &&
      object.rotation.every((v) => Math.abs(v) < 0.001)
        ? normalRotation(object.normal)
        : object.rotation
    ).map((v) => (v * Math.PI) / 180);
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const v = [
            (x * object.dimensions[0]) / 2,
            (y * object.dimensions[1]) / 2,
            (z * object.dimensions[2]) / 2,
          ];
          for (let axis = 0; axis < 3; axis++) {
            const a = (axis + 1) % 3,
              b = (axis + 2) % 3,
              first = v[a],
              second = v[b],
              angle = angles[axis];
            v[a] = first * Math.cos(angle) - second * Math.sin(angle);
            v[b] = first * Math.sin(angle) + second * Math.cos(angle);
          }
          points.push(v.map((n, i) => n + object.location[i]));
        }
  }
  if (!points.length) throw Error('Blockout needs at least one MODEL form to frame.');
  const low = [0, 1, 2].map((a) => Math.min(...points.map((v) => v[a]))),
    high = [0, 1, 2].map((a) => Math.max(...points.map((v) => v[a]))),
    center = low.map((n, a) => (n + high[a]) / 2),
    scale = 3 / Math.max(...high.map((n, a) => n - low[a]));
  const position = (v) => v.map((n, a) => (n - center[a]) * scale);
  for (const object of normalized.objects) {
    object.location = position(object.location);
    object.dimensions = object.dimensions.map((n) => n * scale);
    object.bevel *= scale;
    if (object.repeat) {
      object.repeat.center = position(object.repeat.center);
      object.repeat.translation = object.repeat.translation.map((n) => n * scale);
    }
  }
  normalized.lights = normalized.lights.map((light) => ({
    ...light,
    location: position(light.location),
    size: light.size * scale,
  }));
  normalized.camera = {
    ...normalized.camera,
    location: position(normalized.camera.location),
    target: position(normalized.camera.target),
    orthoScale: normalized.camera.orthoScale * scale,
  };
  return normalized;
}
function toBatch(plan, { normalize = false } = {}) {
  const { design: _design, ...geometry } = plan;
  const parsed = scenePlan.parse(geometry);
  const p = normalize ? normalizePlan(parsed) : parsed,
    names = new Set(p.materials.map((m) => m.name));
  if (
    names.size !== p.materials.length ||
    new Set(p.objects.map((o) => o.name)).size !== p.objects.length
  )
    throw Error('Scene names must be unique.');
  const operations = p.materials.map((m) => ({ op: 'create_material', ...m }));
  const expanded = expandObjects(p.objects);
  if (new Set(expanded.map((o) => o.name)).size !== expanded.length)
    throw Error('Repeated scene names must be unique.');
  for (const object of expanded) {
    if (!names.has(object.material) || object.dimensions.some((v) => v <= 0))
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['objects', p.objects.indexOf(object), 'material'],
          message:
            'Unknown material ' + object.material + '. Choose one of: ' + [...names].join(', '),
        },
      ]);
    const { material, bevel, normal, ...primitive } = object;
    if (
      normal &&
      Math.hypot(...normal) > 0.001 &&
      primitive.rotation.every((v) => Math.abs(v) < 0.001) &&
      ['cylinder', 'cone', 'torus'].includes(object.kind)
    )
      primitive.rotation = normalRotation(normal);
    operations.push({ op: 'create_primitive', ...primitive });
    if (bevel > 0)
      operations.push({
        op: 'bevel',
        object: object.name,
        amount: Math.min(bevel, ...object.dimensions.map((v) => v / 4)),
        segments: 2,
        apply: true,
      });
    operations.push({ op: 'assign_material', object: object.name, material });
  }
  for (const light of p.lights) operations.push({ op: 'add_light', kind: 'AREA', ...light });
  operations.push(
    { op: 'set_camera', orthographic: true, fit: true, ...p.camera },
    { op: 'render', width: 768, height: 768 },
    { op: 'export', format: 'GLB' },
  );
  return require('./schema.cjs').batch.parse({ title: p.title, units: 'meters', operations });
}
module.exports = {
  scenePlan,
  illustrationPlan,
  blockoutPlan,
  expandObjects,
  toBatch,
  normalRotation,
  normalizePlan,
};
