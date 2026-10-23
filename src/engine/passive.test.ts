import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { computePassiveContributions, physicalSetPoint, traitFactor } from './passive';
import type { Contribution } from './stats';
import { makeState } from './testUtils';
import type { GameState, StatTarget } from './types';

function find(contributions: Contribution[], target: StatTarget, source: string): Contribution | undefined {
  return contributions.find((c) => c.target === target && c.source === source);
}

function yearly(contribution: Contribution | undefined): number {
  return (contribution?.amount ?? 0) * 12;
}

describe('physicalSetPoint', () => {
  it('stays at the young value until the decline age', () => {
    expect(physicalSetPoint(0)).toBe(BALANCE.physicalHealth.setPointYoung);
    expect(physicalSetPoint(25)).toBe(BALANCE.physicalHealth.setPointYoung);
  });

  it('declines linearly after that and never goes below the minimum', () => {
    expect(physicalSetPoint(35)).toBeCloseTo(85 - 10 * 0.6);
    expect(physicalSetPoint(500)).toBe(BALANCE.physicalHealth.setPointMin);
  });
});

describe('traitFactor', () => {
  it('maps 0 → min, 50 → middle, 100 → max', () => {
    expect(traitFactor(0, 0.6, 1.4)).toBeCloseTo(0.6);
    expect(traitFactor(50, 0.6, 1.4)).toBeCloseTo(1.0);
    expect(traitFactor(100, 0.6, 1.4)).toBeCloseTo(1.4);
  });
});

describe('computePassiveContributions', () => {
  it('does not mutate the state', () => {
    const state = makeState();
    const before = structuredClone(state);
    computePassiveContributions(state);
    expect(state).toEqual(before);
  });

  it('applies habit effects with the yearly balance values / 12', () => {
    const c = computePassiveContributions(makeState({ habits: { exercise: 'regular', sleep: 'short' } }));
    expect(yearly(find(c, 'physicalHealth', 'habit.exercise.regular'))).toBeCloseTo(2.5);
    expect(yearly(find(c, 'physicalHealth', 'habit.sleep.short'))).toBeCloseTo(-2);
  });

  it('ignores overtime and work stress while not working', () => {
    const c = computePassiveContributions(
      makeState({ habits: { overtime: 'heavy' }, environment: { workStress: 100 } }),
    );
    expect(find(c, 'physicalHealth', 'habit.overtime.heavy')).toBeUndefined();
    expect(find(c, 'mentalHealth', 'env.workStress')).toBeUndefined();
  });

  it('applies overtime and work stress while working', () => {
    const c = computePassiveContributions(
      makeState({ flags: ['working'], habits: { overtime: 'heavy' }, environment: { workStress: 100 } }),
    );
    expect(yearly(find(c, 'physicalHealth', 'habit.overtime.heavy'))).toBeCloseTo(-3);
    expect(yearly(find(c, 'mentalHealth', 'env.workStress'))).toBeCloseTo(-4);
  });

  it('drifts health toward the set point from both sides', () => {
    const below = computePassiveContributions(makeState({ condition: { physicalHealth: 40 } }));
    const above = computePassiveContributions(makeState({ condition: { physicalHealth: 100 } }));
    expect(find(below, 'physicalHealth', 'body.drift')!.amount).toBeGreaterThan(0);
    expect(find(above, 'physicalHealth', 'body.drift')!.amount).toBeLessThan(0);
  });

  describe('Resilience as a modifier', () => {
    const stressed = { flags: ['working'], environment: { workStress: 100 }, habits: { sleep: 'short' as const } };

    it('adds nothing when resilience is 0', () => {
      const c = computePassiveContributions(makeState({ ...stressed, traits: { resilience: 0 } }));
      expect(find(c, 'mentalHealth', 'trait.resilience')!.amount).toBe(0);
    });

    it('cancels half of the negative external effects at resilience 100, as its own log line', () => {
      const c = computePassiveContributions(makeState({ ...stressed, traits: { resilience: 100 } }));
      const negatives = c
        .filter((x) => x.target === 'mentalHealth' && x.source !== 'mind.drift' && x.amount < 0)
        .reduce((sum, x) => sum + x.amount, 0);
      expect(find(c, 'mentalHealth', 'trait.resilience')!.amount).toBeCloseTo(-negatives * 0.5);
    });

    it('does not soften the drift toward the set point', () => {
      const c = computePassiveContributions(
        makeState({ traits: { resilience: 100 }, condition: { mentalHealth: 100 }, environment: { familyWarmth: 50 } }),
      );
      // Only drift is negative here (light exercise and enough sleep are positive).
      expect(find(c, 'mentalHealth', 'mind.drift')!.amount).toBeLessThan(0);
      expect(find(c, 'mentalHealth', 'trait.resilience')!.amount).toBe(0);
    });
  });

  it('weights family warmth fully for children and half for adults', () => {
    const child = computePassiveContributions(makeState({ ageInMonths: 10 * 12, environment: { familyWarmth: 100 } }));
    const adult = computePassiveContributions(makeState({ ageInMonths: 30 * 12, environment: { familyWarmth: 100 } }));
    expect(yearly(find(child, 'mentalHealth', 'env.familyWarmth'))).toBeCloseTo(3);
    expect(yearly(find(adult, 'mentalHealth', 'env.familyWarmth'))).toBeCloseTo(1.5);
  });

  describe('skills (D65)', () => {
    const SKILLS = ['academic', 'creative', 'communication', 'practical'] as const;

    it('do not grow before the childhood start age', () => {
      const c = computePassiveContributions(makeState({ ageInMonths: 2 * 12 }));
      expect(c.filter((x) => (SKILLS as readonly string[]).includes(x.target))).toEqual([]);
    });

    it.each([
      ['academic', 'discipline', 2],
      ['creative', 'imagination', 1],
      ['communication', 'riskTaking', 1],
      ['practical', 'resilience', 1],
    ] as const)('%s grows %d a year in childhood, faster with high %s (its own line)', (skill, trait, base) => {
      const c = computePassiveContributions(makeState({ ageInMonths: 10 * 12, traits: { [trait]: 100 } }));
      expect(yearly(find(c, skill, 'life.growingUp'))).toBeCloseTo(base);
      expect(yearly(find(c, skill, `trait.${trait}.learning`))).toBeCloseTo(base * 0.4);
    });

    it('a low trait slows its skill down (factor 0.6 at 0)', () => {
      const c = computePassiveContributions(makeState({ ageInMonths: 10 * 12, traits: { imagination: 0 } }));
      expect(yearly(find(c, 'creative', 'trait.imagination.learning'))).toBeCloseTo(-0.4);
    });

    it('adults keep learning a little from life experience', () => {
      const c = computePassiveContributions(makeState({ ageInMonths: 30 * 12, traits: { discipline: 50 } }));
      expect(yearly(find(c, 'academic', 'life.experience'))).toBeCloseTo(0.2);
    });

    it('every skill declines slowly in old age', () => {
      const c = computePassiveContributions(makeState({ ageInMonths: 70 * 12 }));
      for (const skill of SKILLS) expect(yearly(find(c, skill, 'body.aging'))).toBeCloseTo(-0.3);
    });
  });

  describe('early childhood (before Grade 1, age 6)', () => {
    const toddler = (familyWarmth: number, habits: Partial<GameState['habits']> = {}) =>
      computePassiveContributions(makeState({ ageInMonths: 3 * 12, environment: { familyWarmth }, habits }));

    it('has no movement effect for babies (under 2), only family-driven sleep', () => {
      const baby = computePassiveContributions(makeState({ ageInMonths: 12 }));
      expect(find(baby, 'physicalHealth', 'child.play')).toBeUndefined();
      expect(find(baby, 'mentalHealth', 'child.play')).toBeUndefined();
      expect(find(baby, 'physicalHealth', 'child.sleep')).toBeDefined();
    });

    it('starts normal play exactly at 2 years', () => {
      const before = computePassiveContributions(makeState({ ageInMonths: 2 * 12 - 1 }));
      const at = computePassiveContributions(makeState({ ageInMonths: 2 * 12 }));
      expect(find(before, 'physicalHealth', 'child.play')).toBeUndefined();
      expect(find(at, 'physicalHealth', 'child.play')).toBeDefined();
    });

    it('ignores the stored habits and uses play + family-driven sleep instead', () => {
      const c = toddler(50, { exercise: 'none', sleep: 'short' });
      expect(c.some((x) => x.source.startsWith('habit.'))).toBe(false);
      expect(yearly(find(c, 'physicalHealth', 'child.play'))).toBeCloseTo(1); // 'light' exercise value
    });

    it.each([
      [0, -2], // no care at all → like 'short' sleep
      [25, -0.75], // halfway between short (−2) and enough (+0.5)
      [50, 0.5], // average family → 'enough'
      [100, 0.5], // capped at 'enough'
    ])('family warmth %i → physical sleep effect %d per year', (warmth, expected) => {
      expect(yearly(find(toddler(warmth), 'physicalHealth', 'child.sleep'))).toBeCloseTo(expected);
    });

    it('uses the mental-health table for the mental sleep effect', () => {
      expect(yearly(find(toddler(0), 'mentalHealth', 'child.sleep'))).toBeCloseTo(-2);
      expect(yearly(find(toddler(50), 'mentalHealth', 'child.sleep'))).toBeCloseTo(1);
    });

    it('gives no looks bonus for regular exercise before age 6', () => {
      expect(toddler(50, { exercise: 'regular' }).filter((x) => x.target === 'looks')).toEqual([]);
    });

    it('switches to the chosen habits exactly at 6 years', () => {
      const before = computePassiveContributions(makeState({ ageInMonths: 6 * 12 - 1 }));
      const at = computePassiveContributions(makeState({ ageInMonths: 6 * 12 }));
      expect(find(before, 'physicalHealth', 'child.sleep')).toBeDefined();
      expect(find(at, 'physicalHealth', 'habit.sleep.enough')).toBeDefined();
      expect(find(at, 'physicalHealth', 'child.sleep')).toBeUndefined();
    });
  });

  it('ages looks only after 35 and rewards regular exercise', () => {
    const young = computePassiveContributions(makeState({ ageInMonths: 20 * 12, habits: { exercise: 'light' } }));
    const older = computePassiveContributions(makeState({ ageInMonths: 50 * 12, habits: { exercise: 'regular' } }));
    expect(young.filter((x) => x.target === 'looks')).toEqual([]);
    expect(yearly(find(older, 'looks', 'body.aging'))).toBeCloseTo(-0.4);
    expect(yearly(find(older, 'looks', 'habit.exercise.regular'))).toBeCloseTo(0.3);
  });
});
