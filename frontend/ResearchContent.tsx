import { memo, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Briefing, BriefingPanel, WorkspaceFocus, unwrap } from './types';
import { MeasuredText } from './MeasuredText';
const ModelPreview = lazy(() =>
  import('./ModelPreview').then((m) => ({ default: m.ModelPreview })),
);
export const AttributedImage = memo(function AttributedImage({
  id,
  title,
  focused,
}: {
  id: string;
  title: string;
  focused?: boolean;
}) {
  const [url, setUrl] = useState(''),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl('');
    setFailed(false);
  }, [id]);
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
    <figure className={'source-image holographic-image' + (focused ? ' focus-target' : '')}>
      <div className="hologram-depth" aria-hidden="true" />
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
function Chart({ panel, highlight }: { panel: BriefingPanel; highlight?: WorkspaceFocus }) {
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
              className={'chart-bar' + (highlight?.datum === i ? ' focus-target' : '')}
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
              <circle
                key={i}
                cx={x}
                cy={y}
                r={highlight?.datum === i ? '6' : '3'}
                className={highlight?.datum === i ? 'focus-target' : ''}
              >
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
export function ResearchPanel({
  panel,
  briefing,
  narrated,
  highlight,
}: {
  panel: BriefingPanel;
  briefing: Briefing;
  narrated: boolean;
  highlight?: WorkspaceFocus;
}) {
  const root = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([e]) =>
      setCompact(e.contentRect.height < 420 || e.contentRect.width < 450),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const [textView, setTextView] = useState(false);
  const rich = !!(
    panel.items?.length ||
    panel.data?.length ||
    panel.imageIds?.length ||
    panel.type === 'sources'
  );
  useEffect(() => {
    if (highlight?.item !== undefined || highlight?.datum !== undefined || highlight?.imageId)
      setTextView(false);
  }, [highlight?.item, highlight?.datum, highlight?.imageId]);
  const [itemPage, setItemPage] = useState(0);
  const itemSize = panel.type === 'timeline' || compact ? 1 : 2;
  useEffect(() => {
    if (highlight?.item !== undefined) setItemPage(Math.floor(highlight.item / itemSize));
  }, [highlight?.item, itemSize]);
  const itemCount = Math.ceil((panel.items?.length || 0) / itemSize);
  const sources = briefing.sources.filter((s) => panel.sourceIds.includes(s.id));
  const value = panel.data?.[0]?.value;
  return (
    <article
      ref={root}
      className={
        'briefing-panel' +
        (!rich || textView ? ' text-focused-panel' : '') +
        (compact ? ' compact-panel' : '') +
        ' panel-' +
        panel.type +
        (narrated ? ' is-narrated' : '')
      }
    >
      <header>
        <span>{panel.type.toUpperCase()}</span>
        <h3>{panel.title}</h3>
      </header>
      {panel.type === 'model3d' && panel.assetId && (
        <Suspense fallback={<p>LOADING 3D VIEW</p>}>
          <ModelPreview assetId={panel.assetId} />
        </Suspense>
      )}
      {compact && rich && panel.body && (
        <button className="panel-summary-toggle" onClick={() => setTextView((v) => !v)}>
          {textView ? 'SHOW VISUAL CONTENT' : 'READ SUMMARY'}
        </button>
      )}
      {panel.body && (!compact || !rich || textView) && (
        <MeasuredText key={panel.title} text={panel.body} />
      )}
      {(!compact || !textView) && (
        <>
          {['line', 'area', 'bar'].includes(panel.type) && (
            <Chart panel={panel} highlight={highlight} />
          )}
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
              {panel.items
                .slice(itemPage * itemSize, itemPage * itemSize + itemSize)
                .map((item, i) => (
                  <div
                    key={i}
                    className={highlight?.item === itemPage * itemSize + i ? 'focus-target' : ''}
                    style={{ animationDelay: i * 100 + 'ms' }}
                  >
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
                  focused={highlight?.imageId === id}
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
        </>
      )}
      {panel.type === 'video' && sources[0] && (
        <button onClick={() => void window.jarvis?.openResearchSource(sources[0].id)}>
          OPEN VIDEO ↗
        </button>
      )}
      <footer>
        {sources.map((s) => (
          <button
            key={s.id}
            disabled={s.url.startsWith('jarvis-artifact:')}
            title={s.url}
            onClick={() => void window.jarvis?.openResearchSource(s.id)}
          >
            {s.url.startsWith('jarvis-artifact:')
              ? 'LOCAL BLENDER PROJECT'
              : new URL(s.url).hostname + ' ↗'}
          </button>
        ))}
      </footer>
    </article>
  );
}
