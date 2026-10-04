import { useEffect, useRef, useState } from 'react';
type Page = { start: number; end: number };
export function paginateText(text: string, fits: (text: string) => boolean): Page[] {
  const ends = [...text.matchAll(/\S+(?:\s+|$)/gu)].map((m) => m.index! + m[0].length);
  if (!ends.length) return [{ start: 0, end: text.length }];
  const paragraphs = [...text.matchAll(/\n\s*\n/gu)].map((m) => m.index! + m[0].length);
  const sentences = [
    ...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
  ].map((s) => s.index + s.segment.length);
  const pages: Page[] = [];
  let start = 0,
    first = 0;
  while (first < ends.length) {
    let low = first,
      high = ends.length - 1,
      best = first - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (fits(text.slice(start, ends[middle]))) {
        best = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    let end = ends[Math.max(first, best)];
    if (end < text.length) {
      for (const boundaries of [paragraphs, sentences]) {
        const natural = boundaries
          .filter((n) => n > start && n <= end && n - start >= (end - start) * 0.65)
          .at(-1);
        if (natural && ends.includes(natural)) {
          end = natural;
          break;
        }
      }
    }
    pages.push({ start, end });
    start = end;
    while (first < ends.length && ends[first] <= end) first++;
  }
  return pages;
}
export function MeasuredText({ text }: { text: string }) {
  const viewport = useRef<HTMLDivElement>(null),
    measure = useRef<HTMLParagraphElement>(null),
    anchor = useRef(0);
  const [layout, setLayout] = useState<{ pages: Page[]; index: number }>({
    pages: [{ start: 0, end: text.length }],
    index: 0,
  });
  useEffect(() => {
    const view = viewport.current,
      probe = measure.current;
    if (!view || !probe) return;
    let timer: ReturnType<typeof setTimeout>,
      stopped = false;
    const reflow = () => {
      if (stopped || view.clientWidth < 1 || view.clientHeight < 1) return;
      const pages = paginateText(text, (part) => {
        probe.textContent = part;
        return probe.getBoundingClientRect().height <= view.clientHeight + 0.5;
      });
      const index = Math.max(
        0,
        pages.findIndex((p) => p.start <= anchor.current && p.end > anchor.current),
      );
      setLayout({ pages, index });
    };
    const queue = () => {
      clearTimeout(timer);
      timer = setTimeout(reflow, 80);
    };
    const observer = new ResizeObserver(queue);
    observer.observe(view);
    document.fonts.addEventListener('loadingdone', queue);
    void document.fonts.ready.then(queue);
    queue();
    return () => {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', queue);
    };
  }, [text]);
  const page = layout.pages[Math.min(layout.index, layout.pages.length - 1)];
  const move = (delta: number) => {
    const index = Math.max(0, Math.min(layout.pages.length - 1, layout.index + delta));
    anchor.current = layout.pages[index].start;
    setLayout({ ...layout, index });
  };
  return (
    <div className="measured-text">
      <div className="text-viewport" ref={viewport}>
        <p className="briefing-body text-page" data-start={page.start} data-end={page.end}>
          {text.slice(page.start, page.end)}
        </p>
        <p className="briefing-body text-measure" ref={measure} aria-hidden="true" />
      </div>
      <div className="panel-pagination text-pagination">
        <button
          disabled={!layout.index}
          aria-label="Previous text segment"
          onClick={() => move(-1)}
        >
          ←
        </button>
        <span>
          TEXT {layout.index + 1}/{layout.pages.length}
        </span>
        <button
          disabled={layout.index >= layout.pages.length - 1}
          aria-label="Next text segment"
          onClick={() => move(1)}
        >
          →
        </button>
      </div>
    </div>
  );
}
