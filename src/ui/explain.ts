/**
 * Explanations for the "where did this change come from" lines.
 *
 * The texts live in th.json under `explain.<source>`. Numbers inside them
 * (normal levels, recovery rates, ages) are NOT typed into the text: they
 * are read from the balance data here, so changing a balance value can
 * never leave a tooltip showing an outdated number.
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
    gradeOne: BALANCE.earlyChildhood.playerChoosesHabitsFromAge,
    warmthForSleep: BALANCE.earlyChildhood.familyWarmthForEnoughSleep,
    growFrom: BALANCE.knowledge.childhoodStartAge,
    growTo: BALANCE.knowledge.childhoodEndAge,
    resilienceMax: percent(BALANCE.traits.resilienceMaxReduction),
  };
}

export function explainSource(source: string, context: ExplainContext): string {
  return t(`explain.${source}`, explainParams(context));
}
