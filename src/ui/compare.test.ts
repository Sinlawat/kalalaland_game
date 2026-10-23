import { describe, expect, it } from 'vitest';
import { simulateWholeLife } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import { makeState } from '../engine/testUtils';
import type { LifeSnapshot, YearSummary } from '../engine/types';
import { compareGroups, comparePoints, formatDiff } from './compare';

function snap(values: Partial<LifeSnapshot> = {}): LifeSnapshot {
  return { physicalHealth: 70, mentalHealth: 70, knowledge: 50, looks: 50, ...values };
}
function year(age: number, snapshot: LifeSnapshot): YearSummary {
  return { age, changes: {}, snapshot };
}

describe('comparePoints', () => {
  it('lists birthdays newest first, then birth', () => {
    const state = makeState({
      history: [year(1, snap()), year(2, snap())],
      birthSnapshot: snap({ knowledge: 0 }),
    });
    expect(comparePoints(state).map((p) => [p.id, p.label, p.shortLabel])).toEqual([
      ['age-2', 'วันเกิดอายุ 2 ปี', 'อายุ 2 ปี'],
      ['age-1', 'วันเกิดอายุ 1 ปี', 'อายุ 1 ปี'],
      ['birth', 'ตอนเกิด', 'ตอนเกิด'],
    ]);
  });

  it('leaves out the final partial year of a life that ended, and birth when the save lacks it', () => {
    const { birthSnapshot: _birth, ...old } = makeState({ history: [year(1, snap()), year(1.5, snap())] });
    expect(comparePoints(old).map((p) => p.id)).toEqual(['age-1']);
  });

  it('is empty before the first birthday of a save without birth values', () => {
    const { birthSnapshot: _birth, ...old } = makeState({ history: [] });
    expect(comparePoints(old)).toEqual([]);
  });
});

describe('compareGroups', () => {
  const then = snap({
    physicalHealth: 80.4,
    knowledge: 26.6,
    looks: 42,
    traits: { discipline: 68, resilience: 50, riskTaking: 22 },
    environment: { familyWealth: 36, familyWarmth: 80, workStress: 0, financialStress: 0 },
  });

  it('compares the ROUNDED values the player sees, so the numbers add up on screen', () => {
    const state = makeState({ ageInMonths: 119, condition: { physicalHealth: 81.6, knowledge: 30.4 } });
    const condition = compareGroups(state, then).find((g) => g.key === 'condition')!;
    expect(condition.rows.find((r) => r.key === 'physicalHealth')).toMatchObject({ then: 80, now: 82, diff: 2 });
    expect(condition.rows.find((r) => r.key === 'knowledge')).toMatchObject({ then: 27, now: 30, diff: 3 });
  });

  it('groups like the cards: condition, looks, traits, family environment', () => {
    const state = makeState({ ageInMonths: 119, environment: { familyWealth: 26, familyWarmth: 80 } });
    const groups = compareGroups(state, then);
    expect(groups.map((g) => g.key)).toEqual(['condition', 'outcome', 'traits', 'environment']);
    expect(groups.at(-1)!.rows.map((r) => [r.key, r.diff])).toEqual([
      ['familyWealth', -10],
      ['familyWarmth', 0],
    ]);
  });

  it('hides traits before Grade 1 (D35)', () => {
    const groups = compareGroups(makeState({ ageInMonths: 30 }), then);
    expect(groups.map((g) => g.key)).not.toContain('traits');
  });

  it('shows no "then" and no difference for values a year closed before save version 7 did not keep', () => {
    const old = snap(); // no traits, no environment
    const groups = compareGroups(makeState({ ageInMonths: 119 }), old);
    const wealth = groups.find((g) => g.key === 'environment')!.rows[0]!;
    expect(wealth.then).toBeUndefined();
    expect(wealth.diff).toBeUndefined();
  });

  it('matches the real birthday snapshots of a simulated life', () => {
    const life = simulateWholeLife(createNewLife(26));
    const ten = life.history.find((y) => y.age === 10)!;
    expect(ten.snapshot.traits).toBeDefined();
    expect(ten.snapshot.environment).toBeDefined();
  });
});

describe('formatDiff', () => {
  it.each([
    [3, '+3'],
    [-2, '−2'],
    [0, '0'],
  ])('%i → %s', (diff, text) => {
    expect(formatDiff(diff)).toBe(text);
  });
});
