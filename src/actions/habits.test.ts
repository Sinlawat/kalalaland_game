import { describe, expect, it } from 'vitest';
import { simulateWholeLife } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import type { GameState, Habits } from '../engine/types';
import { setHabit } from './habits';

const GRADE_1_AGE_IN_MONTHS = 6 * 12;

function lifeAtMonths(ageInMonths: number): GameState {
  return { ...createNewLife(1), ageInMonths };
}

describe('setHabit', () => {
  it('returns a new state with only that habit changed', () => {
    const life = lifeAtMonths(GRADE_1_AGE_IN_MONTHS);
    const updated = setHabit(life, 'exercise', 'regular');
    expect(updated.habits).toEqual({ ...life.habits, exercise: 'regular' });
    expect(updated).not.toBe(life);
    expect(life.habits.exercise).toBe('light'); // original untouched
  });

  describe('age rule: habits are chosen from Grade 1 (age 6)', () => {
    it.each([0, 1, GRADE_1_AGE_IN_MONTHS - 1])('rejects at %i months', (months) => {
      expect(() => setHabit(lifeAtMonths(months), 'exercise', 'regular')).toThrow(/from age 6/);
    });

    it.each([GRADE_1_AGE_IN_MONTHS, GRADE_1_AGE_IN_MONTHS + 1, 40 * 12])('allows at %i months', (months) => {
      expect(setHabit(lifeAtMonths(months), 'sleep', 'short').habits.sleep).toBe('short');
    });
  });

  it('rejects a level that does not belong to the habit (e.g. from a broken save)', () => {
    const life = lifeAtMonths(GRADE_1_AGE_IN_MONTHS);
    expect(() => setHabit(life, 'sleep', 'heavy' as unknown as Habits['sleep'])).toThrow(/Invalid level/);
  });

  it('rejects changes after death', () => {
    const dead = simulateWholeLife(createNewLife(2));
    expect(() => setHabit(dead, 'exercise', 'none')).toThrow(/after death/);
  });
});
