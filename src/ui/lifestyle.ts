/**
 * Why each habit is what it is (D50): the lifestyle card shows the event
 * behind the current level, so the player sees cause and effect even though
 * they never pick habits themselves. Pure functions, unit-tested.
 */

import { OWN_LIFESTYLE_FROM_MONTH } from '../engine/lifestyle';
import type { GameState, HabitKey } from '../engine/types';

export type HabitReason =
  /** Unchanged since Grade 1: the family's lifestyle (D51). */
  | { kind: 'family' }
  /** Set by an event that lasts. */
  | { kind: 'event'; eventId: string }
  /** Set by a temporary event still running (D56). */
  | { kind: 'temporary'; eventId: string; monthsLeft: number; revertTo: string };

type ReasonSource = Pick<GameState, 'ageInMonths' | 'eventHistory' | 'habitTimers' | 'habits'>;

/**
 * Walks the history backwards to the latest event that still explains the
 * current level (one that set the habit to the level it has now). A temporary change that has run out (or was replaced by a
 * newer one) no longer explains anything, so it is skipped and the search
 * goes on to the change before it. Changes before Grade 1 do not count: the
 * family's lifestyle replaced them.
 */
export function habitReason(state: ReasonSource, habit: HabitKey): HabitReason {
  const timer = state.habitTimers[habit];
  for (let i = state.eventHistory.length - 1; i >= 0; i--) {
    const record = state.eventHistory[i]!;
    if (record.ageInMonths < OWN_LIFESTYLE_FROM_MONTH) break;
    if (record.habitChanges?.[habit] === undefined) continue;
    // D77: a level that something else changed since (e.g. the exercise given
    // back when a job ended) is not explained by this event: look further back.
    if (record.habitChanges[habit] !== state.habits[habit]) continue;
    const months = record.habitMonths?.[habit];
    if (months === undefined) return { kind: 'event', eventId: record.id };
    const stillRunning = timer !== undefined && timer.untilMonth === record.ageInMonths + months;
    if (stillRunning) {
      return { kind: 'temporary', eventId: record.id, monthsLeft: timer.untilMonth - state.ageInMonths, revertTo: timer.revertTo };
    }
  }
  return { kind: 'family' };
}
