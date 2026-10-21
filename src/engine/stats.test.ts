import { describe, expect, it } from 'vitest';
import { applyContributions, clampStat } from './stats';
import { makeState } from './testUtils';

describe('clampStat', () => {
  it.each([
    [-5, 0],
    [0, 0],
    [42.5, 42.5],
    [100, 100],
    [130, 100],
  ])('clamps %d to %d', (input, expected) => {
    expect(clampStat(input)).toBe(expected);
  });

  it('throws on NaN instead of hiding a broken calculation', () => {
    expect(() => clampStat(Number.NaN)).toThrow();
  });
});

describe('applyContributions', () => {
  it('adds amounts to the right stats and logs them by source', () => {
    const state = makeState({ condition: { mentalHealth: 50 }, outcome: { looks: 40 } });
    applyContributions(state, [
      { target: 'mentalHealth', source: 'a', amount: 2 },
      { target: 'mentalHealth', source: 'b', amount: -1 },
      { target: 'looks', source: 'a', amount: 0.5 },
    ]);
    expect(state.condition.mentalHealth).toBe(51);
    expect(state.outcome.looks).toBe(40.5);
    expect(state.yearLog).toEqual({ mentalHealth: { a: 2, b: -1 }, looks: { a: 0.5 } });
  });

  it('sums repeated sources across months', () => {
    const state = makeState();
    applyContributions(state, [{ target: 'knowledge', source: 'x', amount: 1 }]);
    applyContributions(state, [{ target: 'knowledge', source: 'x', amount: 1 }]);
    expect(state.yearLog.knowledge).toEqual({ x: 2 });
  });

  it('logs only the part of a change that was actually applied at the cap', () => {
    const state = makeState({ condition: { physicalHealth: 99 } });
    applyContributions(state, [{ target: 'physicalHealth', source: 'gym', amount: 3 }]);
    expect(state.condition.physicalHealth).toBe(100);
    expect(state.yearLog.physicalHealth).toEqual({ gym: 1 });
  });

  it('does not log anything when the stat is already at the floor', () => {
    const state = makeState({ condition: { mentalHealth: 0 } });
    applyContributions(state, [{ target: 'mentalHealth', source: 'stress', amount: -2 }]);
    expect(state.condition.mentalHealth).toBe(0);
    expect(state.yearLog.mentalHealth).toBeUndefined();
  });

  it('skips zero contributions', () => {
    const state = makeState();
    applyContributions(state, [{ target: 'knowledge', source: 'nothing', amount: 0 }]);
    expect(state.yearLog).toEqual({});
  });
});
