/**
 * Month-level views for the month bar (D38) and the lifestyle strips.
 * Pure functions over the game state; no React.
 *
 * Two kinds of "year" exist in the game, on purpose:
 * - the ENGINE's year is a year of age (birthday to birthday): the yearly
 *   log, history and the change breakdown follow it;
 * - the MONTH BAR shows the CALENDAR year, January to December, because that
 *   is how people read months. The birthday is marked inside it.
 * Every month of life is stored by its number since birth, so both views
 * read the same data; only the grouping differs.
 */

import { calendarMonth } from '../engine/events';
import type { GameState, HabitKey, Habits } from '../engine/types';
import { effectsOfOccurrence } from './timeline';

export const MONTHS_PER_YEAR = 12;

/** Colour meaning of a month with events (D38 + the yellow rule). */
export type EventTone = 'good' | 'bad' | 'mixed';

export interface MonthSlot {
  /** Calendar month 1–12 (January = 1). Slots are always in this order. */
  calendarMonth: number;
  /** Month of life this slot stands for (1 = first month after birth; ≤ 0 = before birth). */
  monthOfLife: number;
  /** Before the character was born (only in the calendar year of birth). */
  beforeBirth: boolean;
  /** Already lived? */
  lived: boolean;
  /** The month the game just simulated (the "now" marker). */
  current: boolean;
  /** The character's birth month (birthday marker). */
  birthday: boolean;
  /** Events that happened in this month, in order. */
  eventIds: string[];
  /** Colour for the event marker; absent when there were no events. */
  tone?: EventTone;
  /** Habits in effect during this month, if lived and recorded. */
  habits?: Habits;
}

type MonthSource = Pick<GameState, 'ageInMonths' | 'birthMonth' | 'eventHistory' | 'history' | 'yearLog' | 'yearHabits'>;

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

/**
 * Habits in effect in a given month of life. Closed years keep theirs in
 * history (12 per year of age); the running year in `yearHabits`.
 * Returns undefined for months not recorded (e.g. played before save v4).
 */
export function habitsAtMonth(state: MonthSource, monthOfLife: number): Habits | undefined {
  if (monthOfLife < 1 || monthOfLife > state.ageInMonths) return undefined;
  const yearEnd = Math.ceil(monthOfLife / MONTHS_PER_YEAR) * MONTHS_PER_YEAR;
  const closed = state.history.find((summary) => Math.round(summary.age * MONTHS_PER_YEAR) === yearEnd);
  if (closed) return closed.habits?.[(monthOfLife - 1) % MONTHS_PER_YEAR];
  const runningStart = state.ageInMonths - state.yearHabits.length;
  return state.yearHabits[monthOfLife - 1 - runningStart];
}

/**
 * 12 slots, January to December, of the calendar year the character is in
 * now. At age 0 the "now" is the birth month itself.
 */
export function monthSlots(state: MonthSource): MonthSlot[] {
  const nowCalendar = calendarMonth({ birthMonth: state.birthMonth, ageInMonths: state.ageInMonths });

  return Array.from({ length: MONTHS_PER_YEAR }, (_, index) => {
    const month = index + 1;
    const monthOfLife = state.ageInMonths + (month - nowCalendar);
    const lived = monthOfLife >= 1 && monthOfLife <= state.ageInMonths;
    const eventIds = lived ? state.eventHistory.filter((r) => r.ageInMonths === monthOfLife).map((r) => r.id) : [];
    const amounts = eventIds.flatMap((id) => effectsOfOccurrence(state, id, monthOfLife).map((chip) => chip.amount));
    const monthHabits = habitsAtMonth(state, monthOfLife);
    return {
      calendarMonth: month,
      monthOfLife,
      beforeBirth: monthOfLife < 1,
      lived,
      current: monthOfLife === state.ageInMonths && state.ageInMonths >= 1,
      birthday: month === state.birthMonth,
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
