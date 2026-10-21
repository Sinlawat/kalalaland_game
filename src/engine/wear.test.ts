import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { computePassiveContributions, physicalDriftRate } from './passive';
import { makeState } from './testUtils';
import { applyMonthlyWear, yearlyWearChange } from './wear';

const { gainFactor, healFactor } = BALANCE.wear;

describe('yearlyWearChange', () => {
  it('gains wear from unhealthy habits: (1 + 2) × gainFactor', () => {
    const state = makeState({ habits: { exercise: 'none', sleep: 'short' } });
    expect(yearlyWearChange(state)).toBeCloseTo(3 * gainFactor);
  });

  it('heals slowly with healthy habits: (2.5 + 0.5) × healFactor', () => {
    const state = makeState({ habits: { exercise: 'regular', sleep: 'enough' } });
    expect(yearlyWearChange(state)).toBeCloseTo(-3 * healFactor);
  });

  it('heals much more slowly than it gains (damage takes longer to undo)', () => {
    const bad = yearlyWearChange(makeState({ habits: { exercise: 'none', sleep: 'short' } }));
    const good = yearlyWearChange(makeState({ habits: { exercise: 'regular', sleep: 'enough' } }));
    expect(bad).toBeGreaterThan(Math.abs(good));
  });

  it('counts stress as damage', () => {
    const calm = yearlyWearChange(makeState());
    const stressed = yearlyWearChange(makeState({ environment: { financialStress: 100 } }));
    expect(stressed).toBeGreaterThan(calm);
  });
});

describe('applyMonthlyWear', () => {
  it('adds one twelfth of the yearly change', () => {
    const state = makeState({ hidden: { physicalWear: 10 } });
    applyMonthlyWear(state, 1.2);
    expect(state.hidden.physicalWear).toBeCloseTo(10.1);
  });

  it('never goes below 0 or above the maximum', () => {
    const low = makeState({ hidden: { physicalWear: 0.01 } });
    applyMonthlyWear(low, -12);
    expect(low.hidden.physicalWear).toBe(0);

    const high = makeState({ hidden: { physicalWear: BALANCE.wear.max } });
    applyMonthlyWear(high, 12);
    expect(high.hidden.physicalWear).toBe(BALANCE.wear.max);
  });
});

describe('wear in the monthly contributions', () => {
  it('shows as its own log line: −driftRate × wear', () => {
    const state = makeState({ ageInMonths: 40 * 12, hidden: { physicalWear: 20 } });
    const line = computePassiveContributions(state).find((c) => c.source === 'body.wear')!;
    expect(line.amount * 12).toBeCloseTo(-physicalDriftRate(40) * 20);
  });

  it('is zero without wear', () => {
    const line = computePassiveContributions(makeState()).find((c) => c.source === 'body.wear')!;
    expect(line.amount).toBeCloseTo(0);
  });
});

describe('physicalDriftRate (recovery slows with age)', () => {
  it('is the young rate until the slowdown age', () => {
    expect(physicalDriftRate(10)).toBe(BALANCE.physicalHealth.driftRateYoung);
    expect(physicalDriftRate(30)).toBe(BALANCE.physicalHealth.driftRateYoung);
  });

  it('decreases after that, down to the minimum', () => {
    expect(physicalDriftRate(40)).toBeLessThan(physicalDriftRate(30));
    expect(physicalDriftRate(200)).toBe(BALANCE.physicalHealth.driftRateMin);
  });
});
