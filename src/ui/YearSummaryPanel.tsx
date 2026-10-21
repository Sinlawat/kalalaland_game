import type { StatTarget, YearSummary } from '../engine/types';
import { t } from '../i18n/i18n';
import { explainSource, type ExplainContext } from './explain';
import { changeClass, formatChange } from './format';
import { InfoTip } from './InfoTip';

const TARGET_ORDER: StatTarget[] = ['physicalHealth', 'mentalHealth', 'knowledge', 'looks'];

/** Hide sources too small to show as ±0.1, so the list stays readable. */
const MIN_VISIBLE = 0.05;

interface Props {
  summary: YearSummary;
  /** Current values the explanations need (normal levels depend on age and wear). */
  explainContext: ExplainContext;
}

/**
 * Two parts:
 * 1. "What happened this year" — events. The event system arrives in a later
 *    increment, so this section is always empty for now.
 * 2. "How you changed" — every stat change with its sources
 *    (design doc section 6: the player must always see WHERE a change came from),
 *    each with an "i" tip explaining what the source means.
 */
export function YearSummaryPanel({ summary, explainContext }: Props) {
  return (
    <section className="card summary" aria-live="polite">
      <h2>
        {t('summary.title')} · {t('summary.ageReached', { age: Math.floor(summary.age) })}
      </h2>

      <h3 className="summary__section">{t('summary.events')}</h3>
      <p className="muted small">{t('summary.noEvents')}</p>

      <h3 className="summary__section">{t('summary.changes')}</h3>
      <p className="muted small">{t('summary.hint')}</p>
      {TARGET_ORDER.map((target) => {
        const entries = Object.entries(summary.changes[target] ?? {});
        const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
        const visible = entries
          .filter(([, amount]) => Math.abs(amount) >= MIN_VISIBLE)
          .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));
        return (
          <div key={target} className="summary__group">
            <div className="summary__head">
              <span>{t(`stat.${target}`)}</span>
              <span className={changeClass(total)}>{formatChange(total)}</span>
            </div>
            {visible.length === 0 ? (
              <p className="muted small">{t('summary.noChange')}</p>
            ) : (
              <ul className="summary__list">
                {visible.map(([source, amount]) => {
                  const label = t(`source.${source}`);
                  return (
                    <li key={source}>
                      <span className="summary__source">
                        {label}
                        <InfoTip label={label} text={explainSource(source, explainContext)} />
                      </span>
                      <span className={changeClass(amount)}>{formatChange(amount)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
