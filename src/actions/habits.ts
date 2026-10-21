/**
 * Player action: change a habit (design doc section 9).
 * The new habit applies from the next simulated month onward.
 */

import { BALANCE } from '../data/balance';
import { canChooseHabits } from '../engine/passive';
import {
  EXERCISE_LEVELS,
  OVERTIME_LEVELS,
  SLEEP_LEVELS,
  type GameState,
  type HabitKey,
  type Habits,
} from '../engine/types';

export const HABIT_OPTIONS: { readonly [K in HabitKey]: readonly Habits[K][] } = {
  exercise: EXERCISE_LEVELS,
  sleep: SLEEP_LEVELS,
  overtime: OVERTIME_LEVELS,
};

/**
 * Returns a NEW state with the habit changed.
 *
 * The rules are checked HERE, not only in the UI. Hiding the buttons is
 * just presentation; the engine must still refuse an invalid action, e.g.
 * from a future test, a script, or a bug in another screen.
 * Validates the level at runtime too: TypeScript checks our own code, but a
 * value coming from a loaded save file or a UI <select> is just a string.
 */
export function setHabit<K extends HabitKey>(state: GameState, habit: K, level: Habits[K]): GameState {
  if (state.death !== null) {
    throw new Error('Cannot change habits after death');
  }
  if (!canChooseHabits(state)) {
    throw new Error(
      `Habits can be chosen from age ${BALANCE.earlyChildhood.playerChoosesHabitsFromAge}, ` +
        `current age in months: ${state.ageInMonths}`,
    );
  }
  const allowed: readonly string[] = HABIT_OPTIONS[habit];
  if (!allowed.includes(level)) {
    throw new Error(`Invalid level "${String(level)}" for habit "${habit}"`);
  }
  return { ...state, habits: { ...state.habits, [habit]: level } };
}
