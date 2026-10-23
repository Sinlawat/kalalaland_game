import { describe, expect, it } from 'vitest';
import { simulateWholeLife } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import type { GameState, YearSummary } from '../engine/types';
import { buildTimeline, countEntries, splitRecent, withoutTraitChips, type TimelineYear } from './timeline';

type Source = Pick<GameState, 'eventHistory' | 'history' | 'yearLog' | 'birthMonth'>;

function year(age: number, changes: YearSummary['changes'] = {}): YearSummary {
  return { age, changes, snapshot: { physicalHealth: 0, mentalHealth: 0, knowledge: 0, looks: 0 } };
}

describe('buildTimeline', () => {
  it('groups by year of age, newest first everywhere: newest year on top, and newest event on top within a year', () => {
    const state: Source = {
      birthMonth: 1,
      eventHistory: [
        { id: 'a', ageInMonths: 1 },
        { id: 'b', ageInMonths: 65 },
        { id: 'c', ageInMonths: 70 },
      ],
      history: [year(1), year(6)],
      yearLog: {},
    };
    expect(buildTimeline(state).map((y) => [y.age, y.entries.map((e) => e.id)])).toEqual([
      [5, ['c', 'b']],
      [0, ['a']],
    ]);
  });

  it('attaches the REAL logged effects of the event, from the summary year it happened in', () => {
    const state: Source = {
      birthMonth: 1,
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
      birthMonth: 1,
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
      birthMonth: 1,
      eventHistory: [{ id: 'tiny', ageInMonths: 5 }],
      history: [year(1, { mentalHealth: { 'event.tiny': 0.01 } })],
      yearLog: {},
    };
    expect(buildTimeline(state)[0]!.entries[0]!.effects).toEqual([]);
  });

  it('uses the running year log for events after the last closed year', () => {
    const state: Source = {
      birthMonth: 1,
      eventHistory: [{ id: 'now', ageInMonths: 14 }],
      history: [year(1)],
      yearLog: { physicalHealth: { 'event.now': 2 } },
    };
    expect(buildTimeline(state)[0]!.entries[0]!.effects).toEqual([{ target: 'physicalHealth', amount: 2 }]);
  });

  it('shows an event with choices with the choice made, its trait changes and habit changes', () => {
    const state: Source = {
      birthMonth: 1,
      eventHistory: [
        {
          id: 'club',
          ageInMonths: 150,
          choiceId: 'sports',
          traitChanges: { discipline: 4 },
          habitChanges: { exercise: 'regular' },
        },
      ],
      history: [year(12)],
      yearLog: { physicalHealth: { 'event.club': 1 } },
    };
    expect(buildTimeline(state)[0]!.entries[0]).toEqual({
      key: 'club:sports',
      id: 'club',
      choiceId: 'sports',
      habitChanges: { exercise: 'regular' },
      ageInMonths: 150,
      calendarMonth: 7, // born in January: month of life 150 → July
      count: 1,
      effects: [
        { target: 'physicalHealth', amount: 1 },
        { target: 'discipline', amount: 4 },
      ],
    });
  });

  it('shows environment changes as chips after stats and traits', () => {
    const state: Source = {
      birthMonth: 1,
      eventHistory: [{ id: 'jobloss', ageInMonths: 100, traitChanges: { discipline: 1 }, environmentChanges: { familyWealth: -10 } }],
      history: [],
      yearLog: { mentalHealth: { 'event.jobloss': -3 } },
    };
    expect(buildTimeline(state)[0]!.entries[0]!.effects).toEqual([
      { target: 'mentalHealth', amount: -3 },
      { target: 'discipline', amount: 1 },
      { target: 'familyWealth', amount: -10 },
    ]);
  });

  it('places a repeat right after itself by its LATEST occurrence, with that month', () => {
    const state: Source = {
      birthMonth: 3,
      eventHistory: [
        { id: 'trip', ageInMonths: 61 },
        { id: 'flu', ageInMonths: 63 },
        { id: 'flu', ageInMonths: 66 },
      ],
      history: [],
      yearLog: {},
    };
    const entries = buildTimeline(state)[0]!.entries;
    expect(entries.map((e) => [e.id, e.count, e.ageInMonths, e.calendarMonth])).toEqual([
      ['flu', 2, 66, 9], // born in March: month of life 66 → September
      ['trip', 1, 61, 4],
    ]);
  });

  it('keeps occurrences apart when other events came in between (the story order stays true)', () => {
    const state: Source = {
      birthMonth: 1,
      eventHistory: [
        { id: 'new_job', ageInMonths: 85 },
        { id: 'lost_job', ageInMonths: 88 },
        { id: 'new_job', ageInMonths: 94 },
      ],
      history: [],
      yearLog: {},
    };
    const entries = buildTimeline(state)[0]!.entries;
    expect(entries.map((e) => [e.key, e.count])).toEqual([
      ['new_job@2', 1],
      ['lost_job', 1],
      ['new_job', 1],
    ]);
  });

  it('within one month, the event recorded later comes first', () => {
    const state: Source = {
      birthMonth: 1,
      eventHistory: [
        { id: 'first', ageInMonths: 70 },
        { id: 'second', ageInMonths: 70 },
      ],
      history: [],
      yearLog: {},
    };
    expect(buildTimeline(state)[0]!.entries.map((e) => e.id)).toEqual(['second', 'first']);
  });

  it('keeps different choices of the same event apart', () => {
    const state: Source = {
      birthMonth: 1,
      eventHistory: [
        { id: 'offer', ageInMonths: 300, choiceId: 'yes' },
        { id: 'offer', ageInMonths: 305, choiceId: 'no' },
      ],
      history: [],
      yearLog: {},
    };
    expect(buildTimeline(state)[0]!.entries.map((e) => e.key)).toEqual(['offer:no', 'offer:yes']);
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

describe('withoutTraitChips (D35: traits secret before Grade 1)', () => {
  it('drops trait chips and keeps stats and family chips', () => {
    const years: TimelineYear[] = [
      {
        age: 2,
        entries: [
          {
            key: 'growth_self_care',
            id: 'growth_self_care',
            ageInMonths: 30,
            calendarMonth: 7,
            count: 1,
            effects: [
              { target: 'knowledge', amount: 1 },
              { target: 'discipline', amount: 2 },
              { target: 'familyWarmth', amount: 3 },
            ],
          },
        ],
      },
    ];
    expect(withoutTraitChips(years)[0]!.entries[0]!.effects.map((c) => c.target)).toEqual(['knowledge', 'familyWarmth']);
    expect(years[0]!.entries[0]!.effects).toHaveLength(3); // the input is not changed
  });
});

