import { useEffect, useRef, useState } from 'react';
import { Confirmation } from './types';
export function ConfirmationRing({
  confirmation,
  onDecision,
}: {
  confirmation: Confirmation;
  onDecision: (yes: boolean) => void;
}) {
  const [page, setPage] = useState(0),
    cancel = useRef<HTMLButtonElement>(null);
  const details = Object.entries(confirmation.action.args).flatMap(([key, value]) => {
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return (text.match(/[\s\S]{1,220}/g) || ['']).map((part, i) => ({
      key: key + (text.length > 220 ? ' / part ' + (i + 1) : ''),
      text: part,
    }));
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus();
  }, []);
  const selected = details[Math.min(page, details.length - 1)];
  return (
    <div className="confirmation-shade">
      <section
        className="confirmation-ring"
        role="alertdialog"
        aria-modal="true"
        aria-label="Action confirmation"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDecision(false);
          if (e.key === 'Tab') {
            const buttons = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            ];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
            e.preventDefault();
          }
        }}
      >
        <span className="eyebrow">
          HOST SAFETY / {confirmation.risk >= 3 ? 'CRITICAL' : 'IMPORTANT'}
        </span>
        <h2>Authorization required</h2>
        <b>{confirmation.action.tool.replaceAll('_', ' ').toUpperCase()}</b>
        <div className="confirmation-details">
          {selected ? (
            <p>
              <small>{selected.key}</small>
              <span>{selected.text}</span>
            </p>
          ) : (
            <p>No additional parameters.</p>
          )}
        </div>
        {details.length > 1 && (
          <div className="panel-pagination">
            <button
              disabled={!page}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous action detail"
            >
              ←
            </button>
            <span>
              DETAIL {page + 1}/{details.length}
            </span>
            <button
              disabled={page === details.length - 1}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next action detail"
            >
              →
            </button>
          </div>
        )}
        <p className="help">
          One unchanged action only. Review its details before confirming. Approval expires after 60
          seconds; Windows UAC still applies.
        </p>
        <footer>
          <button ref={cancel} onClick={() => onDecision(false)}>
            CANCEL
          </button>
          <button className="authorize" onClick={() => onDecision(true)}>
            CONFIRM THIS ACTION
          </button>
        </footer>
      </section>
    </div>
  );
}
