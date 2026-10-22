import { t } from '../i18n/i18n';
import { ChangePopover } from './ChangePopover';
import type { ExplainContext } from './explain';
import { changeClass, formatStat } from './format';

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
}

/**
 * A labelled 0–100 bar that also shows how much it moved last year:
 *
 *   [██████████░░░░░░]           no change info
 *   [████████▓▓░░░░░░] 76 ▲4.2   gain: the green part is what was added
 *   [████████▒▒░░░░░░] 72 ▼4.2   loss: the red part is what was lost
 *
 * "▲4.2" is a button: hover, focus or tap shows where the change came from.
 * A styled <div> with role="meter" instead of the native <meter>: native
 * meters pick their own colors per browser and cannot follow our tokens.
 */
export function StatBar({ label, value, change }: Props) {
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
      </div>
      <span className="stat__value">{formatStat(value)}</span>
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
