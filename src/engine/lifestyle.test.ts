import { describe, expect, it } from 'vitest';
import { advanceOneMonth } from './game';
import { applyStartingLifestyle, expireHabitTimers, OWN_LIFESTYLE_FROM_MONTH, setHabitFromEvent, startingLifestyle } from './lifestyle';
import { createNewLife } from './newLife';
import { makeState } from './testUtils';

describe('starting lifestyle at Grade 1 (D51)', () => {
  it.each([
    [50, 'enough'],
    [49, 'short'],
  ] as const)('family warmth %i → sleep %s; light exercise, no overtime', (warmth, sleep) => {
    expect(startingLifestyle(makeState({ environment: { familyWarmth: warmth } }))).toEqual({
      exercise: 'light',
      sleep,
      overtime: 'none',
    });
  });

  it('is applied in the first month of age 6, before that month is recorded', () => {
    const life = { ...createNewLife(4), ageInMonths: OWN_LIFESTYLE_FROM_MONTH - 1, yearHabits: [] };
    life.environment.familyWarmth = 20;
    life.habits = { exercise: 'regular', sleep: 'enough', overtime: 'none' };
    const after = advanceOneMonth(life).state;
    expect(after.habits).toEqual({ exercise: 'light', sleep: 'short', overtime: 'none' });
    // Month 72 is also the 6th birthday: the year was closed into history.
    expect(after.history.at(-1)!.habits!.at(-1)).toEqual(after.habits);
  });

  it('later months keep whatever events set', () => {
    const life = { ...createNewLife(4), ageInMonths: OWN_LIFESTYLE_FROM_MONTH + 5 };
    life.habits = { exercise: 'regular', sleep: 'enough', overtime: 'none' };
    expect(advanceOneMonth(life).state.habits.exercise).toBe('regular');
  });

  it('also clears temporary changes from before Grade 1', () => {
    const state = makeState({ habitTimers: { sleep: { revertTo: 'enough', untilMonth: 999 } } });
    applyStartingLifestyle(state);
    expect(state.habitTimers).toEqual({});
  });
});

describe('temporary lifestyle (D56)', () => {
  it('lasts exactly N months, then goes back', () => {
    // Event in month 100, lasting 2 months: months 101 and 102 use it, 103 is back.
    let state = makeState({ ageInMonths: 100, habits: { sleep: 'enough' }, eventHistory: [], yearHabits: [] });
    setHabitFromEvent(state, 'sleep', 'short', 2);
    const sleepByMonth: string[] = [];
    for (let i = 0; i < 3; i++) {
      state = advanceOneMonth(state, []).state; // no random events: only the timer may change sleep
      sleepByMonth.push(state.yearHabits.at(-1)!.sleep);
    }
    expect(sleepByMonth).toEqual(['short', 'short', 'enough']);
    expect(state.habitTimers).toEqual({});
  });

  it('the newest event wins and goes back to the level from before ANY temporary change', () => {
    const state = makeState({ ageInMonths: 100, habits: { exercise: 'light' } });
    setHabitFromEvent(state, 'exercise', 'regular', 2); // summer camp
    state.ageInMonths = 101;
    setHabitFromEvent(state, 'exercise', 'none', 3); // then ill
    expect(state.habitTimers.exercise).toEqual({ revertTo: 'light', untilMonth: 104 });
  });

  it('a lasting change ends a running temporary one', () => {
    const state = makeState({ ageInMonths: 100, habits: { sleep: 'enough' } });
    setHabitFromEvent(state, 'sleep', 'short', 2);
    setHabitFromEvent(state, 'sleep', 'short');
    expect(state.habitTimers).toEqual({});
    state.ageInMonths = 200;
    expireHabitTimers(state);
    expect(state.habits.sleep).toBe('short');
  });

  it('reports whether the level really changed', () => {
    const state = makeState({ habits: { sleep: 'short' } });
    expect(setHabitFromEvent(state, 'sleep', 'short')).toBe(false);
    expect(setHabitFromEvent(state, 'sleep', 'enough')).toBe(true);
  });
});
