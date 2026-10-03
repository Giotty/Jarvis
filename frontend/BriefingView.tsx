import { memo, useEffect, useRef, useState } from 'react';
import { Briefing, BriefingPanel, unwrap } from './types';
const AttributedImage = memo(function AttributedImage({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const [url, setUrl] = useState(''),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (window.jarvis)
      void unwrap(window.jarvis.researchImage(id))
        .then((r) => {
          if (active) setUrl(r.dataUrl);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <figure className="source-image">
      {url && !failed ? (
        <img
          src={url}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="image-unavailable">
          {failed ? 'IMAGE UNAVAILABLE' : 'RETRIEVING SOURCE IMAGE'}
        </div>
      )}
      <figcaption>{title}</figcaption>
    </figure>
  );
});
function Chart({ panel }: { panel: BriefingPanel }) {
  const data = panel.data || [],
    min = Math.min(0, ...data.map((d) => d.value)),
    max = Math.max(1, ...data.map((d) => d.value)),
    range = max - min;
  const y = (v: number) => 126 - ((v - min) / range) * 106;
  const points = data.map((d, i) => [28 + (i * 300) / Math.max(1, data.length - 1), y(d.value)]);
  const path = points.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(' ');
  return (
    <div className="chart">
      <svg viewBox="0 0 356 165" aria-label={panel.title} role="img">
        <path className="chart-grid" d="M28 20H330M28 73H330M28 126H330" />
        <text x="2" y="22">
          {max.toLocaleString('en', { notation: 'compact' })}
        </text>
        <text x="2" y="126">
          {min.toLocaleString('en', { notation: 'compact' })}
        </text>
        {panel.type === 'bar' ? (
          data.map((d, i) => (
            <rect
              className="chart-bar"
              key={i}
              x={28 + (i * 300) / data.length}
              y={Math.min(y(d.value), y(0))}
              width={Math.max(4, 300 / data.length - 8)}
              height={Math.max(1, Math.abs(y(d.value) - y(0)))}
              style={{ animationDelay: i * 70 + 'ms' }}
            >
              <title>{d.label + ': ' + d.value.toLocaleString() + ' ' + (panel.unit || '')}</title>
            </rect>
          ))
        ) : (
          <>
            {panel.type === 'area' && <path className="chart-area" d={path + 'L328 126L28 126Z'} />}
            <path className="chart-line" d={path} pathLength="1" />
            {points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="3">
                <title>{data[i].label + ': ' + data[i].value}</title>
              </circle>
            ))}
          </>
        )}
        <text x="28" y="151">
          {data[0]?.label.slice(0, 22)}
        </text>
        <text x="328" y="151" textAnchor="end">
          {data.at(-1)?.label.slice(0, 22)}
        </text>
      </svg>
      <span className="chart-unit">{panel.unit || 'SOURCE VALUES'}</span>
      <div className="chart-legend">
        {data.slice(0, 4).map((d, i) => (
          <span key={i}>
            {d.label.slice(0, 38)} <b>{d.value.toLocaleString()}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
function Panel({
  panel,
  briefing,
  narrated,
}: {
  panel: BriefingPanel;
  briefing: Briefing;
  narrated: boolean;
}) {
  const [bodyPage, setBodyPage] = useState(0),
    [itemPage, setItemPage] = useState(0);
  const itemSize = panel.type === 'timeline' ? 1 : 2;
  const itemCount = Math.ceil((panel.items?.length || 0) / itemSize);
  const bodyParts = panel.body?.match(/[\s\S]{1,240}/g) || [];
  const sources = briefing.sources.filter((s) => panel.sourceIds.includes(s.id));
  const value = panel.data?.[0]?.value;
  return (
    <article className={'briefing-panel panel-' + panel.type + (narrated ? ' is-narrated' : '')}>
      <header>
        <span>{panel.type.toUpperCase()}</span>
        <h3>{panel.title}</h3>
      </header>
      {panel.body && <p className="briefing-body">{bodyParts[bodyPage]}</p>}
      {bodyParts.length > 1 && (
        <div className="panel-pagination">
          <button
            disabled={!bodyPage}
            aria-label="Previous text segment"
            onClick={() => setBodyPage((p) => p - 1)}
          >
            ←
          </button>
          <span>
            TEXT {bodyPage + 1}/{bodyParts.length}
          </span>
          <button
            disabled={bodyPage === bodyParts.length - 1}
            aria-label="Next text segment"
            onClick={() => setBodyPage((p) => p + 1)}
          >
            →
          </button>
        </div>
      )}
      {['line', 'area', 'bar'].includes(panel.type) && <Chart panel={panel} />}
      {panel.type === 'radial' && (
        <div className="radial-metric">
          <svg viewBox="0 0 120 120">
            <circle className="meter-track" cx="60" cy="60" r="50" />
            <circle
              className="meter-value"
              cx="60"
              cy="60"
              r="50"
              pathLength="100"
              strokeDasharray={
                (panel.unit === '%' ? Math.max(0, Math.min(100, value ?? 0)) : 0) + ' 100'
              }
            />
          </svg>
          <b>
            {value?.toLocaleString() ?? '—'}
            <small>{panel.unit}</small>
          </b>
        </div>
      )}
      {!!panel.items?.length && (
        <div className={'briefing-items ' + (panel.type === 'timeline' ? 'is-timeline' : '')}>
          {panel.items.slice(itemPage * itemSize, itemPage * itemSize + itemSize).map((item, i) => (
            <div key={i} style={{ animationDelay: i * 100 + 'ms' }}>
              <small>{item.label}</small>
              <b className={item.value.length > 25 ? 'long-value' : ''}>{item.value}</b>
              {item.detail && <p>{item.detail}</p>}
            </div>
          ))}
        </div>
      )}
      {itemCount > 1 && (
        <div className="panel-pagination">
          <button
            disabled={!itemPage}
            aria-label="Previous panel items"
            onClick={() => setItemPage((p) => p - 1)}
          >
            ←
          </button>
          <span>
            ITEMS {itemPage + 1}/{itemCount}
          </span>
          <button
            disabled={itemPage === itemCount - 1}
            aria-label="Next panel items"
            onClick={() => setItemPage((p) => p + 1)}
          >
            →
          </button>
        </div>
      )}
      {!!panel.imageIds?.length && (
        <div className="image-gallery">
          {panel.imageIds.map((id) => (
            <AttributedImage
              key={id}
              id={id}
              title={
                sources.flatMap((s) => s.images).find((i) => i.id === id)?.title || panel.title
              }
            />
          ))}
        </div>
      )}
      {panel.type === 'sources' && (
        <div className="source-cards">
          {sources.map((s) => (
            <button key={s.id} onClick={() => void window.jarvis?.openResearchSource(s.id)}>
              <span>{new URL(s.url).hostname}</span>
              <b>{s.title}</b>
              <small>
                {s.publishedAt
                  ? new Date(s.publishedAt).toLocaleDateString()
                  : 'Retrieved public source'}{' '}
                · {s.readable ? 'READ' : 'SNIPPET'}
              </small>
              <em>USED IN THIS BRIEFING ↗</em>
            </button>
          ))}
        </div>
      )}
      <footer>
        {sources.map((s) => (
          <button
            key={s.id}
            title={s.url}
            onClick={() => void window.jarvis?.openResearchSource(s.id)}
          >
            {new URL(s.url).hostname} ↗
          </button>
        ))}
      </footer>
    </article>
  );
}
export function BriefingView({
  briefing,
  onNarrate,
  onInterrupt,
  onClose,
  interrupted,
  autoStart,
}: {
  briefing: Briefing;
  onNarrate: (text: string, done: () => void) => void;
  onInterrupt: () => void;
  onClose: () => void;
  interrupted: boolean;
  autoStart: number;
}) {
  const [scene, setScene] = useState(0),
    [playing, setPlaying] = useState(false),
    [segment, setSegment] = useState(0),
    [panelPage, setPanelPage] = useState(0),
    [generation, setGeneration] = useState(0);
  const current = useRef({ scene, playing, generation });
  current.current = { scene, playing, generation };
  useEffect(() => {
    setScene(0);
    setPanelPage(0);
    setSegment(0);
    setPlaying(false);
    setGeneration((g) => g + 1);
  }, [briefing.id]);
  useEffect(() => {
    if (autoStart > 0) setPlaying(true);
  }, [autoStart]);
  useEffect(() => {
    if (interrupted) setPlaying(false);
  }, [interrupted]);
  useEffect(() => {
    if (!playing) return;
    const selected = briefing.scenes[scene];
    const narratedPanels = selected.panels.filter((p) => p.narration);
    setPanelPage(
      Math.floor(selected.panels.indexOf(narratedPanels[segment] || selected.panels[0]) / 2),
    );
    let active = true;
    onNarrate(
      narratedPanels[segment]?.narration ||
        selected.narration ||
        selected.panels.map((p) => p.body || p.title).join('. '),
      () => {
        if (!active || !current.current.playing) return;
        if (segment + 1 < narratedPanels.length) setSegment(segment + 1);
        else if (scene + 1 < briefing.scenes.length) {
          setSegment(0);
          setScene(scene + 1);
          setPanelPage(0);
        } else setPlaying(false);
      },
    );
    return () => {
      active = false;
    };
  }, [scene, segment, playing, generation, briefing, onNarrate]);
  const change = (index: number) => {
    onInterrupt();
    setScene(index);
    setPanelPage(0);
    setSegment(0);
    setGeneration((g) => g + 1);
  };
  const selected = briefing.scenes[Math.min(scene, briefing.scenes.length - 1)];
  return (
    <section className="briefing-workspace" aria-label="Visual research briefing">
      <header className="briefing-heading">
        <div>
          <span className="eyebrow">
            RESEARCH / {briefing.modelOrganized ? 'AI ORGANIZED' : 'SOURCE OBSERVATIONS'}
          </span>
          <h2 title={briefing.title}>{briefing.title}</h2>
          <p>{briefing.subtitle}</p>
        </div>
        <button
          aria-label="Close briefing"
          onClick={() => {
            onInterrupt();
            onClose();
          }}
        >
          ×
        </button>
      </header>
      <div className="scene-heading">
        <small>
          SCENE {scene + 1} / {briefing.scenes.length}
        </small>
        <h3>{selected.title}</h3>
        {selected.panels.length > 2 && (
          <div className="panel-pagination">
            <button
              disabled={!panelPage}
              aria-label="Previous panel pair"
              onClick={() => {
                onInterrupt();
                setPlaying(false);
                setPanelPage((p) => p - 1);
              }}
            >
              ←
            </button>
            <span>
              PANELS {panelPage * 2 + 1}–{Math.min(selected.panels.length, panelPage * 2 + 2)} /{' '}
              {selected.panels.length}
            </span>
            <button
              disabled={panelPage === Math.ceil(selected.panels.length / 2) - 1}
              aria-label="Next panel pair"
              onClick={() => {
                onInterrupt();
                setPlaying(false);
                setPanelPage((p) => p + 1);
              }}
            >
              →
            </button>
          </div>
        )}
      </div>
      <div
        className={'scene-panels count-' + Math.min(2, selected.panels.length - panelPage * 2)}
        key={briefing.id + '-' + scene}
      >
        {selected.panels.slice(panelPage * 2, panelPage * 2 + 2).map((p, i) => (
          <Panel
            key={panelPage * 2 + i}
            panel={p}
            briefing={briefing}
            narrated={
              playing &&
              (selected.panels.filter((p) => p.narration)[segment] === p ||
                (!selected.panels.some((p) => p.narration) && i === 0))
            }
          />
        ))}
      </div>
      <footer className="scene-controls">
        <button disabled={!scene} onClick={() => change(scene - 1)}>
          ← PREVIOUS
        </button>
        <div className="scene-dots">
          {briefing.scenes.map((s, i) => (
            <button
              key={i}
              aria-label={'Scene ' + (i + 1) + ': ' + s.title}
              aria-current={i === scene ? 'step' : undefined}
              onClick={() => change(i)}
            >
              {String(i + 1).padStart(2, '0')}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            if (playing) onInterrupt();
            setPlaying((p) => !p);
          }}
        >
          {' '}
          {playing ? 'Ⅱ PAUSE' : '▷ NARRATE'}
        </button>
        <button
          onClick={() => {
            onInterrupt();
            setPlaying(false);
            setScene(0);
            setPanelPage(0);
            setSegment(0);
          }}
        >
          ■ STOP
        </button>
        <button disabled={scene === briefing.scenes.length - 1} onClick={() => change(scene + 1)}>
          NEXT →
        </button>
      </footer>
    </section>
  );
}
