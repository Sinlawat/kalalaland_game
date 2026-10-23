import { describe, expect, it } from 'vitest';
import { findEvent } from '../engine/events';
import { advanceOneMonth, firstAvailableChoice, resolveChoice } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import type { EnvironmentKey, GameState, YearSummary } from '../engine/types';
import { newEventChanges } from './eventFlash';

type Source = Pick<GameState, 'seed' | 'eventHistory' | 'history' | 'yearLog' | 'birthMonth'>;

function year(age: number, changes: YearSummary['changes'] = {}): YearSummary {
  return { age, changes, snapshot: { physicalHealth: 0, mentalHealth: 0, knowledge: 0, looks: 0 } };
}

const before: Source = { seed: 1, birthMonth: 1, eventHistory: [{ id: 'old', ageInMonths: 3 }], history: [], yearLog: { knowledge: { 'event.old': 2 } } };

describe('newEventChanges', () => {
  it('reports the real effect of an event recorded since the last render', () => {
    const after: Source = {
      ...before,
      eventHistory: [...before.eventHistory, { id: 'book', ageInMonths: 5, traitChanges: { discipline: 1.5 } }],
      yearLog: { knowledge: { 'event.old': 2, 'event.book': 3 }, mentalHealth: { 'event.book': -1 } },
    };
    expect(newEventChanges(before, after)).toEqual({ knowledge: 3, mentalHealth: -1, discipline: 1.5 });
  });

  it('includes family values (environment) changed by an event', () => {
    const after: Source = {
      ...before,
      eventHistory: [...before.eventHistory, { id: 'job', ageInMonths: 5, environmentChanges: { familyWealth: -10 } }],
    };
    expect(newEventChanges(before, after)).toEqual({ familyWealth: -10 });
  });

  it('sums several new events (fast speed: several months between two renders)', () => {
    const after: Source = {
      ...before,
      eventHistory: [...before.eventHistory, { id: 'a', ageInMonths: 4 }, { id: 'b', ageInMonths: 5 }],
      yearLog: { knowledge: { 'event.old': 2, 'event.a': 3, 'event.b': -1 } },
    };
    expect(newEventChanges(before, after)).toEqual({ knowledge: 2 });
  });

  it('finds the effect in history when the event month was also the birthday (year closed)', () => {
    const after: Source = {
      ...before,
      eventHistory: [...before.eventHistory, { id: 'gift', ageInMonths: 12 }],
      history: [year(1, { looks: { 'event.gift': 2 } })],
      yearLog: {},
    };
    expect(newEventChanges(before, after)).toEqual({ looks: 2 });
  });

  it.each([
    ['no previous render (a save was just loaded)', undefined, before],
    ['nothing new', before, before],
    ['a different life (new seed)', before, { ...before, seed: 2 }],
    ['a different life with the same seed (replay)', before, { ...before, eventHistory: [{ id: 'other', ageInMonths: 3 }] }],
    ['a shorter history (older save loaded)', before, { ...before, eventHistory: [] }],
  ])('reports nothing for %s', (_case, previous, next) => {
    expect(newEventChanges(previous, next)).toEqual({});
  });

  it('ignores an event with no visible effect (only habits, or clamped to 0)', () => {
    const after: Source = {
      ...before,
      eventHistory: [...before.eventHistory, { id: 'rule', ageInMonths: 5, habitChanges: { sleep: 'enough' } }],
      yearLog: { knowledge: { 'event.old': 2, 'event.rule': 0.01 } },
    };
    expect(newEventChanges(before, after)).toEqual({});
  });
});

describe('newEventChanges with the real engine', () => {
  /** Every state the screen would show, in order: each month, and each answered choice. */
  function renders(seed: number, months: number): GameState[] {
    const states: GameState[] = [];
    let state = createNewLife(seed);
    for (let i = 0; i < months && state.death === null; i++) {
      let result = advanceOneMonth(state);
      states.push(result.state);
      while (result.stop === 'choice') {
        const event = findEvent(result.state.pendingChoices[0]!.eventId)!;
        result = resolveChoice(result.state, firstAvailableChoice(result.state, event));
        states.push(result.state);
      }
      state = result.state;
    }
    return states;
  }

  it('flashes knowledge in the SAME month the event raises it (the case a player reported)', () => {
    // Seed 26: an event at month 15 raises knowledge from 0 to 3; the ▲ only shows it at month 24.
    const states = renders(26, 15);
    const eventMonth = states.findIndex((s) => s.ageInMonths === 15);
    expect(newEventChanges(states[eventMonth - 1], states[eventMonth]!).knowledge).toBeCloseTo(3, 5);
  });

  it('always matches what events did to the family values (nothing else changes them)', () => {
    const keys: EnvironmentKey[] = ['familyWealth', 'familyWarmth'];
    for (const seed of [1, 7, 26, 99]) {
      const states = renders(seed, 18 * 12);
      for (let i = 1; i < states.length; i++) {
        const previous = states[i - 1]!;
        const next = states[i]!;
        const flash = newEventChanges(previous, next);
        for (const key of keys) {
          expect(flash[key] ?? 0).toBeCloseTo(next.environment[key] - previous.environment[key], 5);
        }
      }
    }
  });
});
