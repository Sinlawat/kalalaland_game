/**
 * D85: activities with set hours (lessons, friends, caring for someone), and
 * the events that tell the player a job the game ended is over.
 */

import { describe, expect, it } from 'vitest';
import { activityHours, expireActivities, startActivities } from './activities';
import { advanceEducation, enroll } from './education';
import { applyChoice, applyEvent, findEvent, isEligible, lockReasons, parseEvents } from './events';
import { makeState } from './testUtils';
import { fitTimeBudget, weekHours } from './time';
import type { GameState } from './types';
import { advanceWork, startJob, stopWork } from './work';

/** A Grade 11 student (born in May), with time to spare: regular exercise, enough sleep. */
function student(overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ birthMonth: 5, ageInMonths: 16 * 12, habits: { exercise: 'regular', sleep: 'enough' }, ...overrides });
  enroll(state, 'upper_secondary_science', state.ageInMonths - 12);
  return state;
}

const choose = (state: GameState, eventId: string, choiceId: string) => applyChoice(state, findEvent(eventId)!, choiceId, state.ageInMonths);

describe('D85: an activity takes its hours for its months', () => {
  it('counts hours a day × days a week, by kind', () => {
    const state = student();
    startActivities(state, 'x', [
      { kind: 'lessons', days: [0, 1, 2, 3, 4], hours: 2, months: 6 },
      { kind: 'lessons', days: [5, 6], hours: 3, months: 6 },
      { kind: 'friends', days: [4], hours: 4, months: 6 },
    ]);
    expect(activityHours(state)).toEqual({ lessons: 16, friends: 4, care: 0, chores: 0 });
    expect(weekHours(state, state.habits)).toMatchObject({ lessons: 16, friends: 4, free: 34 - 20 });
  });

  it('ends at the start of the month its months are over (boundary: month 5 still on, month 6 over)', () => {
    const state = student();
    const start = state.ageInMonths;
    startActivities(state, 'x', [{ kind: 'care', days: [0], hours: 2, months: 6 }]);
    state.ageInMonths = start + 5;
    expireActivities(state);
    expect(state.activities).toHaveLength(1);
    state.ageInMonths = start + 6;
    expireActivities(state);
    expect(state.activities).toEqual([]);
  });

  it('the same event again replaces what it started (lessons signed up for again do not pile up)', () => {
    const state = student();
    startActivities(state, 'x', [{ kind: 'lessons', days: [0], hours: 2, months: 3 }]);
    state.ageInMonths += 2;
    startActivities(state, 'x', [{ kind: 'lessons', days: [0], hours: 2, months: 3 }]);
    startActivities(state, 'y', [{ kind: 'friends', days: [5], hours: 3, months: 3 }]);
    expect(state.activities.map((a) => [a.eventId, a.untilMonth])).toEqual([
      ['x', state.ageInMonths + 3],
      ['y', state.ageInMonths + 3],
    ]);
  });
});

describe('D85: the real events', () => {
  it.each([
    ['school_math_struggle', 'tutoring', { lessons: 10, friends: 0, care: 0, chores: 0 }, 3],
    ['school_tutoring_offer', 'weekends', { lessons: 6, friends: 0, care: 0, chores: 0 }, 6],
    ['edu_admission_prep', 'cram', { lessons: 16, friends: 0, care: 0, chores: 0 }, 6],
    ['social_late_night_gaming', 'every_night', { lessons: 0, friends: 14, care: 0, chores: 0 }, 6],
    ['family_relative_seriously_ill_working', 'help', { lessons: 0, friends: 0, care: 10, chores: 0 }, 3],
  ])('%s · %s takes %j a week for %i months', (eventId, choiceId, hours, months) => {
    const state = student();
    state.money.cash = 10_000;
    choose(state, eventId, choiceId);
    expect(activityHours(state)).toEqual(hours);
    expect(state.activities.every((a) => a.untilMonth === state.ageInMonths + months && a.eventId === eventId)).toBe(true);
  });

  it('reading alone is homework: it takes no hours (D83)', () => {
    const state = student();
    choose(state, 'edu_admission_prep', 'plan');
    expect(state.activities).toEqual([]);
  });

  it('a night out every night also means short sleep, as the story says (home at 2 am)', () => {
    const state = makeState({ ageInMonths: 19 * 12, flags: ['study_regional'], habits: { sleep: 'enough' } });
    enroll(state, 'bachelor_business', state.ageInMonths - 6);
    state.money.cash = 5_000;
    const person = { id: 9, nickname: 'n9', sex: 'male' as const, ageGapMonths: 0, metVia: 'social_uni_wrong_crowd', tags: [], periods: [] };
    applyChoice(state, findEvent('social_uni_wrong_crowd')!, 'go_along', state.ageInMonths, person);
    expect(state.habits.sleep).toBe('short');
    expect(activityHours(state).friends).toBe(21);
  });
});

describe('D85: when the week is full, the week gives way (exercise, then sleep); nothing is locked', () => {
  it('a student with a daily job can still sign up for the cram course: exercise goes, then sleep', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    fitTimeBudget(state);
    const cram = findEvent('edu_admission_prep')!.choices!.find((c) => c.id === 'cram')!;
    expect(lockReasons(cram, state)).toEqual([]);
    choose(state, 'edu_admission_prep', 'cram');
    // The course's own short sleep (6 months) is the event's; the week only had to take the exercise.
    expect(state.habits).toMatchObject({ exercise: 'none', sleep: 'short' });
    expect(state.timeCut).toEqual({ exercise: 'regular' });
  });

  it('weekend lessons alone fit: nothing is cut', () => {
    const state = student();
    choose(state, 'school_tutoring_offer', 'weekends');
    expect(state.habits).toMatchObject({ exercise: 'regular', sleep: 'enough' });
    expect(state.timeCut).toBeUndefined();
  });

  it('a full week cuts exercise first; when the activity ends, it comes back', () => {
    const state = student();
    // School 45 + essentials 21 + sleep 63 + exercise 5 + 21 hours with friends = 155: 13 free, below 14.
    startActivities(state, 'x', [{ kind: 'friends', days: [0, 1, 2, 3, 4, 5, 6], hours: 3, months: 6 }]);
    fitTimeBudget(state);
    expect(state.habits).toMatchObject({ exercise: 'light', sleep: 'enough' });
    expect(state.timeCut).toEqual({ exercise: 'regular' });
    state.ageInMonths += 6;
    expireActivities(state);
    fitTimeBudget(state);
    expect(state.habits.exercise).toBe('regular');
    expect(state.timeCut).toBeUndefined();
  });

  it('with no exercise left to cut, sleep goes too (D83: home late means short sleep)', () => {
    const state = student({ habits: { exercise: 'none', sleep: 'enough' } });
    startJob(state, 'restaurant', 'daily');
    startActivities(state, 'x', [{ kind: 'care', days: [0, 1, 2, 3, 4], hours: 2, months: 3 }]);
    fitTimeBudget(state);
    expect(state.habits).toMatchObject({ exercise: 'none', sleep: 'short' });
    expect(state.timeCut).toEqual({ sleep: 'enough' });
  });
});

describe('D85: events.json validation of activities', () => {
  const event = (activities: unknown) => [{ id: 'e', conditions: { ageMin: 0, ageMax: 9 }, frequency: 'normal', once: true, effects: { activities } }];

  it('accepts a list of { kind, days, hours, months }', () => {
    expect(() => parseEvents(event([{ kind: 'lessons', days: [0, 1], hours: 1.5, months: 2 }]))).not.toThrow();
  });

  it.each([
    [[], 'non-empty list'],
    [[{ kind: 'party', days: [0], hours: 2, months: 1 }], 'kind must be one of'],
    [[{ kind: 'lessons', days: [7], hours: 2, months: 1 }], 'days must be'],
    [[{ kind: 'lessons', days: [1, 1], hours: 2, months: 1 }], 'days must be'],
    [[{ kind: 'lessons', days: [1], hours: 0, months: 1 }], 'hours must be'],
    [[{ kind: 'lessons', days: [1], hours: 1.25, months: 1 }], 'hours must be'],
    [[{ kind: 'lessons', days: [1], hours: 9, months: 1 }], 'hours must be'],
    [[{ kind: 'lessons', days: [1], hours: 2, months: 0 }], 'months must be'],
    [[{ kind: 'lessons', days: [1], hours: 2, months: 1, when: 'x' }], 'unknown field "when"'],
  ])('rejects %j', (activities, expected) => {
    expect(() => parseEvents(event(activities))).toThrow(expected);
  });
});

describe('D85: a job the game ends is told to the player', () => {
  it('the school-break job: the month it ends (2 months), and only then', () => {
    const state = student();
    startJob(state, 'local_shop', 'school_break');
    const over = findEvent('work_school_break_over')!;
    state.ageInMonths += 1;
    advanceWork(state);
    expect(isEligible(over, state)).toBe(false);
    state.ageInMonths += 1;
    advanceWork(state);
    expect(isEligible(over, state)).toBe(true);
    applyEvent(state, over);
    state.ageInMonths += 1;
    advanceWork(state);
    expect(isEligible(over, state)).toBe(false);
  });

  it('part-time work: the month the studies end', () => {
    const state = student();
    startJob(state, 'cafe', 'weekend');
    const ended = findEvent('work_parttime_ended_school')!;
    state.education.history.at(-1)!.to = state.ageInMonths + 1;
    state.education.history.at(-1)!.result = 'graduated';
    state.ageInMonths += 1;
    advanceEducation(state);
    advanceWork(state);
    expect(isEligible(ended, state)).toBe(true);
  });

  it('quitting is the choice of the player: no notice', () => {
    const state = student();
    startJob(state, 'cafe', 'weekend');
    state.ageInMonths += 1;
    stopWork(state, 'quit');
    expect(isEligible(findEvent('work_parttime_ended_school')!, state)).toBe(false);
  });
});

describe('D86: helping at the morning market', () => {
  /** A Grade 4 pupil (born in May) of a poor family. */
  function pupil(): GameState {
    const state = makeState({ birthMonth: 5, ageInMonths: 10 * 12, environment: { familyWealth: 30 }, flags: ['school_public'], habits: { exercise: 'light', sleep: 'enough' } });
    enroll(state, 'primary', 6 * 12);
    return state;
  }

  it('takes 2 hours before school every school day, until 18', () => {
    const state = pupil();
    applyEvent(state, findEvent('family_market_helper')!);
    expect(state.activities).toEqual([{ kind: 'chores', days: [0, 1, 2, 3, 4], hours: 2, untilMonth: 18 * 12, eventId: 'family_market_helper', morning: true }]);
    expect(activityHours(state).chores).toBe(10);
    expect(state.eventHistory.at(-1)!.activities).toEqual([{ kind: 'chores', hoursPerWeek: 10, months: 8 * 12 }]);
  });

  it('ends when the child moves to the grandparents in the countryside', () => {
    const state = pupil();
    applyEvent(state, findEvent('family_market_helper')!);
    applyEvent(state, findEvent('family_live_with_grandparents')!);
    expect(state.activities).toEqual([]);
  });

  it('an activity until an age that has passed does not start', () => {
    const state = makeState({ ageInMonths: 18 * 12 });
    startActivities(state, 'x', [{ kind: 'chores', days: [0], hours: 2, untilAge: 18 }]);
    expect(state.activities).toEqual([]);
  });
});

describe('D86: events.json validation of activity lengths and endings', () => {
  const event = (effects: unknown) => [{ id: 'e', conditions: { ageMin: 0, ageMax: 9 }, frequency: 'normal', once: true, effects }];

  it.each([
    [{ activities: [{ kind: 'chores', days: [0], hours: 2 }] }, 'exactly one of months or untilAge'],
    [{ activities: [{ kind: 'chores', days: [0], hours: 2, months: 2, untilAge: 18 }] }, 'exactly one of months or untilAge'],
    [{ activities: [{ kind: 'chores', days: [0], hours: 2, untilAge: 17.5 }] }, 'untilAge must be'],
    [{ activities: [{ kind: 'chores', days: [0], hours: 2, months: 2, morning: false }] }, 'morning must be true'],
    [{ endActivities: [] }, 'endActivities must be a non-empty list'],
    [{ endActivities: ['nope'] }, 'endActivities names event "nope", which does not exist'],
  ])('rejects %j', (effects, expected) => {
    expect(() => parseEvents(event(effects))).toThrow(expected);
  });
});
