import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import type { Habits, YearSummary } from '../engine/types';
import { countHabitMonths, habitsAtMonth, habitSourceMonths, monthSlots, toneOf } from './months';

const ZERO_SNAPSHOT: YearSummary['snapshot'] = {
  physicalHealth: 0,
  mentalHealth: 0,
  looks: 0,
  skills: { academic: 0, creative: 0, communication: 0, practical: 0 },
};

const regular: Habits = { exercise: 'regular', sleep: 'enough', overtime: 'none' };
const lazy: Habits = { exercise: 'none', sleep: 'short', overtime: 'none' };

function closedYear(age: number, habits: Habits[]): YearSummary {
  return { age, changes: {}, snapshot: ZERO_SNAPSHOT, habits };
}

describe('toneOf', () => {
  it.each([
    [[3], 'good'],
    [[-4, -1], 'bad'],
    [[2, -1], 'mixed'],
    [[], 'mixed'], // an event without stat changes (e.g. basic vaccines)
  ] as const)('%j → %s', (amounts, tone) => {
    expect(toneOf([...amounts])).toBe(tone);
  });
});

describe('monthSlots (calendar year, January to December)', () => {
  it('always lists January first and December last', () => {
    const slots = monthSlots(makeState({ ageInMonths: 30, birthMonth: 3 }));
    expect(slots.map((s) => s.calendarMonth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('maps calendar months to months of life around "now"', () => {
    // born in March; 30 months old → now is September (3 - 1 + 30 = 32 → 32 % 12 = 8 → September)
    const slots = monthSlots(makeState({ ageInMonths: 30, birthMonth: 3 }));
    const now = slots.find((s) => s.current)!;
    expect(now.calendarMonth).toBe(9);
    expect(now.monthOfLife).toBe(30);
    expect(slots[0]!.monthOfLife).toBe(22); // January of the same calendar year
    expect(slots.map((s) => s.lived)).toEqual([...Array(9).fill(true), ...Array(3).fill(false)]);
  });

  it('marks months before birth in the year of birth, and the birthday month', () => {
    const slots = monthSlots(makeState({ ageInMonths: 2, birthMonth: 10, history: [], yearHabits: [regular, regular] }));
    expect(slots.filter((s) => s.beforeBirth).map((s) => s.calendarMonth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(slots.filter((s) => s.lived).map((s) => s.calendarMonth)).toEqual([11, 12]);
    expect(slots.filter((s) => s.birthday).map((s) => s.calendarMonth)).toEqual([10]);
  });

  it('marks event months with a tone from the real logged effects', () => {
    const state = makeState({
      ageInMonths: 66,
      birthMonth: 1, // now = July, month of life 65 = June of the same calendar year
      eventHistory: [{ id: 'pox', ageInMonths: 65 }],
      history: [],
      yearLog: { physicalHealth: { 'event.pox': -4 } },
    });
    const slot = monthSlots(state).find((s) => s.monthOfLife === 65)!;
    expect(slot.eventIds).toEqual(['pox']);
    expect(slot.tone).toBe('bad');
  });
});

describe('monthSlots: lifestyle per month', () => {
  it('shows habits only from Grade 1 (age 6); before that the family decides', () => {
    // Born in January, 74 months old (6 years 2 months): March of the calendar year.
    const state = makeState({
      ageInMonths: 74,
      birthMonth: 1,
      history: [closedYear(6, Array(12).fill(regular))],
      yearHabits: [lazy, lazy],
    });
    const shown = monthSlots(state).filter((s) => s.habits).map((s) => s.monthOfLife);
    expect(shown).toEqual([72, 73, 74]);
  });
});

describe('habitsAtMonth', () => {
  // 14 months old: months 1–12 closed at age 1, months 13–14 in the running year
  const state = makeState({
    ageInMonths: 14,
    history: [closedYear(1, [...Array(11).fill(regular), lazy])],
    yearHabits: [lazy, regular],
  });

  it('reads closed years from history and the running year from yearHabits', () => {
    expect(habitsAtMonth(state, 1)).toEqual(regular);
    expect(habitsAtMonth(state, 12)).toEqual(lazy);
    expect(habitsAtMonth(state, 13)).toEqual(lazy);
    expect(habitsAtMonth(state, 14)).toEqual(regular);
  });

  it('has nothing for months not lived yet or before birth', () => {
    expect(habitsAtMonth(state, 15)).toBeUndefined();
    expect(habitsAtMonth(state, 0)).toBeUndefined();
  });

  it('has nothing for years played before habits were recorded (old saves)', () => {
    const old = makeState({ ageInMonths: 14, history: [{ ...closedYear(1, []), habits: undefined as never }], yearHabits: [] });
    expect(habitsAtMonth(old, 5)).toBeUndefined();
    expect(habitsAtMonth(old, 13)).toBeUndefined();
  });
});

describe('habit month counts', () => {
  const year = [regular, regular, regular, lazy, lazy];

  it('counts months per level of one habit', () => {
    expect(Object.fromEntries(countHabitMonths(year, 'exercise'))).toEqual({ regular: 3, none: 2 });
  });

  it('maps log-source keys to months for the change breakdown', () => {
    expect(habitSourceMonths(year)).toMatchObject({
      'habit.exercise.regular': 3,
      'habit.exercise.none': 2,
      'habit.sleep.enough': 3,
      'habit.sleep.short': 2,
    });
  });
});
