const { z } = require('zod');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const id = z.string().uuid();
const { arrange, zones } = require('./research-choreography.cjs');
const layoutSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().min(0.12).max(1),
    height: z.number().finite().min(0.16).max(1),
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
      'secondary',
      'park',
      'stack',
      'group',
      'ungroup',
      'collapse_group',
      'expand_group',
      'trash',
    ]),
    moduleId: id.optional(),
    moduleIds: z.array(id).min(1).max(16).optional(),
    groupId: z.string().min(1).max(100).optional(),
    groupTitle: z.string().min(1).max(90).optional(),
    zone: z.enum(Object.keys(zones)).optional(),
    otherModuleId: id.optional(),
    x: z.number().finite().min(0).max(1).optional(),
    y: z.number().finite().min(0).max(1).optional(),
    width: z.number().finite().min(0.12).max(1).optional(),
    height: z.number().finite().min(0.16).max(1).optional(),
    panel: z.number().int().min(0).max(3).optional(),
    item: z.number().int().min(0).max(3).optional(),
    datum: z.number().int().min(0).max(11).optional(),
    imageId: id.optional(),
  })
  .strict();
const segmentSchema = z
  .object({
    text: z.string().min(1).max(1200),
    focusObjectId: z.string().min(1).max(100).optional(),
    relatedObjectIds: z.array(z.string().min(1).max(100)).max(8).optional(),
    actions: z
      .array(
        z
          .object({
            type: z.enum([
              'FOCUS',
              'ENLARGE',
              'SHRINK',
              'MOVE',
              'STACK',
              'BRING_FORWARD',
              'SEND_BACK',
              'DIM',
              'HIGHLIGHT',
              'PIN',
              'PARK',
              'GROUP',
            ]),
            objectId: z.string().min(1).max(100),
            zone: z.enum(Object.keys(zones)).optional(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
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
function pruneReferences(modules) {
  const ids = new Set(modules.map((m) => m.id));
  for (const m of modules) {
    m.segments = m.segments.map((s) => ({
      ...s,
      focusObjectId: ids.has(s.focusObjectId) ? s.focusObjectId : m.id,
      relatedObjectIds: (s.relatedObjectIds || []).filter((id) => ids.has(id)),
      actions: (s.actions || []).filter((a) => ids.has(a.objectId)),
    }));
  }
}
class ResearchWorkspace {
  constructor({ emit = () => {}, library, images, autoNarrate = () => true }) {
    Object.assign(this, { emit, library, images, autoNarrate });
    this.current = null;
    this.researching = false;
    this.locks = new Map();
    this.pendingControls = new Map();
    this.responseMode = 'SIMPLE';
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
    const append = mode === 'append' && this.current && this.responseMode !== 'VISUAL_ASSIST';
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
          responseMode: this.responseMode,
        };
    const sourceMap = new Map(w.sources.map((s) => [s.id, s]));
    briefing.sources.forEach((s) => sourceMap.set(s.id, s));
    w.sources = [...sourceMap.values()];
    for (const scene of this.responseMode === 'VISUAL_ASSIST'
      ? briefing.scenes.slice(0, 1)
      : briefing.scenes) {
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
          !s.focusObjectId &&
          (!p ||
            s.item >= p.items?.length ||
            s.datum >= p.data?.length ||
            (s.imageId && !p.imageIds?.includes(s.imageId)))
        )
          throw Error('Narration focus must refer to content in its module.');
      }
      w.modules.push({
        id: crypto.randomUUID(),
        objectKey: scene.key || crypto.randomUUID(),
        groupId: scene.groupId || null,
        groupTitle: scene.groupTitle || '',
        visualRole: 'STACKED',
        zIndex: 20,
        userPositioned: false,
        userLocked: false,
        savedId: null,
        folderId: null,
        title: scene.title,
        panels: scene.panels,
        segments,
        layout: { x: 0, y: 0, width: 0.38, height: 1 },
        state: 'ready',
        pinned: false,
        completed: false,
      });
    }
    const keys = new Map(
      w.modules.flatMap((m) => [
        [m.id, m.id],
        [m.objectKey, m.id],
      ]),
    );
    if (new Set(w.modules.map((m) => m.objectKey)).size !== w.modules.length)
      throw Error('Use unique object keys.');
    for (const m of w.modules)
      for (const segment of m.segments) {
        if (segment.focusObjectId) {
          if (!keys.has(segment.focusObjectId)) throw Error('Unknown narration object.');
          segment.focusObjectId = keys.get(segment.focusObjectId);
        }
        const focusPanel = w.modules.find((n) => n.id === (segment.focusObjectId || m.id))?.panels[
          segment.panel
        ];
        if (
          !focusPanel ||
          segment.item >= focusPanel.items?.length ||
          segment.datum >= focusPanel.data?.length ||
          (segment.imageId && !focusPanel.imageIds?.includes(segment.imageId))
        )
          throw Error('Narration target content is unavailable.');
        segment.relatedObjectIds = (segment.relatedObjectIds || []).map((key) => {
          if (!keys.has(key)) throw Error('Unknown related object.');
          return keys.get(key);
        });
        for (const action of segment.actions || []) {
          if (!keys.has(action.objectId)) throw Error('Unknown choreography object.');
          action.objectId = keys.get(action.objectId);
        }
      }
    const cited = new Set(w.modules.flatMap((m) => m.panels.flatMap((p) => p.sourceIds)));
    w.sources = w.sources.filter((s) => cited.has(s.id));
    if (w.sources.length > 40)
      throw Error(
        'This briefing uses forty sources. Save it and start a new workspace for further research.',
      );
    if (!append && this.locks.size)
      throw Error('Release held files before replacing the workspace. Append new files instead.');
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
    this.choreograph();
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
  choreograph() {
    const w = this.current;
    if (!w) return;
    const spoken = w.modules.find((m) => m.id === w.playback.moduleId);
    const segment = spoken?.segments[w.playback.segment];
    const focus = segment?.focusObjectId || w.playback.moduleId || w.modules[0]?.id;
    arrange(w, focus, segment?.relatedObjectIds || [], this.locks);
    for (const action of segment?.actions || []) {
      const m = w.modules.find((m) => m.id === action.objectId);
      if (!m || this.locks.size || m.pinned || m.userPositioned) continue;
      if (action.type === 'MOVE' && action.zone) m.layout = { ...zones[action.zone] };
      if (['PARK', 'STACK', 'DIM', 'SHRINK', 'SEND_BACK'].includes(action.type))
        m.visualRole =
          action.type === 'PARK' ? 'PARKED' : action.type === 'STACK' ? 'STACKED' : 'CONTEXT';
      if (action.type === 'PIN') m.pinned = true;
      if (action.type === 'ENLARGE') {
        m.visualRole = 'PRIMARY';
        m.layout = { ...zones.PRIMARY_RIGHT };
      }
      if (action.type === 'SHRINK') m.layout = { ...zones.TOP_LEFT };
      if (action.type === 'PARK') m.layout = { ...zones.PARKING_EDGE };
      if (action.type === 'STACK') m.layout = { ...zones.STACK_LEFT };
      if (action.type === 'SEND_BACK') m.zIndex = 10;
      if (action.type === 'HIGHLIGHT') m.zIndex = Math.max(40, m.zIndex || 20);
      if (action.type === 'GROUP') {
        m.groupId = spoken.groupId || spoken.id;
        m.groupTitle = spoken.groupTitle || spoken.title;
      }
      if (action.type === 'FOCUS') arrange(w, m.id, segment.relatedObjectIds || [], this.locks);
      if (action.type === 'BRING_FORWARD') m.zIndex = 55;
    }
  }
  activate(m, play = true) {
    const w = this.current;
    for (const other of w.modules)
      if (
        other.id !== m.id &&
        other.state === 'active' &&
        !other.pinned &&
        !this.locks.has(other.id)
      )
        other.state = 'docked';
    this.reveal(m);
    delete m.focus;
    w.playback = {
      state: play ? 'playing' : 'paused',
      moduleId: m.id,
      segment: 0,
      epoch: w.playback.epoch + 1,
    };
    this.choreograph();
  }
  reveal(m) {
    m.state = 'active';
  }
  gesture(input) {
    const a = z
      .object({
        sessionId: id,
        moduleId: id,
        token: id,
        phase: z.enum(['USER_GRABBED', 'USER_DRAGGING', 'USER_RESIZING', 'RELEASE']),
        layout: layoutSchema.optional(),
      })
      .strict()
      .parse(input);
    if (this.current?.id !== a.sessionId) return ok({ stale: true });
    const m = this.module(a.moduleId),
      lock = this.locks.get(m.id);
    if (a.phase === 'RELEASE') {
      if (!lock || lock.token !== a.token) return ok({ stale: true });
      if (a.layout) {
        m.layout = boundedLayout(a.layout);
        m.userPositioned = true;
      }
      this.locks.delete(m.id);
      m.userLocked = false;
      delete m.lockPhase;
      const pending = this.pendingControls.get(m.id);
      this.pendingControls.delete(m.id);
      this.choreograph();
      if (pending && !a.layout) this.control(pending);
    } else {
      if (lock && lock.token !== a.token) throw Error('File already held.');
      this.locks.set(m.id, { token: a.token, phase: a.phase });
      m.userLocked = true;
      m.lockPhase = a.phase;
    }
    this.publish();
    return ok();
  }
  releaseLocks() {
    this.locks.clear();
    this.pendingControls.clear();
    for (const m of this.current?.modules || []) {
      m.userLocked = false;
      delete m.lockPhase;
    }
    this.choreograph();
    this.publish();
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
      if (!m.pinned && !this.locks.has(m.id)) m.state = 'docked';
      const next = w.modules.find((n) => n.state === 'ready' && !n.completed);
      if (next) this.activate(next);
      else {
        p.state = w.researching ? 'waiting' : 'complete';
        p.epoch++;
      }
    }
    this.choreograph();
    this.publish();
    return ok();
  }
  control(input, actor = 'agent') {
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
      'secondary',
      'park',
      'stack',
      'group',
      'ungroup',
      'collapse_group',
      'expand_group',
      'trash',
    ];
    const m =
      targeted.includes(a.action) &&
      !['group', 'ungroup', 'stack', 'collapse_group', 'expand_group'].includes(a.action)
        ? this.module(a.moduleId)
        : w.modules.find((n) => n.id === p.moduleId) || w.modules[0];
    if (targeted.includes(a.action) && m?.userLocked) {
      this.pendingControls.set(m.id, a);
      return ok({
        deferred: true,
        message: 'User is holding this file; its geometry and layer remain unchanged.',
      });
    }
    if (
      actor !== 'user' &&
      m?.pinned &&
      ['move', 'resize', 'expand', 'compare', 'stack', 'park'].includes(a.action)
    )
      return ok({ blocked: true, message: 'Unpin this file before rearranging it.' });
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
          if (!m.pinned && !this.locks.has(m.id)) m.state = 'docked';
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
        m.userPositioned = true;
        this.reveal(m);
        break;
      case 'resize':
        if (a.width === undefined || a.height === undefined)
          throw Error('Supply normalized width and height.');
        m.layout = boundedLayout({ ...m.layout, width: a.width, height: a.height });
        m.userPositioned = true;
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
        if (other.userLocked || (actor !== 'user' && other.pinned)) return ok({ blocked: true });
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
      case 'secondary':
        m.visualRole = 'SECONDARY';
        this.reveal(m);
        break;
      case 'park':
        m.visualRole = 'PARKED';
        m.state = 'docked';
        break;
      case 'stack':
      case 'group':
      case 'ungroup':
      case 'collapse_group':
      case 'expand_group': {
        const selected = a.moduleIds
          ? a.moduleIds.map((id) => this.module(id))
          : w.modules.filter((n) => n.groupId === a.groupId);
        if (!selected.length) throw Error('Select existing files or a group.');
        if (selected.some((n) => n.userLocked)) return ok({ deferred: true });
        const groupKey = a.groupId || crypto.randomUUID();
        for (const n of selected) {
          if (a.action === 'group') {
            n.groupId = groupKey;
            n.groupTitle = a.groupTitle || n.groupId;
          }
          if (a.action === 'ungroup') {
            n.groupId = null;
            n.groupCollapsed = false;
          }
          if (a.action === 'collapse_group' || a.action === 'stack') {
            n.groupCollapsed = true;
            if (!n.pinned) {
              n.visualRole = 'STACKED';
              if (!n.userPositioned)
                n.layout = {
                  ...zones.STACK_LEFT,
                  y: Math.min(0.8, 0.35 + selected.indexOf(n) * 0.055),
                };
            }
          }
          if (a.action === 'expand_group') {
            n.groupCollapsed = false;
            if (!n.pinned) n.visualRole = 'CONTEXT';
          }
        }
        break;
      }
      case 'trash': {
        const target = this.module(a.moduleId);
        if (target.userLocked) return ok({ deferred: true });
        w.modules = w.modules.filter((n) => n.id !== target.id);
        pruneReferences(w.modules);
        if (p.moduleId === target.id) {
          p.moduleId = w.modules[0]?.id || null;
          p.state = 'paused';
          p.segment = 0;
          p.epoch++;
        }
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
        _privacy: w.savedId || m.savedId ? 'files' : undefined,
      };
    }
    return w
      ? {
          id: w.id,
          topic: w.topic,
          savedId: w.savedId,
          fromLibrary: !!w.fromLibrary || !!w.savedId || w.modules.some((m) => !!m.savedId),
          playback: w.playback,
          responseMode: w.responseMode,
          pendingFocus: w.pendingFocus,
          modules: w.modules.map(
            ({
              id,
              title,
              state,
              completed,
              layout,
              visualRole,
              groupId,
              groupTitle,
              userLocked,
              userPositioned,
              pinned,
              savedId,
            }) => ({
              id,
              title,
              state,
              completed,
              layout,
              visualRole,
              groupId,
              groupTitle,
              userLocked,
              userPositioned,
              pinned,
              savedId,
            }),
          ),
        }
      : null;
  }
  save(input = {}) {
    const a = saveSchema.parse(input);
    if (!this.current) throw Error('No briefing to save.');
    const selected = a.moduleIds
      ? a.moduleIds.map((id) => this.module(id))
      : a.groupId
        ? this.current.modules.filter((m) => m.groupId === a.groupId)
        : this.current.modules;
    if (!selected.length) throw Error('No files selected.');
    const whole = !a.moduleIds && !a.groupId;
    const value = structuredClone(this.current);
    value.modules = structuredClone(selected);
    const selectedIds = new Set(selected.map((m) => m.id));
    for (const m of value.modules) {
      m.segments = m.segments
        .filter((s) => !s.focusObjectId || selectedIds.has(s.focusObjectId))
        .map((s) => ({
          ...s,
          relatedObjectIds: (s.relatedObjectIds || []).filter((id) => selectedIds.has(id)),
          actions: (s.actions || []).filter((a) => selectedIds.has(a.objectId)),
        }));
      if (!m.segments.length) m.segments = [{ text: m.panels[0].body || m.title, panel: 0 }];
    }
    value.topic =
      a.topic ||
      (whole ? value.topic : a.groupId ? selected[0].groupTitle || value.topic : selected[0].title);
    const cited = new Set(selected.flatMap((m) => m.panels.flatMap((p) => p.sourceIds)));
    value.sources = value.sources.filter((s) => cited.has(s.id));
    value.savedId = whole
      ? this.current.savedId
      : selected.length === 1
        ? selected[0].savedId
        : null;
    const entry = this.library.save(value, {
      kind: whole ? 'workspace' : selected.length === 1 ? 'object' : 'group',
      folderId: a.folderId,
    });
    if (whole) this.current.savedId = entry.id;
    for (const m of selected) {
      m.savedId = entry.id;
      m.folderId = entry.folderId;
    }
    this.publish();
    return ok({ entry });
  }
  openFolder(folderId) {
    if (this.locks.size) throw Error('Release held files before opening a folder.');
    this.library.folder(folderId);
    const entries = this.library.list('', folderId);
    if (!entries.length) throw Error('This folder contains no saved files.');
    const values = entries.map((e) => this.library.open(e.id).workspace);
    const first = values[0];
    const modules = [],
      sources = new Map();
    let partial = false;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      for (const m of value.modules) {
        if (modules.some((n) => n.id === m.id)) continue;
        if (modules.length >= 16) {
          partial = true;
          continue;
        }
        const required = new Set(
          [...modules, m].flatMap((n) => n.panels.flatMap((p) => p.sourceIds)),
        );
        if (required.size > 40) {
          partial = true;
          continue;
        }
        m.savedId = entries[i].id;
        m.folderId = folderId;
        m.userLocked = false;
        modules.push(m);
      }
      for (const source of value.sources) sources.set(source.id, source);
    }
    const cited = new Set(modules.flatMap((m) => m.panels.flatMap((p) => p.sourceIds)));
    pruneReferences(modules);
    this.current = {
      ...first,
      id: crypto.randomUUID(),
      topic: this.library.folder(folderId).name,
      sources: [...sources.values()].filter((s) => cited.has(s.id)).slice(0, 40),
      modules,
      savedId: null,
      fromLibrary: true,
      researching: false,
      playback: { state: 'paused', moduleId: modules[0].id, segment: 0, epoch: 0 },
    };
    this.images?.restoreImages(this.current.sources);
    this.locks.clear();
    this.choreograph();
    this.publish();
    return ok({
      opened: modules.length,
      partial,
    });
  }
  open(id) {
    if (this.locks.size) throw Error('Release held files before opening another workspace.');
    const saved = this.library.open(id);
    this.current = saved.workspace;
    this.current.savedId = id;
    this.current.fromLibrary = true;
    for (const m of this.current.modules) {
      m.savedId = id;
      m.folderId = saved.folderId || null;
      m.userLocked = false;
    }
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
  forgetSaved(id) {
    if (!this.current) return;
    if (this.current.savedId === id) {
      this.current.savedId = null;
      this.current.fromLibrary = true;
    }
    for (const m of this.current.modules)
      if (m.savedId === id) {
        this.current.fromLibrary = true;
        m.savedId = null;
        m.folderId = null;
      }
    this.publish();
  }
}
const saveSchema = z
  .object({
    moduleIds: z.array(id).min(1).max(16).optional(),
    groupId: z.string().min(1).max(100).optional(),
    folderId: id.nullable().optional(),
    topic: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
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
    this.folderDirectory = path.join(this.directory, 'folders');
    fs.mkdirSync(this.folderDirectory, { recursive: true });
    if (fs.lstatSync(this.folderDirectory).isSymbolicLink())
      throw Error('Library folder metadata cannot be a symlink.');
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
          !s.focusObjectId &&
          (!p ||
            s.item >= p.items.length ||
            s.datum >= p.data.length ||
            (s.imageId && !p.imageIds.includes(s.imageId)))
        )
          throw Error('Invalid saved focus target.');
      });
      return {
        id: id.parse(m.id),
        objectKey: z
          .string()
          .max(100)
          .parse(m.objectKey || m.id),
        groupId: m.groupId ? z.string().max(100).parse(m.groupId) : null,
        groupTitle: z
          .string()
          .max(90)
          .parse(m.groupTitle || ''),
        groupCollapsed: m.groupCollapsed === true,
        visualRole: z
          .enum(['PRIMARY', 'SECONDARY', 'CONTEXT', 'PARKED', 'STACKED'])
          .parse(m.visualRole || (m.state === 'active' ? 'PRIMARY' : 'CONTEXT')),
        userPositioned: m.userPositioned === true,
        userLocked: false,
        zIndex: z
          .number()
          .int()
          .min(-100)
          .max(100)
          .parse(m.zIndex || 20),
        savedId: m.savedId ? id.parse(m.savedId) : null,
        folderId: m.folderId ? id.parse(m.folderId) : null,
        title: scene.title,
        panels: scene.panels,
        segments,
        layout: boundedLayout(m.layout),
        state: z.enum(['active', 'ready', 'docked', 'closed']).parse(m.state),
        pinned: m.pinned === true,
        completed: m.completed === true,
      };
    });
    const moduleMap = new Map(modules.map((m) => [m.id, m]));
    for (const m of modules)
      for (const segment of m.segments) {
        const target = segment.focusObjectId ? moduleMap.get(segment.focusObjectId) : m;
        const p = target?.panels[segment.panel];
        if (
          !p ||
          segment.item >= p.items.length ||
          segment.datum >= p.data.length ||
          (segment.imageId && !p.imageIds.includes(segment.imageId)) ||
          (segment.relatedObjectIds || []).some((id) => !moduleMap.has(id)) ||
          (segment.actions || []).some((a) => !moduleMap.has(a.objectId))
        )
          throw Error('Invalid saved choreography reference.');
      }
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
      responseMode: z
        .enum(['SIMPLE', 'VISUAL_ASSIST', 'FULL_WORKSPACE'])
        .parse(input.responseMode || 'FULL_WORKSPACE'),
      playback: { state: 'paused', moduleId: modules[0].id, segment: 0, epoch: 0 },
    };
  }
  save(workspace, options = {}) {
    if (options.folderId) this.folder(options.folderId);
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
      kind: options.kind || 'workspace',
      folderId: options.folderId || null,
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
      if (options.folderId === undefined) data.folderId = old.folderId || null;
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
    value.kind = z.enum(['workspace', 'object', 'group']).parse(value.kind || 'workspace');
    value.folderId = value.folderId ? id.parse(value.folderId) : null;
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
      kind: v.kind || 'workspace',
      folderId: v.folderId || null,
    };
  }
  list(query = '', folderId) {
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
      .filter(
        (e) =>
          e.topic.toLowerCase().includes(query.toLowerCase()) &&
          (folderId === undefined || e.folderId === folderId),
      )
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
  folderFile(key) {
    this.checkDirectory();
    if (fs.lstatSync(this.folderDirectory).isSymbolicLink())
      throw Error('Invalid library folders.');
    return path.join(this.folderDirectory, id.parse(key) + '.json');
  }
  folder(key) {
    const file = this.folderFile(key);
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 10000)
      throw Error('Invalid library folder.');
    const value = z
      .object({
        id,
        name: z.string().min(1).max(90),
        parentId: id.nullable(),
        created: z.number().finite(),
      })
      .strict()
      .parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (value.id !== key) throw Error('Invalid folder identity.');
    return value;
  }
  folders() {
    this.checkDirectory();
    if (fs.lstatSync(this.folderDirectory).isSymbolicLink())
      throw Error('Invalid library folders.');
    return fs
      .readdirSync(this.folderDirectory)
      .filter((n) => /^[0-9a-f-]{36}\.json$/i.test(n))
      .slice(0, 64)
      .flatMap((n) => {
        try {
          return [this.folder(n.slice(0, -5))];
        } catch {
          return [];
        }
      });
  }
  createFolder(name, parentId = null) {
    name = z.string().trim().min(1).max(90).parse(name);
    if (parentId) this.folder(id.parse(parentId));
    const existing = this.folders().find(
      (f) => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return existing;
    if (this.folders().length >= 64) throw Error('Library has sixty-four folders.');
    const value = { id: crypto.randomUUID(), name, parentId, created: Date.now() };
    fs.writeFileSync(this.folderFile(value.id), JSON.stringify(value), { flag: 'wx' });
    this.changed();
    return value;
  }
  move(key, folderId = null) {
    if (folderId) this.folder(id.parse(folderId));
    const value = this.read(id.parse(key));
    value.folderId = folderId;
    this.write(key, value);
    return this.metadata(value);
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
  saveSchema,
};
