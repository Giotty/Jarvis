const { z } = require('zod');
const vector = z.array(z.number().finite().min(-1000).max(1000)).length(3);
const scenePlan = z
  .object({
    title: z.string().min(1).max(90),
    materials: z
      .array(
        z
          .object({
            name: z.string().max(80),
            color: z.array(z.number().min(0).max(1)).length(4),
            metallic: z.number().min(0).max(1),
            roughness: z.number().min(0).max(1),
            emission: z.array(z.number().min(0).max(1)).length(4),
            strength: z.number().min(0).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    objects: z
      .array(
        z
          .object({
            name: z.string().max(80),
            kind: z.enum(['cube', 'sphere', 'cylinder', 'cone', 'torus']),
            location: vector,
            rotation: vector,
            dimensions: z.array(z.number().positive().max(1000)).length(3),
            material: z.string().max(80),
            bevel: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1)
      .max(16),
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
      .object({ location: vector, target: vector, orthoScale: z.number().positive().max(100) })
      .strict(),
  })
  .strict();
function toBatch(plan) {
  const p = scenePlan.parse(plan),
    names = new Set(p.materials.map((m) => m.name));
  if (
    names.size !== p.materials.length ||
    new Set(p.objects.map((o) => o.name)).size !== p.objects.length
  )
    throw Error('Scene names must be unique.');
  const operations = p.materials.map((m) => ({ op: 'create_material', ...m }));
  for (const object of p.objects) {
    if (!names.has(object.material) || object.dimensions.some((v) => v <= 0))
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['objects', p.objects.indexOf(object), 'material'],
          message:
            'Unknown material ' + object.material + '. Choose one of: ' + [...names].join(', '),
        },
      ]);
    const { material, bevel, ...primitive } = object;
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
module.exports = { scenePlan, toBatch };
