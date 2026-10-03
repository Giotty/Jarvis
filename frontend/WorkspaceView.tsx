import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ResearchPanel, AttributedImage } from './ResearchContent';
import {
  Briefing,
  Workspace,
  WorkspaceModule,
  WorkspaceControl,
  ResearchEntry,
  ResearchFolder,
  Confirmation,
  unwrap,
} from './types';

type Gesture = {
  id: string;
  token: string;
  sessionId: string;
  mode: 'move' | 'resize' | 'hold';
  phase: string;
  startX: number;
  startY: number;
  layout: WorkspaceModule['layout'];
  next: WorkspaceModule['layout'];
  snapshot: WorkspaceModule;
  element: HTMLElement;
  capture: Element;
  pointer: number;
  changed: boolean;
};
export const WorkspaceView = memo(function WorkspaceView({
  workspace,
  onNarrate,
  onInterrupt,
  onClose,
  onLibrary,
  onError,
  gpuLoad,
}: {
  workspace: Workspace;
  onNarrate: (text: string, done: () => void) => void;
  onInterrupt: () => void;
  onClose: () => void;
  onLibrary: () => void;
  onError: (text: string) => void;
  gpuLoad: number | null | undefined;
}) {
  const stage = useRef<HTMLDivElement>(null),
    frame = useRef(0),
    drag = useRef<Gesture | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 400 }),
    [held, setHeld] = useState<WorkspaceModule | null>(null),
    [panelPages, setPanelPages] = useState<Record<string, number>>({}),
    [message, setMessage] = useState(''),
    [folders, setFolders] = useState<ResearchFolder[]>([]),
    [folderId, setFolderId] = useState('');
  const control = useCallback(
    (a: WorkspaceControl) => {
      void unwrap(window.jarvis!.workspaceControl(a)).catch((e) => onError(String(e)));
    },
    [onError],
  );
  const p = workspace.playback,
    spoken = workspace.modules.find((m) => m.id === p.moduleId),
    segment = spoken?.segments[p.segment];
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const refresh = () =>
      void unwrap(window.jarvis!.researchFolders())
        .then(setFolders)
        .catch((e) => onError(String(e)));
    refresh();
    return window.jarvis!.on((e) => {
      if (e.type === 'research-library') refresh();
    });
  }, [onError]);
  const release = useCallback(
    (cancel = false) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (d.capture.hasPointerCapture(d.pointer)) d.capture.releasePointerCapture(d.pointer);
      const next = cancel ? d.layout : d.next;
      d.element.style.transform = `translate3d(${next.x * size.width}px,${next.y * size.height}px,0)`;
      void unwrap(
        window.jarvis!.workspaceGesture({
          sessionId: d.sessionId,
          moduleId: d.id,
          token: d.token,
          phase: 'RELEASE',
          ...(!cancel && d.changed ? { layout: next } : {}),
        }),
      )
        .catch((e) => onError(String(e)))
        .finally(() => setHeld(null));
    },
    [onError, size.width, size.height],
  );
  const releaseRef = useRef(release);
  releaseRef.current = release;
  useEffect(() => {
    const blur = () => releaseRef.current(true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('blur', blur);
      releaseRef.current(true);
      cancelAnimationFrame(frame.current);
      onInterrupt();
    };
  }, [onInterrupt]);
  useEffect(() => {
    if (p.state !== 'playing' || !segment) return;
    const token = {
      sessionId: workspace.id,
      moduleId: p.moduleId!,
      segment: p.segment,
      epoch: p.epoch,
    };
    let valid = true;
    onNarrate(segment.text, () => {
      if (valid)
        void unwrap(window.jarvis!.workspaceComplete(token)).catch((e) => onError(String(e)));
    });
    return () => {
      valid = false;
      onInterrupt();
    };
  }, [
    workspace.id,
    p.state,
    p.moduleId,
    p.segment,
    p.epoch,
    segment?.text,
    onNarrate,
    onInterrupt,
    onError,
  ]);
  const bounds = (l: WorkspaceModule['layout']) => ({
    width: Math.min(1, Math.max(0.12, l.width)),
    height: Math.min(1, Math.max(0.16, l.height)),
    x: Math.max(0, Math.min(l.x, 1 - Math.min(1, Math.max(0.12, l.width)))),
    y: Math.max(0, Math.min(l.y, 1 - Math.min(1, Math.max(0.16, l.height)))),
  });
  const begin = (e: React.PointerEvent, m: WorkspaceModule, mode: Gesture['mode']) => {
    if (
      e.button !== 0 ||
      drag.current ||
      (e.target as HTMLElement).closest('button,a,input,select')
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const layout = bounds(m.layout),
      element = (e.currentTarget as HTMLElement).closest('.research-module') as HTMLElement,
      token = crypto.randomUUID();
    drag.current = {
      id: m.id,
      token,
      sessionId: workspace.id,
      mode,
      phase: mode === 'resize' ? 'USER_RESIZING' : 'USER_GRABBED',
      startX: e.clientX,
      startY: e.clientY,
      layout,
      next: layout,
      snapshot: m,
      element,
      capture: e.currentTarget,
      pointer: e.pointerId,
      changed: false,
    };
    setHeld(m);
    void unwrap(
      window.jarvis!.workspaceGesture({
        sessionId: workspace.id,
        moduleId: m.id,
        token,
        phase: mode === 'resize' ? 'USER_RESIZING' : 'USER_GRABBED',
      }),
    ).catch((e) => {
      onError(String(e));
      releaseRef.current(true);
    });
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.mode === 'hold') return;
    const dx = (e.clientX - d.startX) / size.width,
      dy = (e.clientY - d.startY) / size.height;
    d.next = bounds(
      d.mode === 'move'
        ? { ...d.layout, x: d.layout.x + dx, y: d.layout.y + dy }
        : { ...d.layout, width: d.layout.width + dx, height: d.layout.height + dy },
    );
    d.changed = true;
    if (d.phase === 'USER_GRABBED') {
      d.phase = 'USER_DRAGGING';
      void unwrap(
        window.jarvis!.workspaceGesture({
          sessionId: d.sessionId,
          moduleId: d.id,
          token: d.token,
          phase: 'USER_DRAGGING',
        }),
      ).catch((e) => onError(String(e)));
    }
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const d = drag.current;
        if (!d) return;
        d.element.style.transform = `translate3d(${d.next.x * size.width}px,${d.next.y * size.height}px,0)`;
        if (d.mode === 'resize') {
          d.element.style.width = d.next.width * size.width + 'px';
          d.element.style.height = d.next.height * size.height + 'px';
        }
      });
  };
  const save = (moduleIds?: string[], groupId?: string) => {
    void unwrap(
      window.jarvis!.saveResearch({
        ...(moduleIds ? { moduleIds } : {}),
        ...(groupId ? { groupId } : {}),
        folderId: folderId || null,
      }),
    )
      .then(() => setMessage('Saved locally. Workspace trash will keep the saved copy.'))
      .catch((e) => onError(String(e)));
  };
  const briefing: Briefing = {
    id: workspace.id,
    title: workspace.topic,
    subtitle: '',
    created: workspace.created,
    modelOrganized: true,
    scenes: [],
    sources: workspace.sources,
  };
  const visible = workspace.modules.filter((m) => m.state !== 'closed');
  return (
    <section
      className={'spatial-workspace memory-wall' + ((gpuLoad || 0) > 80 ? ' load-aware' : '')}
      aria-label="Spatial research workspace"
    >
      <header className="workspace-bar">
        <div>
          <span className="eyebrow">
            {workspace.responseMode || 'FULL_WORKSPACE'} /{' '}
            {workspace.researching ? 'GATHERING SOURCES' : 'VISUAL MEMORY'}
          </span>
          <h2 title={workspace.topic}>{workspace.topic}</h2>
        </div>
        <div className="workspace-actions">
          <select
            aria-label="Save destination folder"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">Library root</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button onClick={() => save()}>SAVE ALL</button>
          <button onClick={onLibrary}>LIBRARY</button>
          <button aria-label="Hide research workspace" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <div className="spatial-stage" ref={stage}>
        <svg
          className="workspace-data-links"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-hidden="true"
        >
          {visible
            .filter((m) => m.visualRole === 'PRIMARY' || m.visualRole === 'SECONDARY')
            .slice(0, 2)
            .map((m) => (
              <path
                key={m.id}
                d={`M${size.width * 0.5} ${size.height * 0.5}L${size.width * (m.layout.x + m.layout.width * 0.5)} ${size.height * (m.layout.y + m.layout.height * 0.5)}`}
              />
            ))}
        </svg>
        {visible.map((original) => {
          const m = held?.id === original.id ? held : original,
            l = bounds(m.layout),
            locked = held?.id === m.id || m.userLocked,
            role = locked ? 'USER_LOCKED' : m.visualRole || 'CONTEXT';
          const focusId = segment?.focusObjectId || p.moduleId,
            focus = m.id === focusId && p.state === 'playing' ? segment : m.focus;
          const page = Math.min(focus?.panel ?? panelPages[m.id] ?? 0, m.panels.length - 1),
            compact = l.width * size.width < 280 || l.height * size.height < 215;
          const source = workspace.sources.find((s) => m.panels[page].sourceIds.includes(s.id)),
            image = m.panels
              .flatMap((panel) => panel.imageIds || [])
              .map((id) => ({
                id,
                title:
                  workspace.sources.flatMap((s) => s.images).find((i) => i.id === id)?.title ||
                  m.title,
              }))[0];
          return (
            <article
              key={m.id}
              className={
                'research-module floating-file role-' +
                role +
                (compact ? ' file-compact' : '') +
                (m.pinned ? ' module-pinned' : '')
              }
              data-module-id={m.id}
              data-role={role}
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${l.x * size.width}px,${l.y * size.height}px,0)`,
                width: l.width * size.width,
                height: l.height * size.height,
                zIndex: locked ? 100 : m.zIndex || 20,
              }}
              onPointerDown={(e) => begin(e, m, 'hold')}
              onPointerMove={move}
              onPointerUp={() => release()}
              onPointerCancel={() => release(true)}
              onLostPointerCapture={() => release()}
            >
              <header
                className="module-grip"
                role="button"
                tabIndex={0}
                aria-label={'Move ' + m.title}
                onPointerDown={(e) => begin(e, m, 'move')}
                onDoubleClick={() => control({ action: 'expand', moduleId: m.id })}
                onKeyDown={(e) => {
                  const delta: Record<string, number[]> = {
                    ArrowLeft: [-0.03, 0],
                    ArrowRight: [0.03, 0],
                    ArrowUp: [0, -0.03],
                    ArrowDown: [0, 0.03],
                  };
                  if (delta[e.key]) {
                    e.preventDefault();
                    control({
                      action: 'move',
                      moduleId: m.id,
                      x: Math.max(0, Math.min(1, l.x + delta[e.key][0])),
                      y: Math.max(0, Math.min(1, l.y + delta[e.key][1])),
                    });
                  }
                }}
              >
                <span className="module-index">
                  {String(workspace.modules.indexOf(original) + 1).padStart(2, '0')}
                </span>
                <h3 title={m.title}>{m.title}</h3>
                <span className="file-role">{role}</span>
              </header>
              <div className="file-tools">
                <button
                  aria-label={'Pin ' + m.title}
                  aria-pressed={m.pinned}
                  onClick={() => control({ action: 'pin', moduleId: m.id })}
                >
                  ⌖
                </button>
                <button
                  aria-label={'Save ' + m.title}
                  title="Save file"
                  onClick={() => save([m.id])}
                >
                  ▣
                </button>
                <button
                  aria-label={'Expand ' + m.title}
                  onClick={() => control({ action: 'expand', moduleId: m.id })}
                >
                  ⛶
                </button>
                <button
                  aria-label={'Park ' + m.title}
                  onClick={() => control({ action: 'park', moduleId: m.id })}
                >
                  −
                </button>
                <button
                  aria-label={'Trash ' + m.title}
                  title="Remove from workspace; keep saved copy"
                  onClick={() => control({ action: 'trash', moduleId: m.id })}
                >
                  ×
                </button>
                {m.groupId && (
                  <>
                    <button
                      aria-label={'Collapse ' + m.groupTitle}
                      onClick={() =>
                        control({
                          action: m.groupCollapsed ? 'expand_group' : 'collapse_group',
                          groupId: m.groupId!,
                        })
                      }
                    >
                      ≡
                    </button>
                    <button
                      aria-label={'Save group ' + m.groupTitle}
                      onClick={() => save(undefined, m.groupId!)}
                    >
                      G
                    </button>
                  </>
                )}
                <span>
                  {m.savedId
                    ? 'LIBRARY_SAVED'
                    : m.pinned
                      ? 'PINNED'
                      : m.userPositioned
                        ? 'USER PLACED'
                        : m.groupTitle || 'RESEARCH FILE'}
                </span>
              </div>
              <div className="module-content">
                {compact ? (
                  <div className="context-preview">
                    {image && role !== 'STACKED' ? (
                      <AttributedImage id={image.id} title={image.title} />
                    ) : null}
                    <p>
                      {m.panels[page].body ||
                        m.panels[page].items?.map((i) => i.label + ': ' + i.value).join(' · ') ||
                        m.panels[page].title}
                    </p>
                    <button
                      aria-label={'Focus ' + m.title}
                      onClick={() => control({ action: 'focus', moduleId: m.id })}
                    >
                      BRING FORWARD
                    </button>
                  </div>
                ) : (
                  <ResearchPanel
                    key={page}
                    panel={m.panels[page]}
                    briefing={briefing}
                    narrated={p.state === 'playing' && focusId === m.id}
                    highlight={focus}
                  />
                )}
              </div>
              <footer className="module-panel-tabs">
                <small title={source?.url}>
                  {source ? new URL(source.url).hostname : 'SOURCED FILE'}
                </small>
                {!compact &&
                  m.panels.map((panel, i) => (
                    <button
                      key={i}
                      title={panel.title}
                      aria-pressed={page === i}
                      onClick={() => {
                        setPanelPages((v) => ({ ...v, [m.id]: i }));
                        control({ action: 'highlight', moduleId: m.id, panel: i });
                      }}
                    >
                      {i + 1}/{panel.type.toUpperCase()}
                    </button>
                  ))}
                <span
                  className="module-resize"
                  role="button"
                  tabIndex={0}
                  aria-label={'Resize ' + m.title}
                  onPointerDown={(e) => begin(e, m, 'resize')}
                  onKeyDown={(e) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                      e.preventDefault();
                      control({
                        action: 'resize',
                        moduleId: m.id,
                        width: Math.min(
                          1,
                          Math.max(
                            0.12,
                            l.width +
                              (e.key === 'ArrowRight' ? 0.03 : e.key === 'ArrowLeft' ? -0.03 : 0),
                          ),
                        ),
                        height: Math.min(
                          1,
                          Math.max(
                            0.16,
                            l.height +
                              (e.key === 'ArrowDown' ? 0.03 : e.key === 'ArrowUp' ? -0.03 : 0),
                          ),
                        ),
                      });
                    }
                  }}
                >
                  ◢
                </span>
              </footer>
            </article>
          );
        })}
        {workspace.pendingFocus && (
          <div className="staging-indicator">USER HAS THE FILE · NEXT VISUALS STAGED</div>
        )}
      </div>
      <div className="presentation-transport">
        <span className={'playback-light state-' + p.state} />
        <b>{p.state.toUpperCase()}</b>
        <button
          disabled={!workspace.modules.length}
          onClick={() => control({ action: p.state === 'playing' ? 'pause' : 'resume' })}
        >
          {p.state === 'playing' ? 'PAUSE' : 'RESUME'}
        </button>
        <button
          disabled={workspace.modules.findIndex((m) => m.id === p.moduleId) <= 0}
          onClick={() => control({ action: 'previous' })}
        >
          PREVIOUS
        </button>
        <button
          disabled={
            workspace.modules.findIndex((m) => m.id === p.moduleId) >= workspace.modules.length - 1
          }
          onClick={() => control({ action: 'next' })}
        >
          NEXT
        </button>
        <button disabled={!workspace.modules.length} onClick={() => control({ action: 'repeat' })}>
          REPEAT
        </button>
        <button
          onClick={() => {
            control({ action: 'stop' });
            void window.jarvis?.cancelTask();
          }}
        >
          STOP
        </button>
        <span role="status">
          {message || 'Hold any file to lock it. Narration continues. Pin to keep its place.'}
        </span>
      </div>
    </section>
  );
});

export function ResearchLibraryView({
  onClose,
  onOpen,
  onDelete,
  onError,
}: {
  onClose: () => void;
  onOpen?: () => void;
  onDelete: (c: Confirmation) => void;
  onError: (s: string) => void;
}) {
  const [entries, setEntries] = useState<ResearchEntry[]>([]),
    [folders, setFolders] = useState<ResearchFolder[]>([]),
    [folder, setFolder] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [folderName, setFolderName] = useState(''),
    [rename, setRename] = useState<ResearchEntry | null>(null),
    [topic, setTopic] = useState('');
  const refresh = useCallback(() => {
    void Promise.all([
      unwrap(window.jarvis!.researchLibrary()),
      unwrap(window.jarvis!.researchFolders()),
    ])
      .then(([e, f]) => {
        setEntries(e);
        setFolders(f);
      })
      .catch((e) => onError(String(e)));
  }, [onError]);
  useEffect(() => {
    refresh();
    return window.jarvis!.on((e) => {
      if (e.type === 'research-library') refresh();
    });
  }, [refresh]);
  const filtered = entries.filter(
      (e) =>
        e.topic.toLowerCase().includes(query.toLowerCase()) && (!folder || e.folderId === folder),
    ),
    pages = Math.max(1, Math.ceil(filtered.length / 4)),
    selected = Math.min(page, pages - 1);
  return (
    <section className="research-library" aria-label="Local research library">
      <header>
        <div>
          <span className="eyebrow">LOCAL FILES / GROUPS / WORKSPACES</span>
          <h2>JARVIS LIBRARY</h2>
        </div>
        <button aria-label="Close library" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="library-folder-controls">
        <select
          aria-label="Library folder"
          value={folder}
          onChange={(e) => {
            setFolder(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button
          disabled={!folder}
          onClick={() =>
            void unwrap(window.jarvis!.openResearchFolder(folder))
              .then(() => {
                onOpen?.();
                onClose();
              })
              .catch((e) => onError(String(e)))
          }
        >
          OPEN AS FLOATING FILES
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void unwrap(window.jarvis!.createResearchFolder(folderName, folder || undefined))
              .then(() => {
                setFolderName('');
                refresh();
              })
              .catch((e) => onError(String(e)));
          }}
        >
          <input
            aria-label="New folder name"
            value={folderName}
            maxLength={90}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="New folder"
          />
          <button disabled={!folderName.trim()}>CREATE</button>
        </form>
      </div>
      <input
        aria-label="Search saved research"
        placeholder="Search files, groups and workspaces"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      {rename ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void unwrap(window.jarvis!.renameResearch(rename.id, topic))
              .then(() => {
                setRename(null);
                refresh();
              })
              .catch((e) => onError(String(e)));
          }}
        >
          <h3>Rename saved file</h3>
          <input
            aria-label="Saved research title"
            value={topic}
            maxLength={120}
            onChange={(e) => setTopic(e.target.value)}
          />
          <button>SAVE NAME</button>
          <button type="button" onClick={() => setRename(null)}>
            CANCEL
          </button>
        </form>
      ) : (
        <div className="library-entries">
          {filtered.slice(selected * 4, selected * 4 + 4).map((e) => (
            <article key={e.id}>
              <span className="eyebrow">
                {e.kind?.toUpperCase() || 'WORKSPACE'} / {e.moduleCount} FILES /{' '}
                {e.folderId ? folders.find((f) => f.id === e.folderId)?.name : 'ROOT'}
              </span>
              <h3>{e.topic}</h3>
              <div>
                <button
                  onClick={() =>
                    void unwrap(window.jarvis!.openResearch(e.id))
                      .then(() => {
                        onOpen?.();
                        onClose();
                      })
                      .catch((err) => onError(String(err)))
                  }
                >
                  OPEN FLOATING FILES
                </button>
                <button
                  onClick={() => {
                    setRename(e);
                    setTopic(e.topic);
                  }}
                >
                  RENAME
                </button>
                <select
                  aria-label={'Move ' + e.topic + ' to folder'}
                  value={e.folderId || ''}
                  onChange={(ev) =>
                    void unwrap(window.jarvis!.moveResearch(e.id, ev.target.value || null))
                      .then(refresh)
                      .catch((err) => onError(String(err)))
                  }
                >
                  <option value="">Root</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    void unwrap(window.jarvis!.requestResearchDelete(e.id))
                      .then(onDelete)
                      .catch((err) => onError(String(err)))
                  }
                >
                  DELETE…
                </button>
              </div>
            </article>
          ))}
          {!filtered.length && <p>Save a file or group from the workspace to keep it here.</p>}
        </div>
      )}
      <footer>
        <button disabled={!selected} onClick={() => setPage((p) => p - 1)}>
          ←
        </button>
        <span>
          {selected + 1}/{pages}
        </span>
        <button disabled={selected === pages - 1} onClick={() => setPage((p) => p + 1)}>
          →
        </button>
        <button onClick={refresh}>REFRESH</button>
      </footer>
    </section>
  );
}
