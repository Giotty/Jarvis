import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ResearchPanel } from './ResearchContent';
import {
  Briefing,
  Workspace,
  WorkspaceModule,
  WorkspaceControl,
  ResearchEntry,
  Confirmation,
  unwrap,
} from './types';

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
    drag = useRef<{
      id: string;
      mode: 'move' | 'resize';
      startX: number;
      startY: number;
      layout: WorkspaceModule['layout'];
      next: WorkspaceModule['layout'];
    } | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 400 }),
    [preview, setPreview] = useState<{ id: string; layout: WorkspaceModule['layout'] } | null>(
      null,
    ),
    [dockPage, setDockPage] = useState(0),
    [panelPages, setPanelPages] = useState<Record<string, number>>({}),
    [message, setMessage] = useState('');
  const control = useCallback(
    (input: WorkspaceControl) => {
      void unwrap(window.jarvis!.workspaceControl(input)).catch((e) => onError(String(e)));
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
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      onInterrupt();
    },
    [onInterrupt],
  );
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
    // Appending new modules must not restart the currently playing segment.
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
  const bounds = (layout: WorkspaceModule['layout']) => {
    const width = Math.min(1, Math.max(layout.width, Math.min(1, 320 / size.width))),
      height = Math.min(1, Math.max(layout.height, Math.min(1, 310 / size.height)));
    return {
      width,
      height,
      x: Math.max(0, Math.min(layout.x, 1 - width)),
      y: Math.max(0, Math.min(layout.y, 1 - height)),
    };
  };
  const begin = (e: React.PointerEvent, m: WorkspaceModule, mode: 'move' | 'resize') => {
    if (e.button !== 0 || (mode === 'move' && (e.target as HTMLElement).closest('button'))) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    control({ action: 'pause' });
    const layout = bounds(m.layout);
    drag.current = { id: m.id, mode, startX: e.clientX, startY: e.clientY, layout, next: layout };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / size.width,
      dy = (e.clientY - d.startY) / size.height;
    d.next = bounds(
      d.mode === 'move'
        ? { ...d.layout, x: d.layout.x + dx, y: d.layout.y + dy }
        : { ...d.layout, width: d.layout.width + dx, height: d.layout.height + dy },
    );
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const d = drag.current;
        if (d) setPreview({ id: d.id, layout: d.next });
      });
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setPreview(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    control({
      action: d.mode,
      moduleId: d.id,
      ...(d.mode === 'move'
        ? { x: d.next.x, y: d.next.y }
        : { width: d.next.width, height: d.next.height }),
    });
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
  const active = workspace.modules.filter((m) => m.state === 'active').slice(-2),
    dock = workspace.modules.filter((m) => m.state !== 'active');
  const slots = size.width < 1500 ? 5 : 7,
    totalPages = Math.max(1, Math.ceil(dock.length / slots));
  const selectedPage = Math.min(dockPage, totalPages - 1);
  const companion =
    active.length === 1
      ? active[0].panels.find((panel) => panel.type === 'images' && panel.imageIds?.length)
      : null;
  return (
    <section
      className={'spatial-workspace' + ((gpuLoad || 0) > 80 ? ' load-aware' : '')}
      aria-label="Spatial research workspace"
    >
      <header className="workspace-bar">
        <div>
          <span className="eyebrow">
            SPATIAL RESEARCH / {workspace.researching ? 'GATHERING SOURCES' : 'LOCAL WORKSPACE'}
          </span>
          <h2 title={workspace.topic}>{workspace.topic}</h2>
        </div>
        <div className="workspace-actions">
          <button
            onClick={() =>
              void unwrap(window.jarvis!.saveResearch())
                .then(() => setMessage('Briefing saved locally.'))
                .catch((e) => onError(String(e)))
            }
          >
            SAVE BRIEFING
          </button>
          <button onClick={onLibrary}>LIBRARY</button>
          <button
            aria-label="Hide research workspace"
            onClick={() => {
              control({ action: 'pause' });
              onClose();
            }}
          >
            ×
          </button>
        </div>
      </header>
      <div className="spatial-stage" ref={stage}>
        <svg
          className="workspace-data-links"
          viewBox="0 0 1000 400"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M500 200C410 150 380 80 280 80M500 200C590 140 650 300 760 300" />
        </svg>
        {!active.length && (
          <div className="workspace-complete">
            <b>{p.state === 'waiting' ? 'RESEARCH CONTINUES' : 'BRIEFING STAGED'}</b>
            <p>
              {p.state === 'waiting'
                ? 'The next module will arrive when its sources are ready.'
                : 'Everything remains in the dock. Reopen a section, compare modules or save the session.'}
            </p>
          </div>
        )}
        {active.map((m) => {
          const l = bounds(preview?.id === m.id ? preview.layout : m.layout),
            focus = m.id === p.moduleId && p.state === 'playing' ? segment : m.focus;
          const page = Math.min(focus?.panel ?? panelPages[m.id] ?? 0, m.panels.length - 1);
          return (
            <article
              className={
                'research-module' +
                (p.moduleId === m.id ? ' module-dominant' : '') +
                (m.pinned ? ' module-pinned' : '')
              }
              data-module-id={m.id}
              key={m.id}
              style={{
                left: l.x * 100 + '%',
                top: l.y * 100 + '%',
                width: l.width * 100 + '%',
                height: l.height * 100 + '%',
              }}
            >
              <header
                className="module-grip"
                tabIndex={0}
                role="button"
                aria-label={'Move ' + m.title}
                onPointerDown={(e) => begin(e, m, 'move')}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onDoubleClick={() => control({ action: 'expand', moduleId: m.id })}
                onKeyDown={(e) => {
                  const delta = {
                    ArrowLeft: [-0.03, 0],
                    ArrowRight: [0.03, 0],
                    ArrowUp: [0, -0.03],
                    ArrowDown: [0, 0.03],
                  }[e.key];
                  if (delta) {
                    e.preventDefault();
                    control({
                      action: 'move',
                      moduleId: m.id,
                      x: Math.max(0, Math.min(1, l.x + delta[0])),
                      y: Math.max(0, Math.min(1, l.y + delta[1])),
                    });
                  }
                }}
              >
                <span className="module-index">
                  {String(workspace.modules.indexOf(m) + 1).padStart(2, '0')}
                </span>
                <h3 title={m.title}>{m.title}</h3>
                <div>
                  <button
                    aria-label={'Pin ' + m.title}
                    aria-pressed={m.pinned}
                    onClick={() => control({ action: 'pin', moduleId: m.id })}
                  >
                    ⌖
                  </button>
                  <button
                    aria-label={'Expand ' + m.title}
                    onClick={() => control({ action: 'expand', moduleId: m.id })}
                  >
                    ⛶
                  </button>
                  <button
                    aria-label={'Minimize ' + m.title}
                    onClick={() => control({ action: 'minimize', moduleId: m.id })}
                  >
                    −
                  </button>
                  <button
                    aria-label={'Close ' + m.title}
                    onClick={() => control({ action: 'close', moduleId: m.id })}
                  >
                    ×
                  </button>
                </div>
              </header>
              <div className="module-content">
                <ResearchPanel
                  key={page}
                  panel={m.panels[page]}
                  briefing={briefing}
                  narrated={p.state === 'playing' && p.moduleId === m.id}
                  highlight={focus}
                />
              </div>
              <footer className="module-panel-tabs">
                {m.panels.map((panel, i) => (
                  <button
                    key={i}
                    title={panel.title}
                    aria-label={m.title + ': ' + panel.title}
                    aria-pressed={page === i}
                    onClick={() => {
                      control({ action: 'pause' });
                      setPanelPages((v) => ({ ...v, [m.id]: i }));
                      control({ action: 'highlight', moduleId: m.id, panel: i });
                    }}
                  >
                    {i + 1} / {panel.type.toUpperCase()}
                  </button>
                ))}
                <span
                  className="module-resize"
                  role="button"
                  tabIndex={0}
                  aria-label={'Resize ' + m.title}
                  onPointerDown={(e) => begin(e, m, 'resize')}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={(e) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                      e.preventDefault();
                      control({
                        action: 'resize',
                        moduleId: m.id,
                        width: Math.min(
                          1,
                          Math.max(
                            0.25,
                            l.width +
                              (e.key === 'ArrowRight' ? 0.03 : e.key === 'ArrowLeft' ? -0.03 : 0),
                          ),
                        ),
                        height: Math.min(
                          1,
                          Math.max(
                            0.5,
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
        {companion && (
          <aside
            className={'subject-projection' + (active[0].layout.x > 0.3 ? ' projection-left' : '')}
          >
            <span className="eyebrow">ATTRIBUTED SUBJECT / HOLOGRAPHIC PLANE</span>
            <ResearchPanel
              panel={companion}
              briefing={briefing}
              narrated={segment?.imageId !== undefined}
            />
          </aside>
        )}
      </div>
      <div className="presentation-transport">
        <span className={'playback-light state-' + p.state} />
        <b>{p.state.toUpperCase()}</b>
        <button onClick={() => control({ action: p.state === 'playing' ? 'pause' : 'resume' })}>
          {p.state === 'playing' ? 'PAUSE' : 'RESUME'}
        </button>
        <button onClick={() => control({ action: 'previous' })}>PREVIOUS</button>
        <button onClick={() => control({ action: 'next' })}>NEXT</button>
        <button onClick={() => control({ action: 'repeat' })}>REPEAT SECTION</button>
        <button
          onClick={() => {
            control({ action: 'stop' });
            void window.jarvis?.cancelTask();
          }}
        >
          STOP
        </button>
        <span role="status">
          {message || 'Narration controls focus automatically. Drag a header to rearrange.'}
        </span>
      </div>
      <div className="completed-dock">
        <div className="dock-label">
          <span>BRIEFING ARCHIVE</span>
          <b>{dock.length} MODULES</b>
        </div>
        <button
          aria-label="Previous dock modules"
          disabled={!selectedPage}
          onClick={() => setDockPage((p) => p - 1)}
        >
          ←
        </button>
        <div className="dock-thumbnails">
          {dock.slice(selectedPage * slots, (selectedPage + 1) * slots).map((m) => (
            <div className={'docked-module ' + m.state} key={m.id}>
              <button
                title={m.title}
                aria-label={'Reopen ' + m.title}
                onClick={() => control({ action: 'focus', moduleId: m.id })}
              >
                <span>{m.completed ? 'ARCHIVED' : m.state === 'closed' ? 'CLOSED' : 'READY'}</span>
                <b>{m.title}</b>
                <i className="thumbnail-trace" />
              </button>
              <button
                aria-label={'Compare ' + m.title}
                disabled={!active.length || active[0].id === m.id}
                onClick={() =>
                  control({ action: 'compare', moduleId: active[0].id, otherModuleId: m.id })
                }
              >
                ⇄
              </button>
            </div>
          ))}
        </div>
        <button
          aria-label="Next dock modules"
          disabled={selectedPage === totalPages - 1}
          onClick={() => setDockPage((p) => p + 1)}
        >
          →
        </button>
      </div>
    </section>
  );
});

export function ResearchLibraryView({
  onClose,
  onDelete,
  onError,
}: {
  onClose: () => void;
  onDelete: (c: Confirmation) => void;
  onError: (s: string) => void;
}) {
  const [entries, setEntries] = useState<ResearchEntry[]>([]),
    [page, setPage] = useState(0),
    [query, setQuery] = useState(''),
    [rename, setRename] = useState<ResearchEntry | null>(null),
    [topic, setTopic] = useState('');
  const refresh = useCallback(() => {
    void unwrap(window.jarvis!.researchLibrary())
      .then(setEntries)
      .catch((e) => onError(String(e)));
  }, [onError]);
  useEffect(() => {
    refresh();
    return window.jarvis?.on((e) => {
      if (e.type === 'research-library') refresh();
    });
  }, [refresh]);
  const filtered = entries.filter((e) => e.topic.toLowerCase().includes(query.toLowerCase())),
    pages = Math.max(1, Math.ceil(filtered.length / 3)),
    selected = Math.min(page, pages - 1);
  return (
    <section className="research-library" aria-label="Saved research library">
      <header>
        <div>
          <span className="eyebrow">MAATOUK / LOCAL RESEARCH</span>
          <h2>Research library</h2>
        </div>
        <button aria-label="Close research library" onClick={onClose}>
          ×
        </button>
      </header>
      <input
        aria-label="Find saved research"
        placeholder="Find a topic…"
        value={query}
        maxLength={120}
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
          <h3>Rename saved briefing</h3>
          <input
            aria-label="New briefing name"
            maxLength={120}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <button disabled={!topic.trim()}>SAVE NAME</button>
          <button type="button" onClick={() => setRename(null)}>
            CANCEL
          </button>
        </form>
      ) : (
        <div className="library-entries">
          {filtered.slice(selected * 3, selected * 3 + 3).map((e) => (
            <article key={e.id}>
              <span>
                {new Date(e.created).toLocaleDateString()} / {e.moduleCount} MODULES
              </span>
              <h3>{e.topic}</h3>
              <small>
                {e.lastOpened
                  ? 'Last opened ' + new Date(e.lastOpened).toLocaleString()
                  : 'Not reopened yet'}
              </small>
              <div>
                <button
                  onClick={() =>
                    void unwrap(window.jarvis!.openResearch(e.id))
                      .then(onClose)
                      .catch((err) => onError(String(err)))
                  }
                >
                  OPEN WORKSPACE
                </button>
                <button
                  onClick={() => {
                    setRename(e);
                    setTopic(e.topic);
                  }}
                >
                  RENAME
                </button>
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
          {!filtered.length && <p>Save a briefing to keep its modules, sources and layout here.</p>}
        </div>
      )}
      <footer>
        <button disabled={!selected} onClick={() => setPage((p) => p - 1)}>
          ←
        </button>
        <span>
          {selected + 1} / {pages}
        </span>
        <button disabled={selected === pages - 1} onClick={() => setPage((p) => p + 1)}>
          →
        </button>
        <button onClick={refresh}>REFRESH</button>
      </footer>
    </section>
  );
}
