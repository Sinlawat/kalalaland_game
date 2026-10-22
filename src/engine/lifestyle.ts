/**
 * Lifestyle (habits) rules — design decisions D50, D51, D56.
 *
 * - The player never picks a lifestyle. It starts from the family at Grade 1
 *   and changes only through events (a choice the player made, or an event
 *   that forces it).
 * - A change can be temporary: after N months the habit goes back.
 *
 * Every function here MUTATES the state it gets: they are called by the
 * engine on its private copy (see game.ts).
 */

import { BALANCE } from '../data/balance';
import type { GameState, HabitKey, Habits } from './types';

const MONTHS_PER_YEAR = 12;

/** The month of life in which the child's own lifestyle starts (Grade 1). */
export const OWN_LIFESTYLE_FROM_MONTH = BALANCE.earlyChildhood.ownLifestyleFromAge * MONTHS_PER_YEAR;

/** D51: the lifestyle the family hands over at Grade 1. */
export function startingLifestyle(state: Pick<GameState, 'environment'>): Habits {
  const ec = BALANCE.earlyChildhood;
  return {
    exercise: ec.startingExercise,
    sleep: state.environment.familyWarmth >= ec.familyWarmthForEnoughSleep ? 'enough' : 'short',
    overtime: ec.startingOvertime,
  };
}

/**
 * Sets one habit because of an event.
 * - `months` absent: a lasting change; any running timer for this habit ends.
 * - `months` given: a temporary change (D56). The habit returns to what it
 *   was BEFORE any temporary change, so two overlapping temporary events
 *   never leave a temporary value behind. The newest event wins: its timer
 *   replaces the old one.
 * Returns true when the habit's level actually changed.
 */
export function setHabitFromEvent<K extends HabitKey>(
  state: GameState,
  habit: K,
  level: Habits[K],
  months?: number,
): boolean {
  const timers = state.habitTimers as Record<HabitKey, { revertTo: string; untilMonth: number } | undefined>;
  const before = state.habits[habit];
  if (months === undefined) {
    delete timers[habit];
  } else {
    const revertTo = timers[habit]?.revertTo ?? before;
    if (revertTo === level) delete timers[habit];
    else timers[habit] = { revertTo, untilMonth: state.ageInMonths + months };
  }
  (state.habits as Record<HabitKey, string>)[habit] = level;
  return before !== level;
}

/**
 * Called at the START of a month, before the month's habits are recorded:
 * temporary changes that have run their course go back.
 * A change made in month m lasting n months is in effect for months
 * m+1 … m+n; at the start of month m+n+1 the state's age is m+n.
 */
export function expireHabitTimers(state: GameState): void {
  const timers = state.habitTimers as Record<HabitKey, { revertTo: string; untilMonth: number } | undefined>;
  for (const habit of Object.keys(timers) as HabitKey[]) {
    const timer = timers[habit];
    if (timer && state.ageInMonths >= timer.untilMonth) {
      (state.habits as Record<HabitKey, string>)[habit] = timer.revertTo;
      delete timers[habit];
    }
  }
}

/** At Grade 1 the family's lifestyle becomes the child's (D51). */
export function applyStartingLifestyle(state: GameState): void {
  state.habits = startingLifestyle(state);
  state.habitTimers = {};
}
