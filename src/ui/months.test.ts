import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import type { Habits } from '../engine/types';
import { countHabitMonths, displayedYearStart, habitSourceMonths, monthSlots, toneOf } from './months';

const regular: Habits = { exercise: 'regular', sleep: 'enough', overtime: 'none' };
const lazy: Habits = { exercise: 'none', sleep: 'short', overtime: 'none' };

describe('displayedYearStart', () => {
  it.each([
    [0, 0],
    [1, 0],
    [11, 0],
    [12, 0], // on a birthday, still show the year that just ended
    [13, 12],
    [72, 60],
    [73, 72],
  ])('age %i months → year starting after month %i', (age, start) => {
    expect(displayedYearStart(age)).toBe(start);
  });
});

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

describe('monthSlots', () => {
  it('returns 12 slots of the running year, lived up to the current month', () => {
    const slots = monthSlots(makeState({ ageInMonths: 75, birthMonth: 1, eventHistory: [], yearHabits: [regular, regular, lazy] }));
    expect(slots).toHaveLength(12);
    expect(slots.map((s) => s.lived)).toEqual([true, true, true, ...Array(9).fill(false)]);
    expect(slots.filter((s) => s.current).map((s) => s.monthOfLife)).toEqual([75]);
    expect(slots[2]!.habits).toEqual(lazy);
    expect(slots[3]!.habits).toBeUndefined();
  });

  it('labels slots with calendar months, wrapping after December', () => {
    const slots = monthSlots(makeState({ ageInMonths: 1, birthMonth: 11 }));
    expect(slots.slice(0, 3).map((s) => s.calendarMonth)).toEqual([12, 1, 2]);
  });

  it('marks event months with a tone from the real logged effects', () => {
    const state = makeState({
      ageInMonths: 66,
      eventHistory: [{ id: 'pox', ageInMonths: 65 }],
      history: [],
      yearLog: { physicalHealth: { 'event.pox': -4 } },
    });
    const slot = monthSlots(state).find((s) => s.monthOfLife === 65)!;
    expect(slot.eventIds).toEqual(['pox']);
    expect(slot.tone).toBe('bad');
  });

  it('on a birthday shows the finished year with its recorded habits', () => {
    const state = makeState({
      ageInMonths: 12,
      yearHabits: [],
      history: [{ age: 1, changes: {}, snapshot: { physicalHealth: 0, mentalHealth: 0, knowledge: 0, looks: 0 }, habits: Array(12).fill(regular) }],
    });
    const slots = monthSlots(state);
    expect(slots.every((s) => s.lived)).toBe(true);
    expect(slots[11]!.habits).toEqual(regular);
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
