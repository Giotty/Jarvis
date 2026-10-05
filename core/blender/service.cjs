const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');
const { operations, batch } = require('./schema.cjs');
const uuid = z.string().uuid();
function inside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Path is outside the owned 3D folder.');
  return file;
}
function normal(root, file) {
  inside(root, file);
  let cursor = file;
  while (cursor !== root) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw Error('3D paths cannot be links.');
    cursor = path.dirname(cursor);
  }
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('3D root cannot be a link.');
  return file;
}
function detect(config) {
  const candidates = [config.blenderPath];
  for (const base of [
    path.join(__dirname, '../..', '.tools'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Blender Foundation'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Blender Foundation'),
  ]) {
    if (fs.existsSync(base))
      for (const d of fs.readdirSync(base)) candidates.push(path.join(base, d, 'blender.exe'));
  }
  return (
    candidates.find(
      (p) => p && fs.existsSync(p) && path.basename(p).toLowerCase() === 'blender.exe',
    ) || null
  );
}
function validateGlb(buffer) {
  if (
    buffer.length < 20 ||
    buffer.length > 32 * 1024 * 1024 ||
    buffer.toString('ascii', 0, 4) !== 'glTF' ||
    buffer.readUInt32LE(4) !== 2 ||
    buffer.readUInt32LE(8) !== buffer.length
  )
    throw Error('Invalid GLB preview.');
  const size = buffer.readUInt32LE(12);
  if (size + 20 > buffer.length || buffer.readUInt32LE(16) !== 0x4e4f534a)
    throw Error('Invalid GLB scene.');
  const data = JSON.parse(buffer.toString('utf8', 20, 20 + size));
  if (
    (data.buffers || []).some((b) => b.uri && !b.uri.startsWith('data:')) ||
    (data.images || []).some((i) => i.uri && !i.uri.startsWith('data:'))
  )
    throw Error('External 3D resources are blocked.');
  if (
    (data.nodes?.length || 0) > 1000 ||
    (data.meshes?.length || 0) > 500 ||
    (data.accessors || []).some((a) => a.count > 1000000)
  )
    throw Error('Preview geometry budget exceeded.');
  return data;
}
function modelDescription(project) {
  return [
    'Modeled with Blender',
    project.generationSettings?.quality && 'Quality: ' + project.generationSettings.quality,
    'Revision: ' + project.revision,
    project.quality?.scores && 'Overall: ' + project.quality.scores.overall + '/10',
    project.quality &&
      (project.quality.accepted ? 'Visual review approved' : 'Visual quality unapproved'),
    project.scene.objects.length +
      ' objects · ' +
      project.scene.totalVertices +
      ' evaluated vertices',
  ]
    .filter(Boolean)
    .join(' · ');
}
class BlenderService {
  constructor({ directory, config, emit = () => {}, workspace, ai, research, resources, secrets }) {
    Object.assign(this, { config, emit, workspace, ai, research, resources, secrets });
    this.root = path.resolve(directory);
    fs.mkdirSync(this.root, { recursive: true });
    normal(this.root, this.root);
    this.queue = Promise.resolve();
    this.generators = new (require('./generators.cjs').Generative3DProviders)();
    this.generators.register(new (require('./trellis.cjs').TrellisProvider)({ config, secrets }));
    this.current = null;
    try {
      this.current = uuid.parse(
        JSON.parse(fs.readFileSync(path.join(this.root, 'current.json'))).projectId,
      );
    } catch {
      /* No current project yet. */
    }
  }
  status() {
    return {
      available: !!detect(this.config()),
      enabled: this.config().blenderEnabled,
      path: detect(this.config()),
      current: this.current,
      backend: 'Blender',
      generator: 'staged-reference-guided-Blender',
      optionalGenerators: this.generators.status(),
    };
  }
  file(id, name) {
    return normal(this.root, inside(this.root, path.join(this.root, uuid.parse(id), name)));
  }
  manifest(id = this.current) {
    if (!id) throw Error('Create a 3D project first.');
    const value = JSON.parse(fs.readFileSync(this.file(id, 'project.json'), 'utf8'));
    if (value.id !== id || !Number.isInteger(value.revision) || value.revision < 1)
      throw Error('Invalid project manifest.');
    return value;
  }
  async run(input, signal) {
    const args = batch.parse(input);
    signal?.throwIfAborted();
    const job = this.queue.catch(() => {}).then(() => this.perform(args, signal));
    this.queue = job;
    return job;
  }
  async perform(args, signal, rebuild = false) {
    signal?.throwIfAborted();
    if (!this.config().blenderEnabled || !this.config().filesystem)
      throw Error('Blender or file access is disabled.');
    if (this.config().mock)
      return {
        success: true,
        verified: false,
        mock: true,
        message: '3D operations simulated; no project was created.',
      };
    for (const op of args.operations)
      if (op.op === 'import_glb') {
        op.path = normal(this.root, path.resolve(op.path));
        validateGlb(fs.readFileSync(op.path));
      }
    const executable = detect(this.config());
    if (!executable)
      throw Error('Blender unavailable. Install the official build or select it in 3D settings.');
    const id = args.projectId || crypto.randomUUID(),
      previous = args.projectId ? this.manifest(id) : null;
    const folder = this.file(id, '');
    fs.mkdirSync(folder, { recursive: true });
    const revision = (previous?.revision || 0) + 1,
      revisionName = 'revision-' + revision + '-' + crypto.randomUUID(),
      output = this.file(id, revisionName);
    fs.mkdirSync(output);
    let renderDevice = 'CPU';
    if (args.operations.some((o) => ['render', 'render_views'].includes(o.op))) {
      try {
        const free = Number(
          execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 2000,
          })
            .trim()
            .split('\n')[0],
        );
        if (free >= 2500) renderDevice = 'GPU';
      } catch {
        /* Keep CPU rendering on unsupported or memory-constrained hardware. */
      }
    }
    const job = {
      renderDevice,
      materialInventory: (previous?.scene?.materials || [])
        .flatMap((m) => {
          const parsed = operations.create_material.safeParse({
            name: m.name,
            color: m.color,
            metallic: m.metallic,
            roughness: m.roughness,
          });
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, 128),
      units: previous?.units || args.units,
      operations: args.operations,
      output,
      input: previous && !rebuild ? this.file(id, path.join(previous.folder, 'scene.blend')) : null,
    };
    const jobPath = this.file(id, revisionName + '.json');
    fs.writeFileSync(jobPath, JSON.stringify(job));
    this.emit('blender-progress', { projectId: id, stage: 'modeling', revision });
    const viewCount = args.operations.find((o) => o.op === 'render_views')?.views.length || 1;
    const deadline = AbortSignal.timeout(
        Math.min(300000, (this.config().blenderTimeout || 90000) * viewCount),
      ),
      combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const release = this.resources ? await this.resources.acquire('Blender', combined) : () => {};
    try {
      await new Promise((resolve, reject) => {
        let stderr = '',
          settled = false;
        const child = spawn(
          executable,
          [
            '--background',
            '--factory-startup',
            '--disable-autoexec',
            '--threads',
            '2',
            '--python-exit-code',
            '1',
            '--python',
            path
              .join(__dirname, 'worker.py')
              .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep),
            '--',
            jobPath,
          ],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const stop = () => {
          child.kill();
        };
        combined.addEventListener('abort', stop, { once: true });
        child.stderr.on('data', (chunk) => {
          stderr = (stderr + chunk.toString()).slice(-3000);
        });
        child.stdout.on('data', (chunk) => {
          stderr = (stderr + chunk.toString()).slice(-3000);
        });
        child.once('error', () => {
          settled = true;
          combined.removeEventListener('abort', stop);
          reject(Error('Blender could not start.'));
        });
        child.once('close', (code) => {
          combined.removeEventListener('abort', stop);
          if (settled) return;
          try {
            combined.throwIfAborted();
            if (code !== 0)
              throw Error(
                'Blender operation failed: ' +
                  stderr.replace(/nvapi-[\w-]+/g, '[redacted]').slice(-1500),
              );
            resolve();
          } catch (e) {
            reject(e);
          }
        });
        if (combined.aborted) stop();
      });
    } finally {
      release();
    }
    combined.throwIfAborted();
    const scene = JSON.parse(
      fs.readFileSync(normal(this.root, path.join(output, 'result.json')), 'utf8'),
    );
    if (!Array.isArray(scene.objects) || !fs.existsSync(path.join(output, 'scene.blend')))
      throw Error('Blender did not finish a verified project.');
    const exports = scene.exports.map((e) => {
      if (!/^[\w.-]+$/.test(e.name)) throw Error('Invalid export');
      const file = normal(this.root, path.join(output, e.name));
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw Error('Missing export');
      if (e.format === 'GLB') validateGlb(fs.readFileSync(file));
      return { ...e, assetId: crypto.randomUUID(), file, revision };
    });
    const manifest = {
      ...previous,
      id,
      title: previous?.title || args.title,
      units: job.units,
      revision,
      folder: revisionName,
      scene,
      exports: [...(previous?.exports || []), ...exports],
      private: previous?.private || false,
      updated: Date.now(),
    };
    const mf = this.file(id, 'project.json');
    fs.writeFileSync(mf + '.tmp', JSON.stringify(manifest));
    fs.renameSync(mf + '.tmp', mf);
    fs.writeFileSync(path.join(this.root, 'current.json'), JSON.stringify({ projectId: id }));
    this.current = id;
    this.emit('blender-progress', { projectId: id, stage: 'complete', revision });
    const glb = exports.find((e) => e.format === 'GLB');
    if (glb) {
      this.present(manifest, glb);
      this.emit('blender-model-presented', { projectId: id, assetId: glb.assetId });
    }
    return {
      success: true,
      verified: true,
      projectId: id,
      revision,
      scene,
      exports: exports.map(({ file, ...e }) => ({ ...e, path: file })),
      blendPath: path.join(output, 'scene.blend'),
    };
  }
  present(project, asset) {
    if (!this.workspace) return;
    const sourceId = project.id;
    const source = {
      id: sourceId,
      title: project.title,
      url: 'jarvis-artifact://' + project.id,
      readable: true,
      fetchedAt: Date.now(),
      images: [],
    };
    this.workspace.responseMode = 'FULL_WORKSPACE';
    const existing = this.workspace.current?.modules.find(
      (m) => m.panels.some((p) => p.projectId === project.id) && m.state !== 'closed',
    );
    if (existing && !this.workspace.locks.has(existing.id)) {
      const panel = existing.panels.find((p) => p.projectId === project.id);
      panel.assetId = asset.assetId;
      panel.body = modelDescription(project);
      existing.title = project.title + ' · revision ' + project.revision;
      this.workspace.publish();
      return;
    }
    this.workspace.receive(
      {
        title: project.title,
        modelOrganized: true,
        sources: [source],
        scenes: [
          {
            key: crypto.randomUUID(),
            title: project.title + ' · revision ' + project.revision,
            narration:
              'This is your real Blender model. Drag to rotate, scroll to zoom, or save the card to your library.',
            panels: [
              {
                type: 'model3d',
                title: project.title,
                assetId: asset.assetId,
                projectId: project.id,
                sourceIds: [sourceId],
                body: modelDescription(project),
                items: [],
                data: [],
                imageIds: [],
              },
            ],
          },
        ],
      },
      this.workspace.current ? 'append' : 'replace',
    );
    const created = this.workspace.current?.modules.find((m) =>
      m.panels.some((p) => p.projectId === project.id),
    );
    // Newly requested models should be inspectable even after a paused research
    // session. Held objects retain absolute priority; pinned layouts are kept
    // by the existing workspace choreography.
    if (created && !this.workspace.locks.size)
      this.workspace.control({ action: 'focus', moduleId: created.id });
  }
  asset(assetId) {
    uuid.parse(assetId);
    for (const folder of fs.readdirSync(this.root)) {
      if (!uuid.safeParse(folder).success) continue;
      let project;
      try {
        project = this.manifest(folder);
      } catch {
        continue;
      }
      const asset = project.exports.find((e) => e.assetId === assetId);
      if (!asset) continue;
      const file = normal(this.root, asset.file);
      if (asset.format !== 'GLB') throw Error('Only GLB can be previewed');
      const bytes = fs.readFileSync(file);
      validateGlb(bytes);
      return { base64: bytes.toString('base64'), projectId: folder, title: project.title };
    }
    throw Error('3D asset unavailable.');
  }
  async openProject(file, signal) {
    if (this.config().mock)
      return { success: true, verified: false, mock: true, message: 'Project import simulated.' };
    if (!this.config().filesystem) throw Error('File access disabled');
    file = path.resolve(z.string().max(1000).parse(file));
    const c = this.config();
    if (c.fileAccess === 'selected')
      file = await require('../tools.cjs').safePath(c.fileRoot, file);
    if (
      path.extname(file).toLowerCase() !== '.blend' ||
      !fs.existsSync(file) ||
      fs.statSync(file).size > 100 * 1024 * 1024
    )
      throw Error('Select a local .blend project under 100 MB.');
    const id = crypto.randomUUID(),
      folder = this.file(id, 'import');
    fs.mkdirSync(folder, { recursive: true });
    fs.copyFileSync(file, path.join(folder, 'scene.blend'));
    const base = {
      id,
      title: path.basename(file, '.blend').slice(0, 90),
      units: 'meters',
      revision: 1,
      folder: 'import',
      scene: { objects: [] },
      exports: [],
      private: true,
    };
    fs.writeFileSync(this.file(id, 'project.json'), JSON.stringify(base));
    this.current = id;
    return this.run({ projectId: id, operations: [{ op: 'get_scene' }] }, signal);
  }
  async design(args, signal) {
    if (this.config().mock)
      return {
        success: true,
        verified: false,
        mock: true,
        message: '3D design simulated; no project created.',
      };
    return require('./staged.cjs').design(this, args, signal);
  }
  plugin() {
    const tools = Object.entries(operations).map(([op, s]) => ({
      name: 'blender_' + op,
      description:
        'Blender ' +
        op.replaceAll('_', ' ') +
        '. Operates on the current real project; rotations are degrees, dimensions use project units. Discover blender tools before modeling.',
      permissions: ['FILES_WRITE', 'BLENDER_CONTROL'],
      risk: 1,
      inputSchema: zodToJsonSchema(s.extend({ projectId: uuid.optional() }).strict()),
      execute: ({ args }, signal) => {
        const { projectId, ...parameters } = args;
        return this.run(
          { projectId: projectId || this.current, operations: [{ op, ...parameters }] },
          signal,
        );
      },
    }));
    tools.push({
      name: 'blender_design',
      description:
        'Plan, build, render and visually review a real 3D object from a goal, with bounded correction iterations. For follow-up edits pass the current projectId from blender_status/get_scene. Outputs real .blend and GLB, and shows the interactive workspace card.',
      permissions: ['FILES_WRITE', 'BLENDER_CONTROL'],
      risk: 1,
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', minLength: 1, maxLength: 2000 },
          projectId: { type: 'string', format: 'uuid' },
          artifactSession: { type: 'string', format: 'uuid' },
          quality: { type: 'string', enum: ['QUICK', 'STANDARD', 'HIGH', 'ULTRA'] },
          resume: {
            type: 'boolean',
            description:
              'Continue the last committed stages of an interrupted project, preserving its design and verified reference analysis.',
          },
        },
        required: ['goal'],
        additionalProperties: false,
      },
      execute: ({ args }, signal) => this.design(args, signal),
    });
    tools.push({
      name: 'blender_apply_operations',
      description:
        'Create or edit a real 3D project with a bounded batch of validated mesh/material/light/camera/render/export operations. Include export GLB for an interactive workspace preview. Follow-up changes must reuse projectId and existing object names. No arbitrary scripts.',
      permissions: ['FILES_WRITE', 'BLENDER_CONTROL'],
      risk: 1,
      inputSchema: zodToJsonSchema(batch),
      execute: ({ args }, signal) => this.run(args, signal),
    });
    tools.push({
      name: 'blender_open_project',
      description:
        'Import a user-selected .blend project without executing embedded scripts. The source file is not overwritten.',
      permissions: ['FILES_READ', 'BLENDER_CONTROL'],
      risk: 1,
      privacy: 'files',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
      execute: ({ args }, signal) => this.openProject(args.path, signal),
    });
    tools.push({
      name: 'blender_status',
      description: 'Read Blender installation and current project status.',
      permissions: [],
      risk: 0,
      parallelSafe: true,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ success: true, verified: true, ...this.status() }),
    });
    for (const tool of tools) {
      if (tool.name !== 'blender_open_project')
        tool.validate = (args) => ({
          tool: tool.name,
          args: structuredClone(args),
          risk: tool.risk,
          privacy:
            (args.projectId || this.current) &&
            this.manifest(args.projectId || this.current).private
              ? 'files'
              : undefined,
        });
    }
    const read = tools.find((t) => t.name === 'blender_get_scene');
    read.risk = 0;
    read.parallelSafe = true;
    read.permissions = ['FILES_READ', 'BLENDER_CONTROL'];
    read.execute = async ({ args }) => ({
      success: true,
      verified: true,
      projectId: args.projectId || this.current,
      ...this.manifest(args.projectId || this.current),
    });
    for (const op of ['save_project', 'export']) {
      const tool = tools.find((t) => t.name === 'blender_' + op),
        execute = tool.execute;
      tool.inputSchema = zodToJsonSchema(
        operations[op]
          .extend({ projectId: uuid.optional(), path: z.string().min(1).max(1000).optional() })
          .strict(),
      );
      tool.validate = (args) => ({
        tool: tool.name,
        args: structuredClone(args),
        risk: args.path ? (fs.existsSync(path.resolve(args.path)) ? 3 : 2) : 1,
        privacy: 'files',
      });
      tool.execute = async (action, signal) => {
        const { path: destination, ...args } = action.args;
        const result = await execute({ ...action, args }, signal);
        if (!destination || !result.verified) return result;
        const target = path.resolve(destination),
          c = this.config();
        if (c.fileAccess === 'selected') inside(c.fileRoot, target);
        const source =
          op === 'save_project'
            ? result.blendPath
            : result.exports.find((e) => e.format === (args.format || 'GLB'))?.path;
        if (!source) throw Error('Requested export was not created.');
        if (path.extname(target).toLowerCase() !== path.extname(source).toLowerCase())
          throw Error('Destination must keep the exported file extension.');
        if (['.obj', '.gltf'].includes(path.extname(target).toLowerCase()))
          throw Error(
            'Multi-file exports remain in their project folder; use GLB for a portable single-file copy.',
          );
        const parent = fs.realpathSync(path.dirname(target));
        if (c.fileAccess === 'selected') inside(fs.realpathSync(c.fileRoot), parent);
        if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
          throw Error('Export destination cannot be a link.');
        const temp = path.join(
          parent,
          '.jarvis-export-' + crypto.randomUUID() + path.extname(target),
        );
        fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
        try {
          signal?.throwIfAborted();
          fs.renameSync(temp, target);
        } catch (e) {
          if (fs.existsSync(temp)) fs.unlinkSync(temp);
          throw e;
        }
        return { ...result, exportedTo: target };
      };
    }
    return {
      id: 'blender',
      name: 'BLENDER / REAL 3D',
      builtin: true,
      tools,
      availability: () => (this.status().available ? 'available' : 'unavailable'),
    };
  }
}
module.exports = { BlenderService, detect, inside, validateGlb };
