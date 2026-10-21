/**
 * Accumulated physical wear (design decision D36).
 *
 * Problem it solves: with drift alone the body "forgets" the past. Forty
 * years of short sleep could be undone in a few healthy years, and the
 * yearly damage was mostly cancelled by recovery, so bad habits barely
 * showed. Wear is the memory of the body:
 * - unhealthy effects ADD wear quickly,
 * - healthy effects REMOVE it slowly,
 * - wear lowers the health set point (see passive.ts, log line 'body.wear').
 */

import { BALANCE } from '../data/balance';
import { physicalLifestyleEffects } from './passive';
import type { GameState } from './types';

/** Yearly change of wear for the current state (positive = more damage). */
export function yearlyWearChange(state: GameState): number {
  const w = BALANCE.wear;
  let damage = 0;
  let healing = 0;
  for (const effect of physicalLifestyleEffects(state)) {
    if (effect.yearly < 0) damage += -effect.yearly;
    else healing += effect.yearly;
  }
  return damage * w.gainFactor - healing * w.healFactor;
}

/** Applies one month of wear change, kept inside 0..max. MUTATES `state`. */
export function applyMonthlyWear(state: GameState, yearlyChange: number): void {
  const next = state.hidden.physicalWear + yearlyChange / 12;
  state.hidden.physicalWear = Math.min(BALANCE.wear.max, Math.max(0, next));
}
