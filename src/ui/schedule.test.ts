import { describe, expect, it } from 'vitest';
import { enroll } from '../engine/education';
import { makeState } from '../engine/testUtils';
import { fitTimeBudget, weekHours } from '../engine/time';
import type { GameState } from '../engine/types';
import { startJob } from '../engine/work';
import { startActivities } from '../engine/activities';
import { ACTIVITIES, clock, daySchedule, dayTotals, wakingDay, weekSummary, weekdayOf } from './schedule';

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

describe('D85: every night has the sleep of the lifestyle', () => {
  /** Hours asleep from one evening to the next morning: the end of a waking day. */
  const night = (state: GameState, weekday: number) =>
    wakingDay(state, weekday)
      .filter((b) => b.activity === 'sleep')
      .reduce((sum, b) => sum + b.end - b.start, 0);

  it.each([
    ['enough sleep', 'enough', 9],
    ['short sleep', 'short', 6],
  ] as const)('%s: every night of the week, also Friday (late morning after) and Sunday (early morning after)', (_label, sleep, hours) => {
    const state = student({ habits: { exercise: 'none', sleep } });
    for (let weekday = 0; weekday < 7; weekday++) expect(night(state, weekday), `weekday ${weekday}`).toBe(hours);
  });

  it('bedtime is set by the next morning: Friday later (Saturday starts at 8), Sunday earlier (school at 6:30)', () => {
    const state = student({ habits: { exercise: 'none', sleep: 'enough' } });
    const bed = (weekday: number) => wakingDay(state, weekday).find((b) => b.activity === 'sleep')!.start;
    expect(clock(bed(4))).toBe('23:00');
    expect(clock(bed(6))).toBe('21:30');
  });
});

describe('D85: a day as it is lived, from waking up to the next morning', () => {
  it('free time past midnight is one stretch, then the night (not 00:00–00:30 and 19:30–24:00)', () => {
    const state = student({ habits: { exercise: 'none', sleep: 'short' } });
    const day = wakingDay(state, 0);
    expect(day.slice(-2).map((b) => `${b.activity} ${clock(b.start)}–${clock(b.end)}`)).toEqual(['free 18:30–00:30', 'sleep 00:30–06:30']);
    expect(day[0]!.start).toBe(6.5);
    expect(day.at(-1)!.end).toBe(24 + 6.5);
  });

  it('the calendar day is the end of last night, then today until midnight', () => {
    const state = student({ habits: { exercise: 'none', sleep: 'short' } });
    expect(daySchedule(state, 1).slice(0, 2)).toEqual([
      { start: 0, end: 0.5, activity: 'free' },
      { start: 0.5, end: 6.5, activity: 'sleep' },
    ]);
  });
});

describe('D85: activities in the calendar', () => {
  it('evening lessons come after school; weekend lessons in the morning; friends after dinner', () => {
    const state = student({ habits: { exercise: 'none', sleep: 'enough' } });
    startActivities(state, 'x', [
      { kind: 'lessons', days: [0, 1, 2, 3, 4], hours: 2, months: 6 },
      { kind: 'lessons', days: [5, 6], hours: 3, months: 6 },
      { kind: 'friends', days: [4], hours: 4, months: 6 },
    ]);
    const at = (weekday: number, activity: string) => wakingDay(state, weekday).find((b) => b.activity === activity);
    expect(at(0, 'lessons')).toEqual({ start: 16.5, end: 18.5, activity: 'lessons' });
    expect(at(4, 'friends')).toEqual({ start: 20.5, end: 24.5, activity: 'friends' });
    // Home at 00:30 on Friday night: a lie-in to 09:30 on Saturday, so the lessons start later than on Sunday.
    expect(at(5, 'lessons')).toEqual({ start: 10.5, end: 13.5, activity: 'lessons' });
    expect(at(6, 'lessons')).toEqual({ start: 9, end: 12, activity: 'lessons' });
  });

  it('a week of days adds up to the week the engine counts, activities included', () => {
    const state = student({ habits: { exercise: 'light', sleep: 'enough' } });
    startActivities(state, 'x', [
      { kind: 'lessons', days: [0, 1, 2, 3, 4], hours: 2, months: 6 },
      { kind: 'care', days: [5, 6], hours: 2, months: 6 },
      { kind: 'friends', days: [4, 5], hours: 3, months: 6 },
    ]);
    fitTimeBudget(state);
    const engine = weekHours(state, state.habits);
    const days = weekOfDays(state);
    for (const key of ['study', 'lessons', 'care', 'friends', 'exercise', 'essentials'] as const) expect(days[key], key).toBe(engine[key]);
    expect(days.sleep).toBeCloseTo(engine.sleep);
  });
});
