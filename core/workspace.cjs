const { z } = require('zod');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const id = z.string().uuid();
const layoutSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().min(0.25).max(1),
    height: z.number().finite().min(0.5).max(1),
  })
  .strict();
const controlSchema = z
  .object({
    action: z.enum([
      'pause',
      'resume',
      'stop',
      'next',
      'previous',
      'repeat',
      'focus',
      'move',
      'resize',
      'minimize',
      'expand',
      'close',
      'pin',
      'compare',
      'highlight',
    ]),
    moduleId: id.optional(),
    otherModuleId: id.optional(),
    x: z.number().finite().min(0).max(1).optional(),
    y: z.number().finite().min(0).max(1).optional(),
    width: z.number().finite().min(0.25).max(1).optional(),
    height: z.number().finite().min(0.5).max(1).optional(),
    panel: z.number().int().min(0).max(3).optional(),
    item: z.number().int().min(0).max(3).optional(),
    datum: z.number().int().min(0).max(11).optional(),
    imageId: id.optional(),
  })
  .strict();
const segmentSchema = z
  .object({
    text: z.string().min(1).max(1200),
    panel: z.number().int().min(0).max(3).default(0),
    item: z.number().int().min(0).max(3).optional(),
    datum: z.number().int().min(0).max(11).optional(),
    imageId: id.optional(),
  })
  .strict();
const ok = (extra = {}) => ({ success: true, verified: true, ...extra });
function boundedLayout(value) {
  const l = layoutSchema.parse(value);
  return { ...l, x: Math.min(l.x, 1 - l.width), y: Math.min(l.y, 1 - l.height) };
}
class ResearchWorkspace {
  constructor({ emit = () => {}, library, images, autoNarrate = () => true }) {
    Object.assign(this, { emit, library, images, autoNarrate });
    this.current = null;
    this.researching = false;
  }
  publish() {
    if (this.current) {
      this.current.updated = Date.now();
      this.emit('workspace', structuredClone(this.current));
    }
  }
  startTask() {
    this.researching = true;
    if (this.current) this.current.researching = true;
  }
  endTask() {
    this.researching = false;
    if (this.current) {
      this.current.researching = false;
      if (this.current.playback.state === 'waiting') this.current.playback.state = 'complete';
      this.publish();
    }
  }
  receive(briefing, mode = 'replace') {
    if (!briefing.modelOrganized) return;
    const append = mode === 'append' && this.current;
    const w = append
      ? structuredClone(this.current)
      : {
          id: crypto.randomUUID(),
          topic: briefing.title,
          created: Date.now(),
          updated: Date.now(),
          sources: [],
          modules: [],
          researching: this.researching,
          playback: { state: 'idle', moduleId: null, segment: 0, epoch: 0 },
          savedId: null,
        };
    const sourceMap = new Map(w.sources.map((s) => [s.id, s]));
    briefing.sources.forEach((s) => sourceMap.set(s.id, s));
    w.sources = [...sourceMap.values()];
    for (const scene of briefing.scenes) {
      if (w.modules.length >= 16)
        throw Error('This workspace already has sixteen modules. Save it before starting another.');
      const segments = scene.segments?.length
        ? scene.segments
        : scene.panels.some((p) => p.narration)
          ? scene.panels.flatMap((p, panel) => (p.narration ? [{ text: p.narration, panel }] : []))
          : [
              {
                text: (
                  scene.narration || scene.panels.map((p) => p.body || p.title).join('. ')
                ).slice(0, 1200),
                panel: 0,
              },
            ];
      for (const s of segments) {
        const p = scene.panels[s.panel];
        if (
          !p ||
          s.item >= p.items?.length ||
          s.datum >= p.data?.length ||
          (s.imageId && !p.imageIds?.includes(s.imageId))
        )
          throw Error('Narration focus must refer to content in its module.');
      }
      w.modules.push({
        id: crypto.randomUUID(),
        title: scene.title,
        panels: scene.panels,
        segments,
        layout: { x: 0, y: 0, width: 0.38, height: 1 },
        state: 'ready',
        pinned: false,
        completed: false,
      });
    }
    const cited = new Set(w.modules.flatMap((m) => m.panels.flatMap((p) => p.sourceIds)));
    w.sources = w.sources.filter((s) => cited.has(s.id));
    if (w.sources.length > 40)
      throw Error(
        'This briefing uses forty sources. Save it and start a new workspace for further research.',
      );
    this.current = w;
    if (!append) w.playback.epoch++;
    if (!append) {
      w.modules[0].state = 'active';
      w.playback = {
        state: this.autoNarrate() ? 'playing' : 'idle',
        moduleId: w.modules[0].id,
        segment: 0,
        epoch: w.playback.epoch,
      };
    } else if (w.playback.state === 'waiting' || w.playback.state === 'complete') {
      const next = w.modules.find((m) => m.state === 'ready' && !m.completed);
      if (next) this.activate(next, this.autoNarrate());
    }
    this.publish();
    return ok({
      modules: w.modules.map((m) => ({ id: m.id, title: m.title })),
      message: 'Modules are visible and narration can proceed while more research arrives.',
    });
  }
  module(id) {
    const m = this.current?.modules.find((m) => m.id === id);
    if (!m) throw Error('Select an existing research module.');
    return m;
  }
  activate(m, play = true) {
    const w = this.current;
    for (const other of w.modules)
      if (other.id !== m.id && other.state === 'active' && !other.pinned) other.state = 'docked';
    this.reveal(m);
    delete m.focus;
    w.playback = {
      state: play ? 'playing' : 'paused',
      moduleId: m.id,
      segment: 0,
      epoch: w.playback.epoch + 1,
    };
  }
  reveal(m) {
    const w = this.current,
      other = w.modules.filter((n) => n.id !== m.id && n.state === 'active');
    while (other.length > 1) {
      const n = other.shift();
      n.state = 'docked';
      n.pinned = false;
    }
    if (m.state !== 'active' && other.length)
      m.layout = { ...m.layout, x: other[0].layout.x < 0.4 ? 0.62 : 0, width: 0.38 };
    m.state = 'active';
  }
  complete(token) {
    const w = this.current,
      p = w?.playback;
    if (
      !p ||
      p.state !== 'playing' ||
      w.id !== token.sessionId ||
      p.moduleId !== token.moduleId ||
      p.segment !== token.segment ||
      p.epoch !== token.epoch
    )
      return ok({ stale: true });
    const m = this.module(p.moduleId);
    if (p.segment + 1 < m.segments.length) {
      delete m.focus;
      p.segment++;
      p.epoch++;
    } else {
      m.completed = true;
      if (!m.pinned) m.state = 'docked';
      const next = w.modules.find((n) => n.state === 'ready' && !n.completed);
      if (next) this.activate(next);
      else {
        p.state = w.researching ? 'waiting' : 'complete';
        p.epoch++;
      }
    }
    this.publish();
    return ok();
  }
  control(input) {
    const a = controlSchema.parse(input),
      w = this.current;
    if (!w) throw Error('There is no research workspace open.');
    const p = w.playback;
    const targeted = [
      'focus',
      'move',
      'resize',
      'minimize',
      'expand',
      'close',
      'pin',
      'compare',
      'highlight',
    ];
    const m = targeted.includes(a.action)
      ? this.module(a.moduleId)
      : w.modules.find((n) => n.id === p.moduleId) || w.modules[0];
    switch (a.action) {
      case 'pause':
        p.state = 'paused';
        p.epoch++;
        break;
      case 'resume':
        if (p.state === 'complete' || !p.moduleId)
          this.activate(
            w.modules.find((m) => !m.completed && m.state !== 'closed') || w.modules[0],
          );
        else {
          this.reveal(this.module(p.moduleId));
          delete this.module(p.moduleId).focus;
          p.state = 'playing';
          p.epoch++;
        }
        break;
      case 'stop':
        p.state = 'stopped';
        p.epoch++;
        break;
      case 'next':
      case 'previous': {
        const index = w.modules.indexOf(m) + (a.action === 'next' ? 1 : -1);
        if (!w.modules[index]) throw Error('No further module in that direction.');
        if (a.action === 'next') {
          m.completed = true;
          if (!m.pinned) m.state = 'docked';
        }
        this.activate(w.modules[index]);
        break;
      }
      case 'repeat':
        this.activate(m);
        break;
      case 'focus':
        this.activate(m, false);
        break;
      case 'move':
        if (a.x === undefined || a.y === undefined)
          throw Error('Supply normalized x and y positions.');
        m.layout = boundedLayout({ ...m.layout, x: a.x, y: a.y });
        this.reveal(m);
        break;
      case 'resize':
        if (a.width === undefined || a.height === undefined)
          throw Error('Supply normalized width and height.');
        m.layout = boundedLayout({ ...m.layout, width: a.width, height: a.height });
        break;
      case 'expand':
        m.layout = boundedLayout({
          ...m.layout,
          width: m.layout.width > 0.45 ? 0.38 : 0.58,
          height: 1,
        });
        this.reveal(m);
        break;
      case 'minimize':
      case 'close':
        m.state = a.action === 'close' ? 'closed' : 'docked';
        m.pinned = false;
        if (p.moduleId === m.id) {
          p.state = 'paused';
          p.epoch++;
        }
        break;
      case 'pin':
        m.pinned = !m.pinned;
        this.reveal(m);
        break;
      case 'compare': {
        const other = this.module(a.otherModuleId);
        if (other.id === m.id) throw Error('Choose two different modules.');
        for (const n of w.modules)
          if (n.id !== m.id && n.id !== other.id && n.state === 'active') n.state = 'docked';
        m.state = other.state = 'active';
        m.pinned = other.pinned = true;
        m.layout = { x: 0, y: 0, width: 0.38, height: 1 };
        other.layout = { x: 0.62, y: 0, width: 0.38, height: 1 };
        p.state = 'paused';
        p.epoch++;
        break;
      }
      case 'highlight': {
        const panel = m.panels[a.panel ?? 0];
        if (
          !panel ||
          a.item >= panel.items?.length ||
          a.datum >= panel.data?.length ||
          (a.imageId && !panel.imageIds?.includes(a.imageId))
        )
          throw Error('That content is not in the selected module.');
        p.state = 'paused';
        p.epoch++;
        m.focus = { panel: a.panel ?? 0, item: a.item, datum: a.datum, imageId: a.imageId };
        this.reveal(m);
        break;
      }
    }
    this.publish();
    return ok({ observedState: this.summary() });
  }
  summary(moduleId) {
    const w = this.current;
    if (moduleId) {
      const m = this.module(moduleId);
      return {
        topic: w.topic,
        module: structuredClone(m),
        sources: w.sources.filter((s) => m.panels.some((p) => p.sourceIds.includes(s.id))),
        _privacy: w.savedId ? 'files' : undefined,
      };
    }
    return w
      ? {
          id: w.id,
          topic: w.topic,
          savedId: w.savedId,
          playback: w.playback,
          modules: w.modules.map(({ id, title, state, completed, layout }) => ({
            id,
            title,
            state,
            completed,
            layout,
          })),
        }
      : null;
  }
  save() {
    if (!this.current) throw Error('No briefing to save.');
    const entry = this.library.save(this.current);
    this.current.savedId = entry.id;
    this.publish();
    return ok({ entry });
  }
  open(id) {
    const saved = this.library.open(id);
    this.current = saved.workspace;
    this.current.savedId = id;
    this.current.researching = false;
    this.researching = false;
    this.current.playback = {
      ...this.current.playback,
      state: 'paused',
      epoch: this.current.playback.epoch + 1,
    };
    const source = this.current.sources;
    this.images?.restoreImages(source);
    this.publish();
    return ok({ observedState: this.summary() });
  }
}
const sourceSchema = z
  .object({
    id: z.string().max(200),
    title: z.string().max(1000),
    url: z
      .string()
      .url()
      .max(4000)
      .refine((u) => {
        const p = new URL(u);
        return ['http:', 'https:'].includes(p.protocol) && !p.username && !p.password;
      }),
    publishedAt: z.string().nullable().optional(),
    fetchedAt: z.number().finite().nullable().optional(),
    readable: z.boolean(),
    images: z
      .array(
        z
          .object({
            id,
            title: z.string().max(1000),
            url: z
              .string()
              .url()
              .max(4000)
              .refine(
                (u) =>
                  /^https?:$/.test(new URL(u).protocol) &&
                  !new URL(u).username &&
                  !new URL(u).password,
              ),
            sourceUrl: z
              .string()
              .url()
              .max(4000)
              .refine(
                (u) =>
                  /^https?:$/.test(new URL(u).protocol) &&
                  !new URL(u).username &&
                  !new URL(u).password,
              ),
            width: z.number().optional(),
            height: z.number().optional(),
          })
          .passthrough(),
      )
      .max(6),
  })
  .strip();
class ResearchLibrary {
  constructor(directory, changed = () => {}) {
    this.changed = changed;
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.checkDirectory();
  }
  checkDirectory() {
    if (fs.lstatSync(this.directory).isSymbolicLink())
      throw Error('Research directory must be a normal local folder.');
  }
  write(key, data) {
    this.checkDirectory();
    const file = this.file(key),
      temp = file + '.tmp';
    if (fs.existsSync(temp) && fs.lstatSync(temp).isSymbolicLink())
      throw Error('Invalid research temporary file.');
    fs.writeFileSync(temp, JSON.stringify(data));
    fs.renameSync(temp, file);
    this.changed();
  }
  file(value) {
    return path.join(this.directory, id.parse(value) + '.json');
  }
  validate(input) {
    const { briefingSchema } = require('./briefing.cjs');
    if (
      !input ||
      typeof input.topic !== 'string' ||
      input.topic.length > 120 ||
      !Array.isArray(input.modules) ||
      input.modules.length < 1 ||
      input.modules.length > 16
    )
      throw Error('Invalid saved research workspace.');
    const sources = z.array(sourceSchema).max(40).parse(input.sources),
      sourceIds = new Set(sources.map((s) => s.id)),
      images = new Set(sources.flatMap((s) => s.images.map((i) => i.id)));
    const modules = input.modules.map((m) => {
      const scene = briefingSchema.shape.scenes.element.parse({
        title: m.title,
        narration: '',
        panels: m.panels,
        segments: m.segments,
      });
      scene.panels.forEach((p) => {
        if (p.sourceIds.some((s) => !sourceIds.has(s)) || p.imageIds.some((i) => !images.has(i)))
          throw Error('Invalid saved source reference.');
      });
      const segments = z.array(segmentSchema).min(1).max(16).parse(m.segments);
      segments.forEach((s) => {
        const p = scene.panels[s.panel];
        if (
          !p ||
          s.item >= p.items.length ||
          s.datum >= p.data.length ||
          (s.imageId && !p.imageIds.includes(s.imageId))
        )
          throw Error('Invalid saved focus target.');
      });
      return {
        id: id.parse(m.id),
        title: scene.title,
        panels: scene.panels,
        segments,
        layout: boundedLayout(m.layout),
        state: z.enum(['active', 'ready', 'docked', 'closed']).parse(m.state),
        pinned: m.pinned === true,
        completed: m.completed === true,
      };
    });
    if (new Set(modules.map((m) => m.id)).size !== modules.length)
      throw Error('Duplicate module identities.');
    return {
      id: id.parse(input.id),
      topic: input.topic,
      created: z.number().finite().parse(input.created),
      updated: Date.now(),
      sources,
      modules,
      researching: false,
      savedId: null,
      playback: { state: 'paused', moduleId: modules[0].id, segment: 0, epoch: 0 },
    };
  }
  save(workspace) {
    const value = this.validate(workspace),
      key = workspace.savedId ? id.parse(workspace.savedId) : crypto.randomUUID(),
      file = this.file(key);
    if (
      !fs.existsSync(file) &&
      fs.readdirSync(this.directory).filter((n) => n.endsWith('.json')).length >= 200
    )
      throw Error('Research library is full. Remove an older saved session first.');
    const data = {
      version: 1,
      id: key,
      topic: value.topic,
      created: Date.now(),
      lastOpened: null,
      workspace: value,
    };
    if (fs.existsSync(file)) {
      const old = this.read(key);
      data.created = old.created;
      data.lastOpened = old.lastOpened;
    }
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > 2e6) throw Error('Research session is too large to save.');
    this.write(key, data);
    return this.metadata(data);
  }
  read(key) {
    this.checkDirectory();
    const file = this.file(key);
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 2e6)
      throw Error('Invalid saved briefing file.');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version !== 1 || value.id !== key) throw Error('Invalid saved briefing.');
    value.workspace = this.validate(value.workspace);
    if (
      value.topic !== value.workspace.topic ||
      !Number.isFinite(value.created) ||
      (value.lastOpened !== null && !Number.isFinite(value.lastOpened))
    )
      throw Error('Invalid saved research metadata.');
    return value;
  }
  metadata(v) {
    return {
      id: v.id,
      topic: v.topic,
      created: v.created,
      lastOpened: v.lastOpened,
      moduleCount: v.workspace.modules.length,
    };
  }
  list(query = '') {
    return fs
      .readdirSync(this.directory)
      .filter((n) => /^[0-9a-f-]{36}\.json$/i.test(n))
      .slice(0, 200)
      .flatMap((n) => {
        try {
          return [this.metadata(this.read(n.slice(0, -5)))];
        } catch {
          return [];
        }
      })
      .filter((e) => e.topic.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.created - a.created);
  }
  open(key) {
    const data = this.read(id.parse(key));
    data.lastOpened = Date.now();
    this.write(key, data);
    return data;
  }
  rename(key, topic) {
    topic = z.string().trim().min(1).max(120).parse(topic);
    const data = this.read(id.parse(key));
    data.topic = data.workspace.topic = topic;
    this.write(key, data);
    return this.metadata(data);
  }
  delete(key) {
    this.read(id.parse(key));
    fs.unlinkSync(this.file(key));
    this.changed();
    return ok();
  }
}
module.exports = {
  ResearchWorkspace,
  ResearchLibrary,
  controlSchema,
  segmentSchema,
  boundedLayout,
};
