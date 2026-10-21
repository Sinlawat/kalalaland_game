/**
 * Death check (design doc section 3): health, age, accident.
 *
 * Model:
 * - Health at 0 → death from illness, no dice roll.
 * - Natural death: a yearly hazard that grows exponentially with age
 *   (Gompertz law — real human mortality roughly doubles every ~8 years
 *   of adult age), multiplied by a factor from physical health.
 * - Accident: small constant hazard, scaled by Risk-taking.
 *
 * Yearly chances are converted to an exact monthly chance:
 *   monthly = 1 − (1 − yearly)^(1/12)
 * Dividing by 12 would be slightly wrong for large chances, and the error
 * matters at very old ages where the yearly chance is high.
 */

import { BALANCE } from '../data/balance';
import { ageInYears, traitFactor } from './passive';
import type { Rng } from './rng';
import type { DeathCause, GameState } from './types';

export function yearlyToMonthly(yearlyChance: number): number {
  const p = Math.min(1, Math.max(0, yearlyChance));
  return 1 - Math.pow(1 - p, 1 / 12);
}

/** Natural (non-accident) yearly death chance at a given age and health. */
export function naturalYearlyHazard(age: number, physicalHealth: number): number {
  const m = BALANCE.mortality;
  const base = age < 1 ? m.infantYearly : m.gompertzA * Math.exp(m.gompertzB * age);
  const healthMultiplier = Math.pow(2, (m.healthReference - physicalHealth) / m.healthDoublingPoints);
  return Math.min(1, base * healthMultiplier);
}

export function accidentYearlyHazard(riskTaking: number): number {
  const t = BALANCE.traits;
  return BALANCE.mortality.accidentYearly * traitFactor(riskTaking, t.riskAccidentMin, t.riskAccidentMax);
}

/** Returns the cause of death this month, or null if the character survives. */
export function rollDeath(state: GameState, rng: Rng): DeathCause | null {
  const m = BALANCE.mortality;
  const health = state.condition.physicalHealth;

  if (health <= m.deathAtHealth) return 'illness';

  // Always draw both numbers, in a fixed order. If the second draw only
  // happened sometimes, a tiny balance change could shift every later
  // random number and make old seeds play out completely differently.
  const naturalRoll = rng.next();
  const accidentRoll = rng.next();

  const age = ageInYears(state);
  if (naturalRoll < yearlyToMonthly(naturalYearlyHazard(age, health))) {
    const isOldAge = age >= m.oldAgeFromAge && health >= m.illnessBelowHealth;
    return isOldAge ? 'oldAge' : 'illness';
  }
  if (accidentRoll < yearlyToMonthly(accidentYearlyHazard(state.traits.riskTaking))) {
    return 'accident';
  }
  return null;
}
