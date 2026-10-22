/**
 * Passive monthly effects: Environment + Habits (+ Traits as modifiers)
 * → Condition. Design doc section 6, steps 1–3.
 *
 * This module only CALCULATES. It returns a list of contributions and never
 * changes the state; `applyContributions` does that. Keeping "calculate"
 * and "apply" apart makes each piece trivial to unit-test.
 */

import { BALANCE } from '../data/balance';
import type { Contribution } from './stats';
import type { GameState, Habits } from './types';

const MONTHS_PER_YEAR = 12;

export function ageInYears(state: Pick<GameState, 'ageInMonths'>): number {
  return state.ageInMonths / MONTHS_PER_YEAR;
}

export function isWorking(state: Pick<GameState, 'flags'>): boolean {
  return state.flags.includes('working');
}

/** Grade 1 (ป.1): the age at which the child starts making their own choices. */
function reachedGradeOne(state: Pick<GameState, 'ageInMonths'>): boolean {
  return ageInYears(state) >= BALANCE.earlyChildhood.ownLifestyleFromAge;
}

/**
 * D34/D50: from Grade 1 the child has a lifestyle of their own and the
 * engine applies `state.habits`. Before that the family decides (see
 * exerciseAndSleepEffects). The player never picks habits; events change them.
 */
export function hasOwnLifestyle(state: Pick<GameState, 'ageInMonths'>): boolean {
  return reachedGradeOne(state);
}

/** D35: traits exist from birth but the player only sees them from Grade 1. */
export function knowsOwnTraits(state: Pick<GameState, 'ageInMonths'>): boolean {
  return reachedGradeOne(state);
}

/** Linear interpolation of a trait (0–100) between a min and max factor. */
export function traitFactor(traitValue: number, min: number, max: number): number {
  return min + ((max - min) * traitValue) / 100;
}

/** The value physical health drifts toward at a given age, before wear. */
export function physicalSetPoint(age: number): number {
  const b = BALANCE.physicalHealth;
  const yearsOfDecline = Math.max(0, age - b.setPointDeclineStartAge);
  return Math.max(b.setPointMin, b.setPointYoung - yearsOfDecline * b.setPointDeclinePerYear);
}

/** D36: how fast the body recovers toward its set point; slows down with age. */
export function physicalDriftRate(age: number): number {
  const b = BALANCE.physicalHealth;
  const slowdown = Math.max(0, age - b.driftSlowdownStartAge) * b.driftSlowdownPerYear;
  return Math.max(b.driftRateMin, b.driftRateYoung - slowdown);
}

function perMonth(yearlyAmount: number): number {
  return yearlyAmount / MONTHS_PER_YEAR;
}

/** Yearly effect tables for exercise and sleep (physical and mental use different ones). */
interface ExerciseSleepTable {
  exercise: Record<Habits['exercise'], number>;
  sleep: Record<Habits['sleep'], number>;
}

export interface YearlyEffect {
  source: string;
  yearly: number;
}

/**
 * Exercise and sleep effects for the current life stage.
 * - Age 6+: the player's chosen habits.
 * - Under 6: sleep depends on the family (interpolated between 'short' and
 *   'enough' by Family warmth); movement is normal play from age 2 and
 *   nothing for babies.
 */
function exerciseAndSleepEffects(state: GameState, table: ExerciseSleepTable): YearlyEffect[] {
  const { habits, environment } = state;
  if (hasOwnLifestyle(state)) {
    return [
      { source: `habit.exercise.${habits.exercise}`, yearly: table.exercise[habits.exercise] },
      { source: `habit.sleep.${habits.sleep}`, yearly: table.sleep[habits.sleep] },
    ];
  }
  const ec = BALANCE.earlyChildhood;
  const care = Math.min(1, environment.familyWarmth / ec.familyWarmthForEnoughSleep);
  const effects: YearlyEffect[] = [
    { source: 'child.sleep', yearly: table.sleep.short + (table.sleep.enough - table.sleep.short) * care },
  ];
  if (ageInYears(state) >= ec.playFromAge) {
    effects.push({ source: 'child.play', yearly: table.exercise.light });
  }
  return effects;
}

/**
 * Everything that acts on physical health EXCEPT the drift toward the set
 * point: habits and stress. Exported because wear is computed from it.
 */
export function physicalLifestyleEffects(state: GameState): YearlyEffect[] {
  const b = BALANCE.physicalHealth;
  const { habits, environment } = state;
  const effects = exerciseAndSleepEffects(state, b.habitsPerYear);
  if (isWorking(state)) {
    effects.push({ source: `habit.overtime.${habits.overtime}`, yearly: b.habitsPerYear.overtime[habits.overtime] });
    effects.push({ source: 'env.workStress', yearly: (environment.workStress / 100) * b.workStressAt100PerYear });
  }
  effects.push({
    source: 'env.financialStress',
    yearly: (environment.financialStress / 100) * b.financialStressAt100PerYear,
  });
  return effects;
}

function physicalHealthContributions(state: GameState, age: number): Contribution[] {
  const rate = physicalDriftRate(age);
  // Drift toward (age set point − wear), split into two log lines so the
  // player can see the long-term damage separately from normal recovery:
  //   rate × (setPoint − wear − health) = rate × (setPoint − health) + rate × (−wear)
  const drift = rate * (physicalSetPoint(age) - state.condition.physicalHealth);
  const wearPull = -rate * state.hidden.physicalWear;

  return [
    { target: 'physicalHealth', source: 'body.drift', amount: perMonth(drift) },
    { target: 'physicalHealth', source: 'body.wear', amount: perMonth(wearPull) },
    ...physicalLifestyleEffects(state).map(
      (effect): Contribution => ({ target: 'physicalHealth', source: effect.source, amount: perMonth(effect.yearly) }),
    ),
  ];
}

function mentalHealthContributions(state: GameState, age: number): Contribution[] {
  const b = BALANCE.mentalHealth;
  const { habits, environment, condition, traits } = state;
  // "External" effects: these are what Resilience can soften.
  const external: Contribution[] = [];
  const add = (source: string, yearly: number): void => {
    external.push({ target: 'mentalHealth', source, amount: perMonth(yearly) });
  };

  for (const effect of exerciseAndSleepEffects(state, b.habitsPerYear)) add(effect.source, effect.yearly);
  if (isWorking(state)) {
    add(`habit.overtime.${habits.overtime}`, b.habitsPerYear.overtime[habits.overtime]);
    add('env.workStress', (environment.workStress / 100) * b.workStressAt100PerYear);
  }
  add('env.financialStress', (environment.financialStress / 100) * b.financialStressAt100PerYear);
  const warmthWeight = age < 18 ? 1 : b.familyWarmthAdultWeight;
  add(
    'env.familyWarmth',
    ((environment.familyWarmth - 50) / 50) * b.familyWarmthMaxPerYear * warmthWeight,
  );

  // Trait as modifier: logged as its OWN line so the player sees
  // "work stress −4, resilience +2" instead of a mysterious "−2".
  const negativeTotal = external.reduce((sum, c) => sum + Math.min(0, c.amount), 0);
  // Math.abs instead of unary minus: -(0) would be -0, which leaks into logs.
  const softened = Math.abs(negativeTotal) * BALANCE.traits.resilienceMaxReduction * (traits.resilience / 100);

  // Drift toward the set point is not an outside hit, so Resilience does not touch it.
  const drift: Contribution = {
    target: 'mentalHealth',
    source: 'mind.drift',
    amount: perMonth((b.setPoint - condition.mentalHealth) * b.driftRatePerYear),
  };

  return [
    drift,
    ...external,
    { target: 'mentalHealth', source: 'trait.resilience', amount: softened },
  ];
}

function knowledgeContributions(state: GameState, age: number): Contribution[] {
  const b = BALANCE.knowledge;
  const result: Contribution[] = [];

  let baseYearly = 0;
  let source = '';
  if (age >= b.childhoodStartAge && age < b.childhoodEndAge) {
    baseYearly = b.childhoodPerYear;
    source = 'life.growingUp';
  } else if (age >= b.childhoodEndAge) {
    baseYearly = b.adultPerYear;
    source = 'life.experience';
  }

  if (baseYearly > 0) {
    const t = BALANCE.traits;
    const factor = traitFactor(state.traits.discipline, t.disciplineLearningMin, t.disciplineLearningMax);
    result.push({ target: 'knowledge', source, amount: perMonth(baseYearly) });
    result.push({ target: 'knowledge', source: 'trait.discipline', amount: perMonth(baseYearly * (factor - 1)) });
  }
  if (age >= b.agingStartAge) {
    result.push({ target: 'knowledge', source: 'body.aging', amount: perMonth(b.agingPerYear) });
  }
  return result;
}

function looksContributions(state: GameState, age: number): Contribution[] {
  const b = BALANCE.looks;
  const result: Contribution[] = [];
  if (age >= b.agingStartAge) {
    result.push({ target: 'looks', source: 'body.aging', amount: perMonth(b.agingPerYear) });
  }
  if (hasOwnLifestyle(state) && state.habits.exercise === 'regular') {
    result.push({ target: 'looks', source: 'habit.exercise.regular', amount: perMonth(b.regularExercisePerYear) });
  }
  return result;
}

/** All passive effects for one month, based on the state at the start of it. */
export function computePassiveContributions(state: GameState): Contribution[] {
  const age = ageInYears(state);
  return [
    ...physicalHealthContributions(state, age),
    ...mentalHealthContributions(state, age),
    ...knowledgeContributions(state, age),
    ...looksContributions(state, age),
  ];
}
