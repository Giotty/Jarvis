const { z } = require('zod');
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\w .-]+$/);
const scalar = z.number().finite().min(-10000).max(10000);
const vector = z.array(scalar).length(3);
const color = z.array(z.number().min(0).max(1)).length(4);
const target = { object: name };
const operations = {
  create_primitive: z.object({
    kind: z.enum(['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane']),
    name,
    location: vector.optional(),
    rotation: vector.optional(),
    dimensions: vector.optional(),
    radius: z.number().positive().max(1000).optional(),
    depth: z.number().positive().max(1000).optional(),
    vertices: z.number().int().min(8).max(128).optional(),
  }),
  create_mesh: z.object({
    name,
    vertices: z.array(vector).min(3).max(10000),
    faces: z
      .array(z.array(z.number().int().min(0).max(9999)).min(3).max(32))
      .min(1)
      .max(10000),
  }),
  transform: z.object({
    ...target,
    location: vector.optional(),
    rotation: vector.optional(),
    scale: vector.optional(),
    dimensions: vector.optional(),
  }),
  add_modifier: z.object({
    ...target,
    kind: z.enum(['bevel', 'solidify', 'subdivision', 'mirror']),
    amount: z.number().positive().max(10).optional(),
    segments: z.number().int().min(1).max(6).optional(),
    apply: z.boolean().optional(),
  }),
  bevel: z.object({
    ...target,
    amount: z.number().positive().max(10),
    segments: z.number().int().min(1).max(6).optional(),
    apply: z.boolean().optional(),
  }),
  boolean: z.object({
    ...target,
    cutter: name,
    operation: z.enum(['DIFFERENCE', 'UNION', 'INTERSECT']),
    apply: z.boolean().default(true),
    removeCutter: z.boolean().default(true),
  }),
  extrude: z.object({ ...target, distance: scalar, axis: z.enum(['X', 'Y', 'Z']).default('Z') }),
  add_text: z.object({
    name,
    text: z.string().min(1).max(160),
    location: vector.optional(),
    rotation: vector.optional(),
    size: z.number().positive().max(100).default(0.1),
    extrude: z.number().min(0).max(10).default(0.005),
    convert: z.boolean().default(false),
  }),
  create_material: z.object({
    name,
    color: color.default([0.1, 0.2, 0.3, 1]),
    metallic: z.number().min(0).max(1).default(0),
    roughness: z.number().min(0).max(1).default(0.4),
    emission: color.optional(),
    strength: z.number().min(0).max(10).optional(),
  }),
  assign_material: z.object({ ...target, material: name }),
  add_light: z.object({
    name,
    kind: z.enum(['AREA', 'POINT', 'SUN', 'SPOT']).default('AREA'),
    location: vector,
    energy: z.number().positive().max(10000).default(500),
    size: z.number().positive().max(100).default(5),
    color: z.array(z.number().min(0).max(1)).length(3).optional(),
  }),
  set_camera: z.object({
    location: vector,
    target: vector.default([0, 0, 0]),
    lens: z.number().min(10).max(200).default(50),
    orthographic: z.boolean().default(false),
    orthoScale: z.number().positive().max(1000).default(5),
  }),
  set_light: z.object({
    ...target,
    energy: z.number().positive().max(10000).optional(),
    size: z.number().positive().max(100).optional(),
    color: z.array(z.number().min(0).max(1)).length(3).optional(),
  }),
  render: z.object({
    width: z.number().int().min(128).max(1600).default(768),
    height: z.number().int().min(128).max(1600).default(768),
    transparent: z.boolean().default(false),
    exposure: z.number().min(-10).max(10).optional(),
  }),
  export: z.object({ format: z.enum(['GLB', 'GLTF', 'OBJ', 'STL', 'FBX']).default('GLB') }),
  save_project: z.object({}),
  get_scene: z.object({}),
};
for (const k of Object.keys(operations)) operations[k] = operations[k].strict();
const operation = z.discriminatedUnion(
  'op',
  Object.entries(operations).map(([op, args]) => args.extend({ op: z.literal(op) })),
);
const batch = z
  .object({
    projectId: z.string().uuid().optional(),
    title: z.string().min(1).max(90).default('3D project'),
    units: z.enum(['meters', 'millimeters', 'centimeters']).default('meters'),
    operations: z.array(operation).min(1).max(60),
  })
  .strict();
module.exports = { operations, operation, batch };
