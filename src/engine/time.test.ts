import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { enroll } from './education';
import { applyChoice, findEvent, isEligible, lockReasons } from './events';
import { advanceOneMonth } from './game';
import { setHabitFromEvent } from './lifestyle';
import { makeState } from './testUtils';
import { fitTimeBudget, fittedHabits, hasTimeFor, weekHours } from './time';
import type { GameState } from './types';
import { startJob, stopWork } from './work';

function student(overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ ageInMonths: 16 * 12, habits: { exercise: 'regular', sleep: 'enough' }, ...overrides });
  enroll(state, 'upper_secondary_arts_math', state.ageInMonths);
  return state;
}

describe('D83: the hours of a week', () => {
  it('a Grade 11 student: school 40, travel 5, essentials 21, 9 hours of sleep, exercise; 34 hours free', () => {
    expect(weekHours(student(), { exercise: 'regular', sleep: 'enough' })).toEqual({
      study: 40,
      commute: 5,
      work: 0,
      lessons: 0,
      friends: 0,
      care: 0,
      essentials: 21,
      sleep: 63,
      exercise: 5,
      free: 34,
    });
  });

  it('adults need 8 hours (56), a home far from school adds travel, the open university is 6 hours', () => {
    expect(weekHours(makeState({ ageInMonths: 30 * 12 }), { exercise: 'none', sleep: 'enough' }).sleep).toBe(56);
    expect(weekHours(student({ flags: ['long_commute'] }), { exercise: 'none', sleep: 'enough' }).commute).toBe(10);
    const open = makeState({ ageInMonths: 19 * 12, flags: ['study_open'] });
    enroll(open, 'bachelor_business', open.ageInMonths);
    expect(weekHours(open, { exercise: 'none', sleep: 'enough' })).toMatchObject({ study: 6, commute: 0 });
  });

  it('a school-break job: no school while it lasts', () => {
    const state = student();
    startJob(state, 'local_shop', 'school_break');
    expect(weekHours(state, state.habits)).toMatchObject({ study: 0, work: 48, commute: 5 });
  });
});

describe('D83: what does not fit gives way: exercise first, then sleep', () => {
  it('weekend job: everything still fits', () => {
    const state = student();
    startJob(state, 'cafe', 'weekend');
    expect(fittedHabits(state, { exercise: 'regular', sleep: 'enough' })).toEqual({ exercise: 'regular', sleep: 'enough' });
  });

  it('daily job: 10 hours free with no exercise is below the minimum of 14, so sleep is cut too', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    expect(weekHours(state, { exercise: 'none', sleep: 'enough' }).free).toBe(10);
    expect(BALANCE.time.minFree).toBe(14);
    fitTimeBudget(state);
    expect(state.habits).toMatchObject({ exercise: 'none', sleep: 'short' });
    expect(state.timeCut).toEqual({ exercise: 'regular', sleep: 'enough' });
  });

  it('when the time comes back, so does the lifestyle the character wanted', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    fitTimeBudget(state);
    stopWork(state);
    fitTimeBudget(state);
    expect(state.habits).toMatchObject({ exercise: 'regular', sleep: 'enough' });
    expect(state.timeCut).toBeUndefined();
  });

  it('a temporary event during a cut goes back to what the character wanted, not to the cut level', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    fitTimeBudget(state);
    setHabitFromEvent(state, 'sleep', 'short', 3);
    expect(state.habitTimers.sleep).toMatchObject({ revertTo: 'enough' });
  });

  it('before Grade 1 the family runs the day: nothing is cut', () => {
    const child = makeState({ ageInMonths: 4 * 12, habits: { exercise: 'regular', sleep: 'enough' } });
    fitTimeBudget(child);
    expect(child.timeCut).toBeUndefined();
  });

  it('the monthly step fits the week too (a save from before D83 is fixed the next month)', () => {
    const state = student({ birthMonth: 5 });
    startJob(state, 'restaurant', 'daily');
    state.habits.sleep = 'enough';
    const next = advanceOneMonth(state, []).state;
    expect(next.habits.sleep).toBe('short');
  });
});

describe('D83: events and choices that need time', () => {
  it('more sleep or exercise than the week has time for: the choice is locked; less is always fine', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    fitTimeBudget(state);
    expect(hasTimeFor(state, { sleep: 'enough' })).toBe(false);
    expect(hasTimeFor(state, { sleep: 'short' })).toBe(true);
    const resolution = findEvent('life_resolution_sleep')!;
    const start = resolution.choices!.find((c) => c.id === 'start')!;
    expect(lockReasons(start, state)).toEqual([{ kind: 'time' }]);
    stopWork(state);
    fitTimeBudget(state);
    expect(lockReasons(start, state)).toEqual([]);
  });

  it('an event that would give more sleep does not happen when there is no time for it', () => {
    const state = student({ ageInMonths: 16 * 12, habits: { sleep: 'short', exercise: 'none' } });
    const kept = findEvent('life_resolution_sleep_kept')!;
    const withTime = { ...state, flags: ['trying_sleep'], eventHistory: [{ id: 'life_resolution_sleep', ageInMonths: state.ageInMonths - 3, choiceId: 'start' }], traits: { ...state.traits, discipline: 80 } };
    const eligibleWithTime = isEligible(kept, withTime);
    startJob(withTime, 'restaurant', 'daily');
    expect([eligibleWithTime, isEligible(kept, withTime)]).toEqual([true, false]);
  });

  it('starting a daily job through an event fits the week at once', () => {
    const state = student();
    applyChoice(state, findEvent('work_parttime_offer')!, 'daily', state.ageInMonths);
    expect(state.habits).toMatchObject({ sleep: 'short', exercise: 'none' });
    // ...and the late nights event now meets a character who really sleeps late.
    expect(isEligible(findEvent('work_late_nights')!, { ...state, ageInMonths: state.ageInMonths + 1 })).toBe(true);
  });
});
