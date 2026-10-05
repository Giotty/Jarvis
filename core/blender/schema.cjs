const { z } = require('zod');
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\w .-]+$/);
const scalar = z.number().finite().min(-10000).max(10000);
const vector = z.array(scalar).length(3);
function normalizeColor(value) {
  if (typeof value === 'string' && /^#[a-f0-9]{3,8}$/i.test(value)) {
    let hex = value.slice(1);
    if (hex.length === 3)
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    if ([6, 8].includes(hex.length))
      value = Array.from(
        { length: hex.length / 2 },
        (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255,
      );
  }
  if (Array.isArray(value)) {
    value = [...value];
    if (value.length === 3) value.push(1);
    if (
      value.length === 4 &&
      value.every((n) => typeof n === 'number' && n >= 0 && n <= 255) &&
      value.slice(0, 3).some((n) => n > 1)
    )
      value = value.map((n, i) => (i === 3 && n <= 1 ? n : n / 255));
  }
  return value;
}
const color = z.preprocess(normalizeColor, z.array(z.number().min(0).max(1)).length(4));
const target = { object: name };
const role = z.enum(['MODEL', 'STUDIO', 'CONSTRUCTION']).default('MODEL');
const operations = {
  create_primitive: z.object({
    kind: z.enum(['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane']),
    name,
    role,
    location: vector.optional(),
    rotation: vector.optional(),
    dimensions: vector.optional(),
    radius: z.number().positive().max(1000).optional(),
    depth: z.number().positive().max(1000).optional(),
    vertices: z.number().int().min(3).max(128).optional(),
  }),
  create_mesh: z.object({
    name,
    role,
    vertices: z.array(vector).min(3).max(10000),
    faces: z
      .array(z.array(z.number().int().min(0).max(9999)).min(3).max(32))
      .min(1)
      .max(10000),
  }),
  transform: z.object({
    ...target,
    space: z.enum(['WORLD', 'LOCAL']).default('WORLD'),
    location: vector.optional(),
    rotation: vector.optional(),
    scale: vector.optional(),
    dimensions: vector.optional(),
  }),
  remove_object: z.object({ ...target }),
  set_role: z.object({ ...target, role }),
  add_modifier: z.object({
    ...target,
    kind: z.enum(['bevel', 'solidify', 'subdivision', 'mirror', 'weighted_normals', 'array']),
    amount: z.number().positive().max(10).optional(),
    segments: z.number().int().min(1).max(6).optional(),
    apply: z.boolean().optional(),
    count: z.number().int().min(2).max(512).optional(),
    offset: vector.optional(),
    axes: z
      .array(z.enum(['X', 'Y', 'Z']))
      .min(1)
      .max(3)
      .optional(),
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
    removeCutter: z.boolean().default(false),
  }),
  extrude: z.object({
    ...target,
    distance: scalar,
    axis: z.enum(['X', 'Y', 'Z']).default('Z'),
    side: z.enum(['MIN', 'MAX']).default('MAX'),
  }),
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
    preset: z
      .enum([
        'custom',
        'rubber',
        'painted_metal',
        'brushed_metal',
        'plastic',
        'glass',
        'steel',
        'carbon',
        'emissive',
      ])
      .optional(),
    detailScale: z.number().positive().max(1000).optional(),
    bump: z.number().min(0).max(0.25).optional(),
  }),
  create_curve: z.object({
    name,
    role,
    caps: z.boolean().default(true),
    points: z.array(vector).min(2).max(96),
    bevelDepth: z.number().positive().max(10),
    closed: z.boolean().default(false),
    interpolation: z.enum(['POLY', 'BEZIER']).default('POLY'),
  }),
  create_lathe: z.object({
    name,
    role,
    profile: z
      .array(z.array(z.number().finite().min(-100).max(100)).length(2))
      .min(2)
      .max(64)
      .describe(
        'Ordered cross-section points [nonnegativeRadius, localZHeight], exactly TWO numbers per point. Not XYZ vertices. Revolves about local Z.',
      ),
    segments: z.number().int().min(12).max(128).default(64),
    location: vector.optional(),
    rotation: vector.optional(),
  }),
  duplicate: z.object({
    ...target,
    name,
    location: vector.optional(),
    rotation: vector.optional(),
    scale: vector.optional(),
  }),
  radial_array: z.object({
    ...target,
    namePrefix: name,
    count: z.number().int().min(2).max(64),
    center: vector,
    axis: z.enum(['X', 'Y', 'Z']).default('Z'),
    angle: z.number().finite().min(-360).max(360).default(360),
  }),
  inset: z.object({
    ...target,
    thickness: z.number().positive().max(10),
    depth: scalar.default(0),
    axis: z.enum(['X', 'Y', 'Z']).default('Z'),
    side: z.enum(['MIN', 'MAX']).default('MAX'),
  }),
  align: z.object({
    ...target,
    target: name,
    axis: z.enum(['X', 'Y', 'Z', 'ALL']).default('ALL'),
    offset: vector.default([0, 0, 0]),
  }),
  set_parent: z.object({ ...target, parent: name }),
  collection: z.object({ name, objects: z.array(name).min(1).max(100) }),
  uv_unwrap: z.object({ ...target, method: z.enum(['smart', 'cube']).default('smart') }),
  geometry_nodes: z.object({
    ...target,
    kind: z.enum(['wireframe', 'subdivide']),
    amount: z.number().positive().max(1).default(0.01),
    level: z.number().int().min(1).max(3).default(1),
  }),
  import_glb: z.object({ path: z.string().max(1000), name }),
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
    fit: z.boolean().default(false),
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
    samples: z.number().int().min(8).max(128).optional(),
  }),
  render_views: z.object({
    width: z.number().int().min(128).max(1600).default(768),
    samples: z.number().int().min(8).max(128).default(48),
    views: z
      .array(z.object({ name: name, location: vector, target: vector.default([0, 0, 0]) }).strict())
      .min(2)
      .max(4),
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
    operations: z.array(operation).min(1).max(180),
  })
  .strict();
module.exports = { operations, operation, batch, color, normalizeColor };
