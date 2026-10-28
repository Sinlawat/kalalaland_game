import { describe, expect, it } from 'vitest';
import { enroll } from '../engine/education';
import { makeState } from '../engine/testUtils';
import { fitTimeBudget, weekHours } from '../engine/time';
import type { GameState } from '../engine/types';
import { startJob } from '../engine/work';
import { ACTIVITIES, clock, daySchedule, dayTotals, weekSummary, weekdayOf } from './schedule';

function student(overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ ageInMonths: 15 * 12, habits: { exercise: 'regular', sleep: 'enough' }, ...overrides });
  enroll(state, 'upper_secondary_arts_math', state.ageInMonths);
  return state;
}

/** The hours of a whole week of days, by activity. */
function weekOfDays(state: GameState): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(ACTIVITIES.map((a) => [a, 0]));
  for (let weekday = 0; weekday < 7; weekday++) {
    const day = daySchedule(state, weekday);
    // Every day covers midnight to midnight, in order, without gaps.
    expect(day[0]!.start).toBe(0);
    expect(day.at(-1)!.end).toBe(24);
    day.slice(1).forEach((block, i) => expect(block.start).toBe(day[i]!.end));
    for (const [activity, hours] of Object.entries(dayTotals(day))) totals[activity]! += hours;
  }
  return totals;
}

describe('D83: the calendar', () => {
  it('day 1 is a Monday; day 7 a Sunday; day 29 a Monday again', () => {
    expect([weekdayOf(1), weekdayOf(7), weekdayOf(29)]).toEqual([0, 6, 0]);
  });

  it('a school day: travel, school 8–16, exercise, dinner, free time, 9 hours of sleep', () => {
    const day = daySchedule(student(), 0);
    expect(day.map((b) => `${clock(b.start)} ${b.activity}`)).toEqual([
      '00:00 sleep',
      '06:30 essentials',
      '07:30 commute',
      '08:00 study',
      '16:00 commute',
      '16:30 exercise',
      '17:30 essentials',
      '19:30 free',
      '21:30 sleep',
    ]);
  });

  it.each([
    ['school, no job', (s: GameState) => s],
    ['school + weekend job', (s: GameState) => (startJob(s, 'cafe', 'weekend'), s)],
    ['school + daily job (sleep cut)', (s: GameState) => (startJob(s, 'restaurant', 'daily'), s)],
    ['full-time job', (s: GameState) => ((s.education = { history: [] }), startJob(s, 'convenience_store', 'full_time'), s)],
  ])('a week of days adds up to the week the engine counts: %s', (_label, setUp) => {
    const state = setUp(student());
    fitTimeBudget(state);
    const engine = weekHours(state, state.habits);
    const days = weekOfDays(state);
    expect(days.study).toBe(engine.study);
    expect(days.work).toBe(engine.work);
    expect(days.sleep).toBeCloseTo(engine.sleep);
    expect(days.exercise).toBe(engine.exercise);
    expect(days.essentials).toBe(engine.essentials);
  });

  it('a daily job after school: work 17–20, bed after midnight (6 hours), and the week is full', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    fitTimeBudget(state);
    const monday = daySchedule(state, 0);
    expect(monday.find((b) => b.activity === 'work')).toEqual({ start: 17, end: 20, activity: 'work' });
    expect(dayTotals(monday).sleep).toBe(6);
    expect(weekSummary(state).full).toBe(true);
  });
});

describe('D83: what the week cut, for the notice', () => {
  it('names what the character wanted and what it is now', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    fitTimeBudget(state);
    expect(weekSummary(state).cut).toEqual([
      { habit: 'exercise', wanted: 'regular', now: 'none' },
      { habit: 'sleep', wanted: 'enough', now: 'short' },
    ]);
  });
});
