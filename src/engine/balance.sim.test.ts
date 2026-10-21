/**
 * Balance test (Monte Carlo) — design doc section 16.
 *
 * Unit tests prove the formulas do what the code says. This test asks a
 * different question: do the formulas, together, produce believable lives?
 * It runs many lives with fixed seeds and checks ranges, so a balance change
 * that makes everyone die at 40 (or live to 150) fails loudly.
 *
 * Two kinds of checks:
 * - Guard rails (wide): believable lifespans for everyone.
 * - Agreed targets (D36): what a lifetime of bad habits should cost.
 */

import { describe, expect, it } from 'vitest';
import { simulateWholeLife } from './game';
import { createNewLife } from './newLife';
import type { DeathCause, GameState, Habits } from './types';

const LIVES = 1_000;

interface LifeStats {
  lifespans: number[];
  causes: Record<DeathCause, number>;
  /** Physical health of the survivors at the given birthday. */
  healthAt(age: number): number[];
}

/**
 * Habits are set at birth, but the engine ignores them until Grade 1 (D34),
 * so this is the same as the player choosing them at age 6 and never changing.
 */
function runLives(habits?: Pick<Habits, 'exercise' | 'sleep'>): LifeStats {
  const ends: GameState[] = [];
  const causes: Record<DeathCause, number> = { illness: 0, oldAge: 0, accident: 0 };
  for (let seed = 0; seed < LIVES; seed++) {
    const life = createNewLife(seed);
    if (habits) life.habits = { ...life.habits, ...habits };
    const end = simulateWholeLife(life);
    ends.push(end);
    causes[end.death!.cause] += 1;
  }
  return {
    lifespans: ends.map((end) => end.ageInMonths / 12).sort((a, b) => a - b),
    causes,
    healthAt: (age) =>
      ends
        .map((end) => end.history.find((year) => year.age === age))
        .filter((year) => year !== undefined)
        .map((year) => year.snapshot.physicalHealth),
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe('Monte Carlo guard rails (default habits)', () => {
  const stats = runLives();

  it('has a believable median lifespan', () => {
    const median = percentile(stats.lifespans, 0.5);
    expect(median).toBeGreaterThan(65);
    expect(median).toBeLessThan(88);
  });

  it('rarely kills characters before age 10', () => {
    const early = stats.lifespans.filter((age) => age < 10).length;
    expect(early / LIVES).toBeLessThan(0.03);
  });

  it('nobody lives absurdly long', () => {
    expect(stats.lifespans.at(-1)!).toBeLessThan(115);
  });

  it('every cause of death actually happens', () => {
    expect(stats.causes.illness).toBeGreaterThan(0);
    expect(stats.causes.oldAge).toBeGreaterThan(0);
    expect(stats.causes.accident).toBeGreaterThan(0);
  });
});

describe('Monte Carlo targets for a lifetime of bad habits (D36)', () => {
  const bad = runLives({ exercise: 'none', sleep: 'short' });
  const good = runLives({ exercise: 'regular', sleep: 'enough' });

  it('physical health at 40 is clearly lower: average 45–55', () => {
    const average = mean(bad.healthAt(40));
    expect(average).toBeGreaterThanOrEqual(45);
    expect(average).toBeLessThanOrEqual(55);
  });

  it('physical health at 70 is poor: average 20–35', () => {
    const average = mean(bad.healthAt(70));
    expect(average).toBeGreaterThanOrEqual(20);
    expect(average).toBeLessThanOrEqual(35);
  });

  it('costs 8–12 years of life on average compared with good habits', () => {
    const gap = mean(good.lifespans) - mean(bad.lifespans);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(12);
  });
});
