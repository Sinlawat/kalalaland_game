import { describe, expect, it } from 'vitest';
import { simulateWholeLife } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import type { GameState, YearSummary } from '../engine/types';
import { buildTimeline, countEntries, splitRecent, type TimelineYear } from './timeline';

type Source = Pick<GameState, 'eventHistory' | 'history' | 'yearLog'>;

function year(age: number, changes: YearSummary['changes'] = {}): YearSummary {
  return { age, changes, snapshot: { physicalHealth: 0, mentalHealth: 0, knowledge: 0, looks: 0 } };
}

describe('buildTimeline', () => {
  it('groups by year of age, newest year first, events in order within a year', () => {
    const state: Source = {
      eventHistory: [
        { id: 'a', ageInMonths: 1 },
        { id: 'b', ageInMonths: 65 },
        { id: 'c', ageInMonths: 70 },
      ],
      history: [year(1), year(6)],
      yearLog: {},
    };
    expect(buildTimeline(state).map((y) => [y.age, y.entries.map((e) => e.id)])).toEqual([
      [5, ['b', 'c']],
      [0, ['a']],
    ]);
  });

  it('attaches the REAL logged effects of the event, from the summary year it happened in', () => {
    const state: Source = {
      eventHistory: [{ id: 'pox', ageInMonths: 65 }],
      // months 61–72 close at age 6
      history: [year(5), year(6, { physicalHealth: { 'event.pox': -4, 'habit.sleep.enough': 0.5 }, knowledge: { 'event.pox': -1 } })],
      yearLog: {},
    };
    expect(buildTimeline(state)[0]!.entries[0]!.effects).toEqual([
      { target: 'physicalHealth', amount: -4 },
      { target: 'knowledge', amount: -1 },
    ]);
  });

  it('merges a repeatable event that happened twice in one year of age, with a count', () => {
    const state: Source = {
      eventHistory: [
        { id: 'flu', ageInMonths: 100 },
        { id: 'flu', ageInMonths: 104 },
      ],
      history: [year(9, { physicalHealth: { 'event.flu': -6 } })],
      yearLog: {},
    };
    const entry = buildTimeline(state)[0]!.entries[0]!;
    expect(entry.count).toBe(2);
    expect(entry.effects).toEqual([{ target: 'physicalHealth', amount: -6 }]);
  });

  it('hides effects too small to show', () => {
    const state: Source = {
      eventHistory: [{ id: 'tiny', ageInMonths: 5 }],
      history: [year(1, { mentalHealth: { 'event.tiny': 0.01 } })],
      yearLog: {},
    };
    expect(buildTimeline(state)[0]!.entries[0]!.effects).toEqual([]);
  });

  it('uses the running year log for events after the last closed year', () => {
    const state: Source = {
      eventHistory: [{ id: 'now', ageInMonths: 14 }],
      history: [year(1)],
      yearLog: { physicalHealth: { 'event.now': 2 } },
    };
    expect(buildTimeline(state)[0]!.entries[0]!.effects).toEqual([{ target: 'physicalHealth', amount: 2 }]);
  });

  it('matches the event history of real lives (every event appears once in the timeline)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const end = simulateWholeLife(createNewLife(seed));
      expect(countEntries(buildTimeline(end))).toBe(end.eventHistory.length);
    }
  });
});

describe('splitRecent', () => {
  const timeline: TimelineYear[] = [9, 8, 4, 3, 0].map((age) => ({ age, entries: [] }));

  it('keeps the last 5 years of age (at 8 years old: ages 4–8) as recent', () => {
    const { recent, older } = splitRecent(timeline, 8 * 12);
    expect(recent.map((y) => y.age)).toEqual([9, 8, 4]);
    expect(older.map((y) => y.age)).toEqual([3, 0]);
  });

  it('has nothing older while the character is young', () => {
    expect(splitRecent(timeline, 2 * 12).older).toEqual([]);
  });
});
