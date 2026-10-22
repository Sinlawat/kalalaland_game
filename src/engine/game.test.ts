import { describe, expect, it } from 'vitest';
import { setHabit } from '../actions/habits';
import { advanceOneMonth, advanceUntilStop, simulateWholeLife } from './game';
import { createNewLife } from './newLife';
import type { GameState, StatTarget } from './types';

function statValue(state: GameState, target: StatTarget): number {
  return target === 'looks' ? state.outcome.looks : state.condition[target];
}

describe('advanceUntilStop', () => {
  it('does not mutate the state it receives', () => {
    const life = createNewLife(3);
    const before = structuredClone(life);
    advanceUntilStop(life);
    expect(life).toEqual(before);
  });

  it('stops at the first birthday after exactly 12 months', () => {
    const result = advanceUntilStop(createNewLife(3));
    expect(result.stop).toBe('yearEnd');
    expect(result.monthsAdvanced).toBe(12);
    expect(result.state.ageInMonths).toBe(12);
    expect(result.state.history).toHaveLength(1);
    expect(result.state.history[0]!.age).toBe(1);
    expect(result.state.yearLog).toEqual({});
  });

  it('gives the same life for the same seed (determinism)', () => {
    const play = (): GameState => {
      let state = createNewLife(99);
      for (let i = 0; i < 30 && state.death === null; i++) state = advanceUntilStop(state).state;
      return state;
    };
    expect(play()).toEqual(play());
  });

  it('continues identically after a JSON save/load round trip', () => {
    let state = createNewLife(8);
    for (let i = 0; i < 5; i++) state = advanceUntilStop(state).state;
    const reloaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(advanceUntilStop(reloaded).state).toEqual(advanceUntilStop(state).state);
  });

  it('refuses to advance a dead character', () => {
    const dead = simulateWholeLife(createNewLife(4));
    expect(() => advanceUntilStop(dead)).toThrow();
  });
});

describe('yearly summary invariant', () => {
  it('the logged changes of a year add up to the real change of each stat', () => {
    // This is what the player trusts: "health −4: stress −2, ..." must equal the real −4.
    let state = createNewLife(11);
    for (let year = 0; year < 40 && state.death === null; year++) {
      const before = structuredClone(state);
      state = advanceUntilStop(state).state;
      const summary = state.history.at(-1)!;
      for (const target of ['physicalHealth', 'mentalHealth', 'knowledge', 'looks'] as const) {
        const logged = Object.values(summary.changes[target] ?? {}).reduce((sum, value) => sum + value, 0);
        const real = statValue(state, target) - statValue(before, target);
        expect(logged).toBeCloseTo(real, 9);
      }
    }
  });
});

describe('simulateWholeLife', () => {
  it('always ends in death with a known cause and a history entry per year', () => {
    for (let seed = 0; seed < 20; seed++) {
      const end = simulateWholeLife(createNewLife(seed));
      expect(end.death).not.toBeNull();
      expect(['illness', 'oldAge', 'accident']).toContain(end.death!.cause);
      expect(end.history).toHaveLength(Math.ceil(end.ageInMonths / 12));
    }
  });
});

describe('advanceOneMonth (real-time runner, D38)', () => {
  it('moves exactly one month and does not mutate the input', () => {
    const life = createNewLife(3);
    const before = structuredClone(life);
    const result = advanceOneMonth(life);
    expect(result.state.ageInMonths).toBe(1);
    expect(result.stop).toBeNull();
    expect(life).toEqual(before);
  });

  it('reports the birthday on the 12th month', () => {
    let state = createNewLife(3);
    const stops = [];
    for (let i = 0; i < 12; i++) {
      const result = advanceOneMonth(state);
      stops.push(result.stop);
      state = result.state;
    }
    expect(stops).toEqual([...Array(11).fill(null), 'yearEnd']);
  });

  it('gives the same life as advancing a year at a time', () => {
    let byMonth = createNewLife(42);
    let byYear = createNewLife(42);
    for (let year = 0; year < 10; year++) {
      byYear = advanceUntilStop(byYear).state;
      for (let m = 0; m < 12; m++) byMonth = advanceOneMonth(byMonth).state;
    }
    expect(byMonth).toEqual(byYear);
  });
});

describe('habits per month (D38)', () => {
  it('records the habits in effect each month and closes them into the year', () => {
    let state = { ...createNewLife(5), ageInMonths: 6 * 12 };
    state = advanceOneMonth(state).state;
    state = advanceOneMonth(setHabit(state, 'exercise', 'regular')).state;
    expect(state.yearHabits.map((h) => h.exercise)).toEqual(['light', 'regular']);

    state = advanceUntilStop(state).state; // to the birthday
    const closed = state.history.at(-1)!;
    expect(closed.habits).toHaveLength(12);
    expect(closed.habits!.slice(0, 2).map((h) => h.exercise)).toEqual(['light', 'regular']);
    expect(state.yearHabits).toEqual([]);
  });
});
