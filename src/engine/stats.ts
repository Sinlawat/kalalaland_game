/**
 * Applying stat changes, with clamping and logging (design doc section 6).
 *
 * Every change to a stat goes through `applyContributions`, so there is
 * exactly one place that clamps to 0–100 and one place that writes the log.
 * If some code changed `condition.mentalHealth` directly, the yearly summary
 * would silently stop matching the real value.
 */

import type { GameState, StatTarget, YearLog } from './types';

export const STAT_MIN = 0;
export const STAT_MAX = 100;

/** One reason for a stat to move this month, e.g. "regular exercise: +0.21". */
export interface Contribution {
  target: StatTarget;
  /** i18n key suffix explaining the change, e.g. 'habit.exercise.regular'. */
  source: string;
  amount: number;
}

export function clampStat(value: number): number {
  if (Number.isNaN(value)) {
    throw new Error('Stat value is NaN — a calculation upstream is broken');
  }
  return Math.min(STAT_MAX, Math.max(STAT_MIN, value));
}

function readStat(state: GameState, target: StatTarget): number {
  return target === 'looks' ? state.outcome.looks : state.condition[target];
}

function writeStat(state: GameState, target: StatTarget, value: number): void {
  if (target === 'looks') {
    state.outcome.looks = value;
  } else {
    state.condition[target] = value;
  }
}

function addToLog(log: YearLog, contribution: Contribution, actualAmount: number): void {
  const bySource = (log[contribution.target] ??= {});
  bySource[contribution.source] = (bySource[contribution.source] ?? 0) + actualAmount;
}

/**
 * Adds contributions to the stats and records them in the year log.
 *
 * MUTATES `state`. Callers inside the engine work on a private copy
 * (see game.ts), so the state the UI holds is never changed in place.
 *
 * Clamping detail: if health is 99 and a contribution says +3, only +1 is
 * applied and only +1 is logged. Otherwise the yearly summary would claim
 * changes that never happened.
 */
export function applyContributions(state: GameState, contributions: readonly Contribution[]): void {
  for (const contribution of contributions) {
    if (contribution.amount === 0) continue;
    const before = readStat(state, contribution.target);
    const after = clampStat(before + contribution.amount);
    const actual = after - before;
    writeStat(state, contribution.target, after);
    if (actual !== 0) addToLog(state.yearLog, contribution, actual);
  }
}
