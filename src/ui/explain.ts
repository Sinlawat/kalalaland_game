/**
 * Labels and explanations for the "where did this change come from" lines.
 *
 * Two kinds of sources:
 * - fixed ones (habits, drift, traits...): name in `source.<key>`,
 *   explanation in `explain.<key>`;
 * - events: `event.<id>`; name = the event's title, explanation points to
 *   the "what happened" list where the full event text is shown.
 *
 * Numbers inside explanations (normal levels, recovery rates, ages) are NOT
 * typed into the text: they are read from the balance data here, so changing
 * a balance value can never leave a tooltip showing an outdated number.
 */

import { BALANCE } from '../data/balance';
import { physicalDriftRate, physicalSetPoint } from '../engine/passive';
import { t } from '../i18n/i18n';

export interface ExplainContext {
  /** Age in years the summary belongs to. */
  age: number;
  /** Current accumulated wear (the summary shown is always the latest year). */
  physicalWear: number;
}

const EVENT_PREFIX = 'event.';

function percent(rate: number): number {
  return Math.round(rate * 100);
}

/** Every number any explanation may use. Unused ones are simply ignored. */
export function explainParams({ age, physicalWear }: ExplainContext): Record<string, number> {
  const bodyNormal = physicalSetPoint(age);
  return {
    age: Math.floor(age),
    bodyNormal: Math.round(bodyNormal),
    bodyEffective: Math.round(Math.max(0, bodyNormal - physicalWear)),
    bodyRate: percent(physicalDriftRate(age)),
    mindNormal: BALANCE.mentalHealth.setPoint,
    mindRate: percent(BALANCE.mentalHealth.driftRatePerYear),
    playFrom: BALANCE.earlyChildhood.playFromAge,
    gradeOne: BALANCE.earlyChildhood.ownLifestyleFromAge,
    warmthForSleep: BALANCE.earlyChildhood.familyWarmthForEnoughSleep,
    growFrom: BALANCE.knowledge.childhoodStartAge,
    growTo: BALANCE.knowledge.childhoodEndAge,
    resilienceMax: percent(BALANCE.traits.resilienceMaxReduction),
  };
}

export function sourceLabel(source: string): string {
  return source.startsWith(EVENT_PREFIX) ? t(`${source}.title`) : t(`source.${source}`);
}

export function explainSource(source: string, context: ExplainContext): string {
  if (source.startsWith(EVENT_PREFIX)) {
    return t('explain.event', { title: t(`${source}.title`) });
  }
  return t(`explain.${source}`, explainParams(context));
}
