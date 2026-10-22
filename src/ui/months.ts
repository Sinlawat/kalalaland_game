/**
 * Month-level views of the current year, for the month bar (D38) and the
 * lifestyle strips. Pure functions over the game state; no React.
 */

import { calendarMonth } from '../engine/events';
import type { GameState, HabitKey, Habits } from '../engine/types';
import { effectsOfOccurrence } from './timeline';

export const MONTHS_PER_YEAR = 12;

/** Colour meaning of a month with events (D38 + the yellow rule). */
export type EventTone = 'good' | 'bad' | 'mixed';

export interface MonthSlot {
  /** Month of life this slot stands for (1 = first month after birth). */
  monthOfLife: number;
  /** Calendar month 1–12, for the label under the slot. */
  calendarMonth: number;
  /** Already lived? */
  lived: boolean;
  /** The month the game just simulated (the "now" marker). */
  current: boolean;
  /** Events that happened in this month, in order. */
  eventIds: string[];
  /** Colour for the event marker; absent when there were no events. */
  tone?: EventTone;
  /** Habits in effect during this month, if lived and recorded. */
  habits?: Habits;
}

type MonthSource = Pick<GameState, 'ageInMonths' | 'birthMonth' | 'eventHistory' | 'history' | 'yearLog' | 'yearHabits'>;

/**
 * First month of life of the year being shown, minus one (0, 12, 24…).
 * On a birthday the year that JUST ended is shown (full), so the player
 * sees what happened before the bar starts filling again.
 */
export function displayedYearStart(ageInMonths: number): number {
  if (ageInMonths === 0) return 0;
  return Math.floor((ageInMonths - 1) / MONTHS_PER_YEAR) * MONTHS_PER_YEAR;
}

/**
 * good  = only gains, bad = only losses,
 * mixed = gains and losses together, or no stat change at all.
 */
export function toneOf(amounts: number[]): EventTone {
  const up = amounts.some((a) => a > 0);
  const down = amounts.some((a) => a < 0);
  if (up && !down) return 'good';
  if (down && !up) return 'bad';
  return 'mixed';
}

/** Habits per month of the shown year: from history if that year is closed, else the running year. */
function habitsOfYear(state: MonthSource, yearStart: number): Habits[] {
  const yearEnd = yearStart + MONTHS_PER_YEAR;
  const closed = state.history.find((summary) => Math.round(summary.age * MONTHS_PER_YEAR) === yearEnd);
  if (closed) return closed.habits ?? [];
  return state.yearHabits;
}

export function monthSlots(state: MonthSource): MonthSlot[] {
  const start = displayedYearStart(state.ageInMonths);
  const habits = habitsOfYear(state, start);

  return Array.from({ length: MONTHS_PER_YEAR }, (_, index) => {
    const monthOfLife = start + index + 1;
    const lived = monthOfLife <= state.ageInMonths;
    const eventIds = state.eventHistory.filter((r) => r.ageInMonths === monthOfLife).map((r) => r.id);
    const amounts = eventIds.flatMap((id) => effectsOfOccurrence(state, id, monthOfLife).map((chip) => chip.amount));
    const monthHabits = lived ? habits[index] : undefined;
    return {
      monthOfLife,
      calendarMonth: calendarMonth({ birthMonth: state.birthMonth, ageInMonths: monthOfLife }),
      lived,
      current: monthOfLife === state.ageInMonths,
      eventIds,
      ...(eventIds.length > 0 ? { tone: toneOf(amounts) } : {}),
      ...(monthHabits ? { habits: monthHabits } : {}),
    };
  });
}

/** "regular: 3, light: 9" — how many months each level of a habit was used. */
export function countHabitMonths<K extends HabitKey>(habits: Habits[], habit: K): Map<Habits[K], number> {
  const counts = new Map<Habits[K], number>();
  for (const month of habits) counts.set(month[habit], (counts.get(month[habit]) ?? 0) + 1);
  return counts;
}

/** Log-source key → months, e.g. 'habit.exercise.regular' → 3, for the change breakdown. */
export function habitSourceMonths(habits: Habits[]): Record<string, number> {
  const months: Record<string, number> = {};
  for (const month of habits) {
    for (const habit of Object.keys(month) as HabitKey[]) {
      const key = `habit.${habit}.${month[habit]}`;
      months[key] = (months[key] ?? 0) + 1;
    }
  }
  return months;
}
