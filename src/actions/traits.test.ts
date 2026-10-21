import { describe, expect, it } from 'vitest';
import { simulateWholeLife } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import type { GameState } from '../engine/types';
import { acknowledgeTraitReveal, shouldRevealTraits, TRAITS_REVEALED_FLAG } from './traits';

function lifeAtMonths(ageInMonths: number): GameState {
  return { ...createNewLife(3), ageInMonths };
}

describe('shouldRevealTraits', () => {
  it('is false before Grade 1', () => {
    expect(shouldRevealTraits(lifeAtMonths(6 * 12 - 1))).toBe(false);
  });

  it('is true from Grade 1 until acknowledged', () => {
    expect(shouldRevealTraits(lifeAtMonths(6 * 12))).toBe(true);
    expect(shouldRevealTraits(lifeAtMonths(30 * 12))).toBe(true); // e.g. an older save
  });

  it('is false after acknowledging', () => {
    expect(shouldRevealTraits(acknowledgeTraitReveal(lifeAtMonths(6 * 12)))).toBe(false);
  });

  it('is false for a dead character', () => {
    const dead = simulateWholeLife(createNewLife(5));
    expect(shouldRevealTraits(dead)).toBe(false);
  });
});

describe('acknowledgeTraitReveal', () => {
  it('adds the flag once and does not mutate the input', () => {
    const life = lifeAtMonths(6 * 12);
    const once = acknowledgeTraitReveal(life);
    const twice = acknowledgeTraitReveal(once);
    expect(once.flags).toEqual([TRAITS_REVEALED_FLAG]);
    expect(twice).toBe(once);
    expect(life.flags).toEqual([]);
  });

  it('refuses before Grade 1', () => {
    expect(() => acknowledgeTraitReveal(lifeAtMonths(12))).toThrow();
  });
});
