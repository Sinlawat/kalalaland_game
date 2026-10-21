import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { accidentYearlyHazard, naturalYearlyHazard, rollDeath, yearlyToMonthly } from './mortality';
import { createRng } from './rng';
import { makeState } from './testUtils';

describe('yearlyToMonthly', () => {
  it('compounds back to the yearly chance over 12 months', () => {
    for (const yearly of [0.001, 0.1, 0.5, 0.9]) {
      const monthly = yearlyToMonthly(yearly);
      expect(1 - Math.pow(1 - monthly, 12)).toBeCloseTo(yearly, 10);
    }
  });

  it('handles the boundaries and clamps out-of-range input', () => {
    expect(yearlyToMonthly(0)).toBe(0);
    expect(yearlyToMonthly(1)).toBe(1);
    expect(yearlyToMonthly(-0.5)).toBe(0);
    expect(yearlyToMonthly(2)).toBe(1);
  });
});

describe('naturalYearlyHazard', () => {
  it('increases with age for adults', () => {
    expect(naturalYearlyHazard(60, 70)).toBeGreaterThan(naturalYearlyHazard(30, 70));
    expect(naturalYearlyHazard(90, 70)).toBeGreaterThan(naturalYearlyHazard(60, 70));
  });

  it('is higher in the first year of life than in childhood', () => {
    expect(naturalYearlyHazard(0.5, 70)).toBeGreaterThan(naturalYearlyHazard(8, 70));
  });

  it('doubles for every `healthDoublingPoints` of lost physical health', () => {
    const points = BALANCE.mortality.healthDoublingPoints;
    expect(naturalYearlyHazard(50, 70 - points) / naturalYearlyHazard(50, 70)).toBeCloseTo(2);
  });

  it('never exceeds 1', () => {
    expect(naturalYearlyHazard(120, 1)).toBeLessThanOrEqual(1);
  });
});

describe('accidentYearlyHazard', () => {
  it('is higher for risk takers', () => {
    expect(accidentYearlyHazard(100)).toBeGreaterThan(accidentYearlyHazard(0));
  });
});

describe('rollDeath', () => {
  it('kills immediately from illness when physical health reaches 0', () => {
    expect(rollDeath(makeState({ condition: { physicalHealth: 0 } }), createRng(1))).toBe('illness');
  });

  it('almost never kills a healthy 30-year-old in one month', () => {
    const rng = createRng(1);
    const state = makeState({ condition: { physicalHealth: 80 } });
    let deaths = 0;
    for (let i = 0; i < 10_000; i++) if (rollDeath(state, rng) !== null) deaths++;
    expect(deaths).toBeLessThan(10);
  });

  it('calls a natural death of a healthy 85-year-old "oldAge" and of a 30-year-old "illness"', () => {
    const old = makeState({ ageInMonths: 85 * 12, condition: { physicalHealth: 60 } });
    const young = makeState({ ageInMonths: 30 * 12, condition: { physicalHealth: 60 } });
    // Force a natural death with a hazard of 1 by using an RNG whose first draw is ~0.
    const zeroRng = { next: () => 0, int: () => 0, chance: () => true, pick: <T,>(a: readonly T[]) => a[0]!, state: 0 };
    expect(rollDeath(old, zeroRng)).toBe('oldAge');
    expect(rollDeath(young, zeroRng)).toBe('illness');
  });

  it('is deterministic for the same RNG state', () => {
    const state = makeState({ ageInMonths: 95 * 12, condition: { physicalHealth: 30 } });
    const results = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 50 }, () => rollDeath(state, rng));
    };
    expect(results(77)).toEqual(results(77));
  });
});
