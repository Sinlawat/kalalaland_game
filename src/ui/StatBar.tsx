import { t } from '../i18n/i18n';
import { changeClass, formatDelta, formatStat } from './format';

interface Props {
  label: string;
  value: number;
  /** Change over the last completed year. Omit for stats that have no history. */
  change?: number | undefined;
}

/**
 * A labelled 0–100 bar that also shows how much it moved last year:
 *
 *   [██████████░░░░░░]           no change info
 *   [████████▓▓░░░░░░] 76 ▲4.2   gain: the green part is what was added
 *   [████████▒▒░░░░░░] 72 ▼4.2   loss: the red part is what was lost
 *
 * A styled <div> with role="meter" instead of the native <meter>: native
 * meters pick their own colors per browser and cannot follow our tokens.
 */
export function StatBar({ label, value, change }: Props) {
  const cls = change === undefined ? 'neutral' : changeClass(change);
  const hasChange = change !== undefined && cls !== 'neutral';
  const previous = hasChange ? value - change : value;
  const baseWidth = Math.min(previous, value);
  const deltaWidth = Math.abs(value - previous);

  const deltaText = hasChange ? formatDelta(change) : '';
  const spoken = hasChange
    ? t(change > 0 ? 'stat.changeUp' : 'stat.changeDown', { amount: Math.abs(change).toFixed(1) })
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
      <span className={`stat__change ${cls}`} aria-hidden="true">
        {deltaText}
      </span>
    </div>
  );
}
