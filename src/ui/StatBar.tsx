import { t } from '../i18n/i18n';
import { ChangePopover } from './ChangePopover';
import type { ExplainContext } from './explain';
import { changeClass, formatChange, formatStat } from './format';
import type { StatFlash } from './useEventFlash';

/** Last year's change of a stat and where it came from. */
export interface StatChange {
  total: number;
  sources: Record<string, number>;
  explainContext: ExplainContext;
  /** Months each habit source applied during that year, e.g. 'habit.sleep.short' → 2. */
  sourceMonths: Record<string, number>;
}

interface Props {
  label: string;
  value: number;
  /** Omit for stats that have no history (traits, environment). */
  change?: StatChange | undefined;
  /** An event has just changed this stat: show its effect for a moment. */
  flash?: StatFlash | undefined;
}

/**
 * A labelled 0–100 bar that also shows how much it moved last year:
 *
 *   [██████████░░░░░░]           no change info
 *   [████████▓▓░░░░░░] 76 ▲4.2   gain: the green part is what was added
 *   [████████▒▒░░░░░░] 72 ▼4.2   loss: the red part is what was lost
 *
 * "▲4.2" is a button: hover, focus or tap shows where the change came from.
 * It covers the last COMPLETED year of age, so it updates on birthdays.
 *
 * `flash` is different: the effect of an event that JUST happened, shown as
 * a solid "+3.0" pill in the change column and a glow on the bar for a few
 * seconds.
 * The text is aria-hidden: screen readers get the event in the timeline.
 * A styled <div> with role="meter" instead of the native <meter>: native
 * meters pick their own colors per browser and cannot follow our tokens.
 */
export function StatBar({ label, value, change, flash }: Props) {
  const cls = change === undefined ? 'neutral' : changeClass(change.total);
  const hasChange = change !== undefined && cls !== 'neutral';
  const previous = hasChange ? value - change.total : value;
  const baseWidth = Math.min(previous, value);
  const deltaWidth = Math.abs(value - previous);
  const spoken = hasChange
    ? t(change.total > 0 ? 'stat.changeUp' : 'stat.changeDown', { amount: Math.abs(change.total).toFixed(1) })
    : '';

  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <div
        className="stat__track"
        role="meter"
        aria-label={spoken ? `${label}, ${spoken}` : label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
      >
        <div className="stat__fill" style={{ width: `${baseWidth}%` }} />
        {hasChange && (
          <div
            className={`stat__delta stat__delta--${cls}`}
            style={{ left: `${baseWidth}%`, width: `${deltaWidth}%` }}
          />
        )}
        {flash && <div key={flash.token} className={`stat__glow stat__glow--${changeClass(flash.amount)}`} />}
      </div>
      <span className="stat__value">{formatStat(value)}</span>
      {/* Drawn OVER the ▲ button for a moment, in the same grid cell (the ▲
          stays in the page, so keyboard focus is never lost); a solid pill,
          unlike the dashed ▲ button. */}
      {flash && (
        <span key={flash.token} className={`stat__flash stat__flash--${changeClass(flash.amount)}`} aria-hidden="true">
          {formatChange(flash.amount)}
        </span>
      )}
      <span className="stat__change">
        {hasChange && (
          <ChangePopover
            label={label}
            total={change.total}
            sources={change.sources}
            explainContext={change.explainContext}
            sourceMonths={change.sourceMonths}
          />
        )}
      </span>
    </div>
  );
}
