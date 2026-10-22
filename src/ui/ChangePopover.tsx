import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { t } from '../i18n/i18n';
import { explainSource, sourceLabel, type ExplainContext } from './explain';
import { changeClass, formatChange, formatDelta } from './format';
import { InfoTip } from './InfoTip';

/** Hide sources too small to show as ±0.1, so the list stays readable. */
const MIN_VISIBLE = 0.05;

interface Props {
  label: string;
  /** Total change of the stat over the last completed year. */
  total: number;
  /** Change per source for this stat in that year. */
  sources: Record<string, number>;
  explainContext: ExplainContext;
}

/**
 * The "▲3.0" next to a stat bar, as a button that opens the breakdown of
 * where the change came from (design decision: detail lives next to the
 * number it explains, not as a big block in the middle of the screen).
 *
 * Behaviour (a "disclosure"): click/tap/Enter toggles it. It STAYS open while
 * the player moves the mouse or focus around inside it (e.g. to the "i"
 * tips), and closes on: a click anywhere outside, Escape, or Tab leaving it.
 *
 * Why not open on hover? The panel sits below the stat row; moving the mouse
 * from the button down to the panel crosses the row, which is outside the
 * widget, so a hover-based panel closes on the way — the bug players hit.
 */
export function ChangePopover({ label, total, sources, explainContext }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const rows = Object.entries(sources)
    .filter(([, amount]) => Math.abs(amount) >= MIN_VISIBLE)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));

  // Close on a click/tap outside. Listening only while open keeps idle
  // stat bars free of document listeners.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keyboard: Tab moving focus OUT of the widget closes it (moving inside does not).
  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  return (
    <span
      ref={rootRef}
      className="change-popover"
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          buttonRef.current?.focus(); // give focus back to where the player started
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`change-popover__button ${changeClass(total)}`}
        aria-label={t('change.open', { label, change: formatChange(total) })}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {formatDelta(total)}
      </button>
      <span id={panelId} className="change-popover__panel" role="region" aria-label={t('change.title')} hidden={!open}>
        <strong className="change-popover__title">
          {t('change.title')} · {label}
        </strong>
        <span className="muted small">{t('change.period', { age: Math.floor(explainContext.age) })}</span>
        <ul className="change-popover__list">
          {rows.map(([source, amount]) => {
            const sourceName = sourceLabel(source);
            return (
              <li key={source}>
                <span className="summary__source">
                  {sourceName}
                  <InfoTip label={sourceName} text={explainSource(source, explainContext)} />
                </span>
                <span className={changeClass(amount)}>{formatChange(amount)}</span>
              </li>
            );
          })}
          <li className="change-popover__total">
            <span>{t('change.total')}</span>
            <span className={changeClass(total)}>{formatChange(total)}</span>
          </li>
        </ul>
      </span>
    </span>
  );
}
