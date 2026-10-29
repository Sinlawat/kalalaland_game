/**
 * D85: activities with set hours: lessons, nights out with friends, caring
 * for someone at home. An event starts one for some months; it takes its
 * hours from the week like school or work (time.ts), so the calendar shows
 * it and the time budget makes room for it (exercise first, then sleep).
 * It never locks a choice: taking one on is always possible, and the week
 * gives way.
 *
 * Functions that change the state MUTATE it; the read helpers never do.
 */

import { ACTIVITY_KINDS, type Activity, type ActivityKind, type GameState } from './types';

/** events.json `effects.activities`: one entry per kind of day (e.g. evenings, and longer on weekends). */
export interface ActivityEffect {
  kind: ActivityKind;
  /** Days of the week, 0 = Monday … 6 = Sunday. */
  days: number[];
  /** Hours on each of those days (halves allowed). */
  hours: number;
  months: number;
}

/** Longest day an activity may take: more would not leave room for sleep and school. */
export const MAX_ACTIVITY_HOURS_PER_DAY = 8;

/**
 * Starts the activities of an event. An event that happens again replaces
 * what it started the time before (the same lessons signed up for again run
 * from now, they do not pile up).
 */
export function startActivities(state: GameState, eventId: string, effects: readonly ActivityEffect[]): void {
  state.activities = state.activities.filter((activity) => activity.eventId !== eventId);
  for (const effect of effects) {
    state.activities.push({ kind: effect.kind, days: [...effect.days], hours: effect.hours, untilMonth: state.ageInMonths + effect.months, eventId });
  }
}

/** Activities whose months are over end (start of the month, like the lifestyle timers). */
export function expireActivities(state: GameState): void {
  state.activities = state.activities.filter((activity) => state.ageInMonths < activity.untilMonth);
}

/** Hours a week of each kind of activity going on now. */
export function activityHours(state: Pick<GameState, 'activities'>): Record<ActivityKind, number> {
  const result = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as Record<ActivityKind, number>;
  for (const activity of state.activities) result[activity.kind] += activity.hours * activity.days.length;
  return result;
}

/** Hours of each kind of activity on one day of the week (for the calendar). */
export function activityHoursOn(state: Pick<GameState, 'activities'>, weekday: number): Record<ActivityKind, number> {
  const result = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as Record<ActivityKind, number>;
  for (const activity of state.activities) if (activity.days.includes(weekday)) result[activity.kind] += activity.hours;
  return result;
}

/** For validation (events.json and saves). */
export function isValidActivityDays(days: unknown): days is number[] {
  return Array.isArray(days) && days.length > 0 && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(days).size === days.length;
}

export function isValidActivityHours(hours: unknown): hours is number {
  return typeof hours === 'number' && hours > 0 && hours <= MAX_ACTIVITY_HOURS_PER_DAY && Number.isInteger(hours * 2);
}

export function isValidActivity(value: unknown): value is Activity {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    (ACTIVITY_KINDS as readonly unknown[]).includes(a.kind) &&
    isValidActivityDays(a.days) &&
    isValidActivityHours(a.hours) &&
    Number.isInteger(a.untilMonth) &&
    typeof a.eventId === 'string'
  );
}
