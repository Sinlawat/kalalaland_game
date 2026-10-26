import { describe, expect, it } from 'vitest';
import { hasMessage } from '../i18n/i18n';
import { BALANCE } from '../data/balance';
import {
  applyChoice,
  applyEvent,
  calendarMonth,
  EVENTS,
  findEvent,
  hasHappened,
  isEligible,
  lockReasons,
  chanceFactor,
  monthlyChance,
  windowChance,
  yearlyChance,
  lifetimeRoll,
  parseEvents,
  rollEvents,
  traitEffectFactor,
  type EventChoice,
  type EventDef,
} from './events';
import { advanceUntilStop, firstAvailableChoice, simulateWholeLife, type Chooser } from './game';
import { createNewLife } from './newLife';
import { createRng } from './rng';
import { makeState } from './testUtils';
import { SCHOOL_FLAGS, SCHOOL_IDS, type GameState } from './types';

/** A valid event to start from; each test changes only what it checks. */
function makeEvent(overrides: Partial<EventDef> = {}): EventDef {
  return {
    id: 'test_event',
    conditions: { ageMin: 10, ageMax: 20 },
    frequency: 'normal',
    once: false,
    effects: {},
    ...overrides,
  };
}

describe('parseEvents (data validation)', () => {
  it('accepts the real events.json', () => {
    expect(EVENTS.length).toBeGreaterThan(0);
  });

  it('accepts a ONCE event that pushes its own chanceBy value the same way (it cannot happen again)', () => {
    const divorce = { ...makeEvent({ once: true, chanceBy: [{ stat: 'familyWarmth', toward: 'low' }] }), effects: { environment: { familyWarmth: -10 } } };
    expect(() => parseEvents([divorce])).not.toThrow();
  });

  it('every real event has a Thai title and text, and every choice a label and a result', () => {
    const keys = EVENTS.flatMap((e) => [
      `event.${e.id}.title`,
      `event.${e.id}.text`,
      ...(e.choices ?? []).flatMap((c) => [
        `event.${e.id}.choice.${c.id}`,
        `event.${e.id}.result.${c.id}`,
        // A flag condition cannot explain itself: the writer must say why the choice is locked.
        ...(c.conditions?.flagsAll || c.conditions?.flagsAny || c.conditions?.flagsNone ? [`event.${e.id}.choice.${c.id}.locked`] : []),
      ]),
    ]);
    expect(keys.filter((k) => !hasMessage(k))).toEqual([]);
  });

  it('reports every problem at once', () => {
    const raw = [
      { ...makeEvent({ id: 'Bad-Id' }) },
      { ...makeEvent({ id: 'dup' }) },
      { ...makeEvent({ id: 'dup' }) },
      { ...makeEvent({ id: 'always', frequency: 'guaranteed', once: false }) },
      { ...makeEvent({ id: 'typo' }), wieght: 3 },
    ];
    let message = '';
    try {
      parseEvents(raw);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('id must be lowercase');
    expect(message).toContain('duplicate id');
    expect(message).toContain('guaranteed event must be once');
    expect(message).toContain('unknown field "wieght"');
  });

  it.each([
    ['ageMin above ageMax', { conditions: { ageMin: 9, ageMax: 3 } }, 'ageMin/ageMax'],
    ['unknown condition stat', { conditions: { ageMin: 0, ageMax: 1, stats: [{ stat: 'happiness', op: '>=', value: 1 }] } }, 'invalid stat condition'],
    ['month 13', { conditions: { ageMin: 0, ageMax: 1, months: [13] } }, 'months'],
    ['effect on unsupported stat', { effects: { stats: { wealth: 10 } } }, 'unsupported stat "wealth"'],
    ['flag nobody sets', { conditions: { ageMin: 0, ageMax: 1, flagsAll: ['never_set'] } }, 'no event or system ever sets it'],
    ['bad frequency', { frequency: 'sometimes' }, 'frequency must be one of'],
    ['empty flagsAny (could never be met)', { conditions: { ageMin: 0, ageMax: 1, flagsAny: [] } }, 'flagsAny must name at least one flag'],
    ['flagsAny on a flag nobody sets', { conditions: { ageMin: 0, ageMax: 1, flagsAny: ['never_set'] } }, 'no event or system ever sets it'],
    ['a repeatable window event', { frequency: 'window', once: false }, 'window event must be once'],
    ['a window event limited to months', { frequency: 'window', once: true, conditions: { ageMin: 0, ageMax: 1, months: [5] } }, 'cannot be limited to months'],
    ['chanceBy on a guaranteed event', { frequency: 'guaranteed', once: true, chanceBy: [{ stat: 'riskTaking', toward: 'low' }] }, 'chanceBy only works with a chance frequency'],
    ['chanceBy on an unknown value', { chanceBy: [{ stat: 'luck', toward: 'high' }] }, 'invalid chanceBy'],
    ['chanceBy with a bad direction', { chanceBy: [{ stat: 'riskTaking', toward: 'up' }] }, 'invalid chanceBy'],
    ['a repeatable event that feeds its own chance', { once: false, chanceBy: [{ stat: 'riskTaking', toward: 'high' }], effects: { traits: { riskTaking: 2 } } }, 'it would feed itself'],
    ['a choice that feeds its own chance', { once: false, effects: undefined, chanceBy: [{ stat: 'mentalHealth', toward: 'low' }], choices: [{ id: 'a', effects: { stats: { mentalHealth: -3 } } }, { id: 'b', effects: {} }] }, 'it would feed itself'],
    ['empty eventsNone', { conditions: { ageMin: 0, ageMax: 1, eventsNone: [] } }, 'eventsNone must be a non-empty list'],
    ['eventsNone naming a missing event', { conditions: { ageMin: 0, ageMax: 1, eventsNone: ['ghost'] } }, 'eventsNone names event "ghost"'],
    ['empty residence condition', { conditions: { ageMin: 0, ageMax: 1, residence: {} } }, 'must list regions, homes, or both'],
    ['unknown region in a condition', { conditions: { ageMin: 0, ageMax: 1, residence: { regions: ['moon'] } } }, 'unknown region "moon"'],
    ['empty home list', { conditions: { ageMin: 0, ageMax: 1, residence: { homes: [] } } }, 'residence.homes must be a non-empty list'],
    ['typo in a residence condition', { conditions: { ageMin: 0, ageMax: 1, residence: { region: ['rural'] } } }, 'unknown field "region"'],
    ['putting a child in a school without leaving every other one (D70)', { effects: { setFlags: ['school_top_public'], removeFlags: ['school_public'] } }, 'sets "school_top_public" but does not remove school_international, school_private, school_scholarship, school_local'],
  ])('rejects %s', (_label, change, expected) => {
    expect(() => parseEvents([{ ...makeEvent(), ...change }])).toThrow(expected);
  });

  describe('events with choices', () => {
    const open = (id: string, effects: EventChoice['effects'] = {}): EventChoice => ({ id, effects });
    const choiceEvent = (choices: unknown): unknown => {
      const { effects: _none, ...rest } = makeEvent();
      return { ...rest, choices };
    };

    it('accepts a valid choice event', () => {
      const locked: EventChoice = { id: 'b', conditions: { stats: [{ stat: 'academic', op: '>=', value: 70 }] }, effects: {} };
      expect(() => parseEvents([choiceEvent([open('a'), locked])])).not.toThrow();
    });

    it.each([
      ['both effects and choices', { ...makeEvent(), choices: [open('a'), open('b')] }, 'exactly one of'],
      ['neither effects nor choices', (({ effects: _e, ...rest }) => rest)(makeEvent()), 'exactly one of'],
      ['a single choice', choiceEvent([open('a')]), 'at least 2 choices'],
      ['duplicate choice ids', choiceEvent([open('a'), open('a')]), 'duplicate choice id'],
      [
        'no always-available choice',
        choiceEvent([
          { id: 'a', conditions: { stats: [{ stat: 'looks', op: '>=', value: 70 }] }, effects: {} },
          { id: 'b', conditions: { stats: [{ stat: 'looks', op: '<', value: 70 }] }, effects: {} },
        ]),
        'at least one choice must have no conditions',
      ],
      ['an age condition on a choice', choiceEvent([open('a'), { id: 'b', conditions: { ageMin: 3 }, effects: {} }]), 'may only test stats, flags and lifestyle'],
      ['an unsupported trait', choiceEvent([open('a'), open('b', { traits: { charm: 5 } as never })]), 'unsupported trait "charm"'],
      ['a habit level that does not exist', choiceEvent([open('a'), open('b', { habits: { exercise: 'daily' } as never })]), 'has no level "daily"'],
    ])('rejects %s', (_label, raw, expected) => {
      expect(() => parseEvents([raw])).toThrow(expected);
    });

    it('a flag set by a choice satisfies a flag condition elsewhere', () => {
      const tester = makeEvent({ id: 'tester', conditions: { ageMin: 0, ageMax: 1, flagsAll: ['picked_a'] } });
      expect(() => parseEvents([choiceEvent([open('a', { setFlags: ['picked_a'] }), open('b')]), tester])).not.toThrow();
    });
  });

  it('accepts a flag condition when another event sets that flag', () => {
    const setter = makeEvent({ id: 'setter', effects: { setFlags: ['did_x'] } });
    const tester = makeEvent({ id: 'tester', conditions: { ageMin: 0, ageMax: 1, flagsAll: ['did_x'] } });
    expect(() => parseEvents([setter, tester])).not.toThrow();
  });
});

describe('calendarMonth', () => {
  it('starts at the birth month and wraps after December', () => {
    expect(calendarMonth({ birthMonth: 11, ageInMonths: 0 })).toBe(11);
    expect(calendarMonth({ birthMonth: 11, ageInMonths: 1 })).toBe(12);
    expect(calendarMonth({ birthMonth: 11, ageInMonths: 2 })).toBe(1);
  });
});

describe('isEligible', () => {
  it('uses whole years, inclusive on both ends', () => {
    const event = makeEvent({ conditions: { ageMin: 3, ageMax: 12 } });
    expect(isEligible(event, makeState({ ageInMonths: 3 * 12 - 1 }))).toBe(false);
    expect(isEligible(event, makeState({ ageInMonths: 3 * 12 }))).toBe(true);
    expect(isEligible(event, makeState({ ageInMonths: 13 * 12 - 1 }))).toBe(true);
    expect(isEligible(event, makeState({ ageInMonths: 13 * 12 }))).toBe(false);
  });

  it('checks stat conditions with >= and <', () => {
    const rich = makeEvent({ conditions: { ageMin: 0, ageMax: 99, stats: [{ stat: 'familyWealth', op: '>=', value: 50 }] } });
    const poor = makeEvent({ conditions: { ageMin: 0, ageMax: 99, stats: [{ stat: 'familyWealth', op: '<', value: 50 }] } });
    const at50 = makeState({ environment: { familyWealth: 50 } });
    const at49 = makeState({ environment: { familyWealth: 49.9 } });
    expect([isEligible(rich, at50), isEligible(poor, at50)]).toEqual([true, false]);
    expect([isEligible(rich, at49), isEligible(poor, at49)]).toEqual([false, true]);
  });

  it('checks required and forbidden flags', () => {
    const needs = makeEvent({ conditions: { ageMin: 0, ageMax: 99, flagsAll: ['a'] } });
    const forbids = makeEvent({ conditions: { ageMin: 0, ageMax: 99, flagsNone: ['a'] } });
    const withA = makeState({ flags: ['a'] });
    const without = makeState({ flags: [] });
    expect([isEligible(needs, withA), isEligible(needs, without)]).toEqual([true, false]);
    expect([isEligible(forbids, withA), isEligible(forbids, without)]).toEqual([false, true]);
  });

  it('checks "at least one of" flags (D66: goes to any school)', () => {
    const anySchool = makeEvent({ conditions: { ageMin: 0, ageMax: 99, flagsAny: ['school_public', 'school_local'] } });
    expect(isEligible(anySchool, makeState({ flags: ['school_local'] }))).toBe(true);
    expect(isEligible(anySchool, makeState({ flags: ['school_public', 'school_local'] }))).toBe(true);
    expect(isEligible(anySchool, makeState({ flags: ['other'] }))).toBe(false);
  });

  it('eventsNone: blocked forever once a listed event happened (versions of one moment)', () => {
    const behind = makeEvent({ id: 'behind', conditions: { ageMin: 0, ageMax: 99, eventsNone: ['top', 'mid'] } });
    expect(isEligible(behind, makeState({ eventHistory: [] }))).toBe(true);
    expect(isEligible(behind, makeState({ eventHistory: [{ id: 'mid', ageInMonths: 12 }] }))).toBe(false);
    expect(isEligible(behind, makeState({ eventHistory: [{ id: 'other', ageInMonths: 12 }] }))).toBe(true);
  });

  it('checks where the character lives now: every given field must match one of its values', () => {
    const town = makeEvent({ conditions: { ageMin: 0, ageMax: 99, residence: { regions: ['city', 'suburb'] } } });
    const village = makeEvent({ conditions: { ageMin: 0, ageMax: 99, residence: { regions: ['rural'], homes: ['grandparents'] } } });
    const inCity = makeState({ residence: { regionId: 'city', homeId: 'parents' } });
    const ruralParents = makeState({ residence: { regionId: 'rural', homeId: 'parents' } });
    const ruralGrandparents = makeState({ residence: { regionId: 'rural', homeId: 'grandparents' } });
    expect([town, village].map((e) => isEligible(e, inCity))).toEqual([true, false]);
    expect([town, village].map((e) => isEligible(e, ruralParents))).toEqual([false, false]);
    expect([town, village].map((e) => isEligible(e, ruralGrandparents))).toEqual([false, true]);
  });

  it('checks the calendar month', () => {
    const rainy = makeEvent({ conditions: { ageMin: 0, ageMax: 99, months: [6, 7] } });
    expect(isEligible(rainy, makeState({ birthMonth: 6, ageInMonths: 30 * 12 }))).toBe(true);
    expect(isEligible(rainy, makeState({ birthMonth: 1, ageInMonths: 30 * 12 }))).toBe(false);
  });

  it('blocks a "once" event after it happened, but not a repeatable one', () => {
    const history = [{ id: 'test_event', ageInMonths: 100 }];
    expect(isEligible(makeEvent({ once: true }), makeState({ ageInMonths: 15 * 12, eventHistory: history }))).toBe(false);
    expect(isEligible(makeEvent({ once: false }), makeState({ ageInMonths: 15 * 12, eventHistory: history }))).toBe(true);
  });
});

describe('lockReasons', () => {
  const choice: EventChoice = {
    id: 'tech',
    conditions: { stats: [{ stat: 'academic', op: '>=', value: 70 }], flagsNone: ['expelled'] },
    effects: {},
  };

  it('is empty when every condition is met (70 is enough for >= 70)', () => {
    expect(lockReasons(choice, makeState({ skills: { academic: 70 } }))).toEqual([]);
  });

  it('names the missing stat with the current value, and a separate reason for flags', () => {
    expect(lockReasons(choice, makeState({ skills: { academic: 45 }, flags: ['expelled'] }))).toEqual([
      { kind: 'stat', stat: 'academic', op: '>=', value: 70, current: 45 },
      { kind: 'flag' },
    ]);
  });

  it('locks a choice whose "at least one of" flags are all missing', () => {
    const anyClub: EventChoice = { id: 'captain', conditions: { flagsAny: ['club_sports', 'club_scouts'] }, effects: {} };
    expect(lockReasons(anyClub, makeState({ flags: ['club_scouts'] }))).toEqual([]);
    expect(lockReasons(anyClub, makeState({ flags: [] }))).toEqual([{ kind: 'flag' }]);
  });

  it('a choice without conditions is always available', () => {
    expect(lockReasons({ id: 'x', effects: {} }, makeState())).toEqual([]);
  });
});


describe('rollEvents', () => {
  it('fires a guaranteed eligible event immediately and skips ineligible ones', () => {
    const now = makeEvent({ id: 'now', frequency: 'guaranteed', once: true, conditions: { ageMin: 30, ageMax: 30 } });
    const later = makeEvent({ id: 'later', frequency: 'guaranteed', once: true, conditions: { ageMin: 40, ageMax: 40 } });
    expect(rollEvents(makeState({ ageInMonths: 30 * 12 }), createRng(1), [now, later]).map((e) => e.id)).toEqual(['now']);
  });
});

describe('applyEvent', () => {
  it('changes stats with the event as the logged source, sets/removes flags and records history', () => {
    const state = makeState({ ageInMonths: 100, flags: ['old'], condition: { physicalHealth: 50 } });
    applyEvent(
      state,
      makeEvent({ id: 'sick', effects: { stats: { physicalHealth: -4 }, setFlags: ['new'], removeFlags: ['old'] } }),
    );
    expect(state.condition.physicalHealth).toBe(46);
    expect(state.yearLog.physicalHealth).toEqual({ 'event.sick': -4 });
    expect(state.flags).toEqual(['new']);
    expect(state.eventHistory).toEqual([{ id: 'sick', ageInMonths: 100 }]);
  });

  it('refuses an event with choices (those wait for the player)', () => {
    const withChoices = makeEvent({ effects: undefined as never, choices: [{ id: 'a', effects: {} }, { id: 'b', effects: {} }] });
    expect(() => applyEvent(makeState(), withChoices)).toThrow('has choices');
  });

  it('does not add a flag twice', () => {
    const state = makeState({ flags: ['x'] });
    applyEvent(state, makeEvent({ effects: { setFlags: ['x'] } }));
    expect(state.flags).toEqual(['x']);
  });
});

describe('how often events happen (D67)', () => {
  const chanceEvent = (id: string, frequency: EventDef['frequency'], extra: Partial<EventDef> = {}): EventDef =>
    makeEvent({ id, frequency, once: true, conditions: { ageMin: 0, ageMax: 99 }, ...extra });
  const at30 = () => makeState({ ageInMonths: 30 * 12, eventHistory: [] });

  /** Share of characters who got the event within `months` months (each run: a fresh character). */
  function shareWithin(event: EventDef, months: number, runs: number, start = 30 * 12): number {
    const rng = createRng(42);
    const events = [event]; // one list: rollEvents caches its age index per list
    let got = 0;
    for (let run = 0; run < runs; run++) {
      const state = makeState({ ageInMonths: start, eventHistory: [] });
      for (let m = 0; m < months; m++, state.ageInMonths++) {
        if (rollEvents(state, rng, events).length > 0) {
          got += 1;
          break;
        }
      }
    }
    return got / runs;
  }

  it.each([
    ['common', 0.5],
    ['normal', 0.2],
    ['uncommon', 0.05],
    ['rare', 0.01],
  ] as const)('%s = %d per year: twelve monthly chances add up to exactly that', (frequency, yearly) => {
    const event = chanceEvent('e', frequency);
    expect(yearlyChance(event, at30())).toBe(yearly);
    expect(1 - (1 - monthlyChance(event, at30())) ** 12).toBeCloseTo(yearly, 12);
  });

  it('in a real run, about 20% of characters get a "normal" event within a year', () => {
    const share = shareWithin(chanceEvent('e', 'normal'), 12, 4000);
    expect(share).toBeGreaterThan(0.17);
    expect(share).toBeLessThan(0.23);
  });

  it('an event limited to some months gets its whole yearly chance in those months', () => {
    const april = chanceEvent('trip', 'normal', { conditions: { ageMin: 0, ageMax: 99, months: [4] } });
    expect(monthlyChance(april, at30())).toBeCloseTo(0.2, 12);
  });

  it('events roll on their own: writing more events does not change how often one happens', () => {
    const alone = shareWithin(chanceEvent('e', 'uncommon'), 120, 1500);
    // 30 other rare events: the monthly limit can push one out now and then, but barely.
    const others = Array.from({ length: 30 }, (_, i) => chanceEvent(`other${i}`, 'rare'));
    const events = [chanceEvent('e', 'uncommon'), ...others];
    const rng = createRng(42);
    let got = 0;
    for (let run = 0; run < 1500; run++) {
      const state = at30();
      for (let m = 0; m < 120 && got <= run; m++, state.ageInMonths++) {
        const ids = rollEvents(state, rng, events).map((e) => e.id);
        if (ids.includes('e')) got += 1;
        for (const id of ids) state.eventHistory.push({ id, ageInMonths: state.ageInMonths });
      }
    }
    expect(Math.abs(got / 1500 - alone)).toBeLessThan(0.05);
    expect(alone).toBeGreaterThan(0.35); // 1 − 0.95^10 ≈ 0.40 over ten years
    expect(alone).toBeLessThan(0.45);
  });

  it('at most one chance event a month; guaranteed and window events come on top', () => {
    const always = chanceEvent('always', 'guaranteed', { conditions: { ageMin: 30, ageMax: 30 } });
    const lastMonth = chanceEvent('w', 'window', { conditions: { ageMin: 0, ageMax: 30 } });
    const sure = Array.from({ length: 5 }, (_, i) => chanceEvent(`c${i}`, 'common', { chanceBy: [{ stat: 'familyWealth', toward: 'high' }] }));
    const state = makeState({ ageInMonths: 31 * 12 - 1, environment: { familyWealth: 100 } }); // last month of age 30
    const rng = createRng(5);
    for (let i = 0; i < 50; i++) {
      const ids = rollEvents(state, rng, [always, lastMonth, ...sure]).map((e) => e.id);
      expect(ids.slice(0, 2)).toEqual(['always', 'w']);
      expect(ids.length).toBeLessThanOrEqual(3);
    }
  });

  it('a window event happens exactly once in its age range, in any month with about equal odds', () => {
    const event = chanceEvent('first_word', 'window', { conditions: { ageMin: 1, ageMax: 2 } }); // 24 months
    const rng = createRng(7);
    const events = [event];
    let firstYear = 0;
    for (let run = 0; run < 3000; run++) {
      const state = makeState({ ageInMonths: 12, eventHistory: [] });
      let times = 0;
      for (; state.ageInMonths < 36; state.ageInMonths++) {
        if (rollEvents(state, rng, events).length > 0) {
          if (state.ageInMonths < 24) firstYear += 1;
          times += 1;
          state.eventHistory.push({ id: event.id, ageInMonths: state.ageInMonths });
        }
      }
      expect(times).toBe(1);
    }
    expect(firstYear / 3000).toBeGreaterThan(0.45);
    expect(firstYear / 3000).toBeLessThan(0.55);
  });

  it('a window event still happens when its condition is only met late (certain in the last month)', () => {
    expect(windowChance(chanceEvent('w', 'window', { conditions: { ageMin: 6, ageMax: 7 } }), { ageInMonths: 8 * 12 - 1 })).toBe(1);
    expect(windowChance(chanceEvent('w', 'window', { conditions: { ageMin: 6, ageMax: 7 } }), { ageInMonths: 6 * 12 })).toBeCloseTo(1 / 24);
  });

  it('nothing happens when no event fits the age', () => {
    const later = chanceEvent('later', 'common', { conditions: { ageMin: 50, ageMax: 60 } });
    const rng = createRng(1);
    for (let month = 0; month < 100; month++) expect(rollEvents(at30(), rng, [later])).toEqual([]);
  });

  it('stays fast with 10,000 events (age index)', () => {
    const events = Array.from({ length: 10_000 }, (_, i) => {
      const ageMin = i % 81;
      return makeEvent({ id: `e${i}`, frequency: 'normal', once: true, conditions: { ageMin, ageMax: ageMin + (i % 15) } });
    });
    const state = makeState({ ageInMonths: 0, eventHistory: [] });
    const rng = createRng(9);
    const started = performance.now();
    for (let month = 1; month <= 85 * 12; month++) {
      state.ageInMonths = month;
      for (const event of rollEvents(state, rng, events)) state.eventHistory.push({ id: event.id, ageInMonths: month });
    }
    expect(performance.now() - started).toBeLessThan(3000); // was ~25 s before the index
  });
});

describe('values that make an event more or less likely (D68)', () => {
  const bullied = makeEvent({ id: 'bullied', frequency: 'uncommon', once: true, chanceBy: [{ stat: 'riskTaking', toward: 'low' }] });

  it.each([
    [50, 1],
    [0, 3],
    [100, 1 / 3],
    [25, Math.sqrt(3)],
  ])('risk-taking %d → chance ×%d for an event likelier with LOW risk-taking', (riskTaking, factor) => {
    expect(chanceFactor(bullied, makeState({ traits: { riskTaking } }))).toBeCloseTo(factor, 12);
  });

  it('"high" works the other way round, and several values multiply', () => {
    const contest = makeEvent({
      frequency: 'normal',
      chanceBy: [
        { stat: 'discipline', toward: 'high' },
        { stat: 'familyWealth', toward: 'high' },
      ],
    });
    expect(chanceFactor(contest, makeState({ traits: { discipline: 100 }, environment: { familyWealth: 50 } }))).toBeCloseTo(3);
    expect(chanceFactor(contest, makeState({ traits: { discipline: 100 }, environment: { familyWealth: 100 } }))).toBeCloseTo(9);
  });

  it('multiplies the yearly chance, never above 95%', () => {
    expect(yearlyChance(bullied, makeState({ traits: { riskTaking: 0 } }))).toBeCloseTo(0.15);
    const common = makeEvent({ frequency: 'common', chanceBy: [{ stat: 'riskTaking', toward: 'low' }] });
    expect(yearlyChance(common, makeState({ traits: { riskTaking: 0 } }))).toBe(0.95);
  });

  it('events without chanceBy are not affected by any value', () => {
    expect(chanceFactor(makeEvent(), makeState({ traits: { riskTaking: 0 } }))).toBe(1);
  });
});

describe('cooldown, lifetime chance and lifestyle conditions', () => {
  it('a repeatable event with a cooldown waits that many months', () => {
    const yearly = makeEvent({ id: 'yearly', once: false, cooldownMonths: 12, conditions: { ageMin: 0, ageMax: 99 } });
    const history = [{ id: 'yearly', ageInMonths: 100 }];
    expect(isEligible(yearly, makeState({ ageInMonths: 111, eventHistory: history }))).toBe(false);
    expect(isEligible(yearly, makeState({ ageInMonths: 112, eventHistory: history }))).toBe(true);
  });

  it('lifetime chance: fixed per life and event, about the right share of lives', () => {
    expect(lifetimeRoll(42, 'x')).toBe(lifetimeRoll(42, 'x'));
    const rare = makeEvent({ id: 'gene', lifetimeChance: 0.3, conditions: { ageMin: 0, ageMax: 99 } });
    const share = Array.from({ length: 4000 }, (_, seed) => isEligible(rare, makeState({ seed }))).filter(Boolean).length / 4000;
    expect(share).toBeGreaterThan(0.27);
    expect(share).toBeLessThan(0.33);
  });

  it('checks the lifestyle the character has right now', () => {
    const overwork = makeEvent({ conditions: { ageMin: 0, ageMax: 99, habits: { overtime: 'heavy' } } });
    expect(isEligible(overwork, makeState({ habits: { overtime: 'heavy' } }))).toBe(true);
    expect(isEligible(overwork, makeState({ habits: { overtime: 'some' } }))).toBe(false);
  });

  it.each([
    ['cooldown on a once event', { once: true, cooldownMonths: 12 }, 'only makes sense for a repeatable event'],
    ['a lifetime chance of 30 (instead of 0.3)', { lifetimeChance: 30 }, 'between 0 and 1'],
    ['a lifestyle condition with a wrong level', { conditions: { ageMin: 0, ageMax: 1, habits: { sleep: 'never' } } }, 'invalid lifestyle condition'],
    ['a temporary habit without months', { effects: { habits: { sleep: { level: 'short' } } } }, 'months must be a whole number'],
  ])('rejects %s', (_label, change, expected) => {
    expect(() => parseEvents([{ ...makeEvent(), ...change }])).toThrow(expected);
  });

  it('a locked lifestyle condition is reported as a reason', () => {
    const choice: EventChoice = { id: 'run', conditions: { habits: { exercise: 'regular' } }, effects: {} };
    expect(lockReasons(choice, makeState({ habits: { exercise: 'none' } }))).toEqual([{ kind: 'habit', habit: 'exercise', level: 'regular' }]);
  });
});

describe('monthsSince: waiting after another event', () => {
  const newJob = makeEvent({
    id: 'new_job',
    conditions: { ageMin: 0, ageMax: 99, monthsSince: { events: ['lost_job', 'lost_job_away'], min: 6 } },
  });

  it('is not possible before any of the events happened', () => {
    expect(isEligible(newJob, makeState({ eventHistory: [] }))).toBe(false);
  });

  it('waits at least `min` months after the event (boundary: 5 no, 6 yes)', () => {
    const history = [{ id: 'lost_job', ageInMonths: 100 }];
    expect(isEligible(newJob, makeState({ ageInMonths: 105, eventHistory: history }))).toBe(false);
    expect(isEligible(newJob, makeState({ ageInMonths: 106, eventHistory: history }))).toBe(true);
  });

  it('counts from the MOST RECENT of the listed events', () => {
    const history = [
      { id: 'lost_job', ageInMonths: 80 },
      { id: 'lost_job_away', ageInMonths: 100 },
    ];
    expect(isEligible(newJob, makeState({ ageInMonths: 103, eventHistory: history }))).toBe(false);
    expect(isEligible(newJob, makeState({ ageInMonths: 106, eventHistory: history }))).toBe(true);
  });

  it.each([
    [{ events: [], min: 6 }, 'monthsSince must be'],
    [{ events: ['test_event'], min: 0 }, 'monthsSince must be'],
    [{ events: ['test_event'], min: 6, max: 9 }, 'unknown field "max"'],
    [{ events: ['no_such_event'], min: 6 }, 'names event "no_such_event", which does not exist'],
  ])('rejects %j', (monthsSince, expected) => {
    expect(() => parseEvents([{ ...makeEvent(), conditions: { ageMin: 0, ageMax: 9, monthsSince } }])).toThrow(expected);
  });
});

describe('notWithin: keeping big life changes apart', () => {
  const move = makeEvent({
    id: 'to_grandparents',
    conditions: { ageMin: 0, ageMax: 99, notWithin: { events: ['moved_house', 'divorce'], months: 12 } },
  });

  it('passes when none of the events ever happened', () => {
    expect(isEligible(move, makeState({ eventHistory: [] }))).toBe(true);
  });

  it('waits `months` after the most recent of them (boundary: 11 no, 12 yes)', () => {
    const history = [
      { id: 'divorce', ageInMonths: 80 },
      { id: 'moved_house', ageInMonths: 100 },
    ];
    expect(isEligible(move, makeState({ ageInMonths: 111, eventHistory: history }))).toBe(false);
    expect(isEligible(move, makeState({ ageInMonths: 112, eventHistory: history }))).toBe(true);
  });

  it.each([
    [{ events: [], months: 12 }, 'notWithin must be'],
    [{ events: ['test_event'], months: 0 }, 'notWithin must be'],
    [{ events: ['test_event'], months: 12, min: 1 }, 'unknown field "min"'],
    [{ events: ['nope'], months: 12 }, 'notWithin names event "nope", which does not exist'],
  ])('rejects %j', (notWithin, expected) => {
    expect(() => parseEvents([{ ...makeEvent(), conditions: { ageMin: 0, ageMax: 9, notWithin } }])).toThrow(expected);
  });
});

describe('environment effects (D57)', () => {
  it('change family wealth and warmth, clamped, with the real change recorded', () => {
    const state = makeState({ environment: { familyWealth: 5, familyWarmth: 40 } });
    applyEvent(state, makeEvent({ id: 'jobloss', effects: { environment: { familyWealth: -10, familyWarmth: 5 } } }));
    expect(state.environment).toMatchObject({ familyWealth: 0, familyWarmth: 45 });
    expect(state.eventHistory[0]!.environmentChanges).toEqual({ familyWealth: -5, familyWarmth: 5 });
  });

  it('are not reduced with age (unlike traits)', () => {
    const state = makeState({ ageInMonths: 40 * 12, environment: { familyWarmth: 50 } });
    applyEvent(state, makeEvent({ effects: { environment: { familyWarmth: -10 } } }));
    expect(state.environment.familyWarmth).toBe(40);
  });

  it('rejects work and financial stress (owned by later systems)', () => {
    expect(() => parseEvents([{ ...makeEvent(), effects: { environment: { workStress: 10 } } }])).toThrow(
      'unsupported environment value "workStress"',
    );
  });
});

describe('residence effects (save version 7)', () => {
  it('move the character and record where from and where to', () => {
    const state = makeState({ residence: { regionId: 'city', homeId: 'parents' } });
    applyEvent(state, makeEvent({ id: 'move', effects: { residence: { region: 'rural', home: 'grandparents' } } }));
    expect(state.residence).toEqual({ regionId: 'rural', homeId: 'grandparents' });
    expect(state.eventHistory[0]!.residenceChange).toEqual({
      from: { regionId: 'city', homeId: 'parents' },
      to: { regionId: 'rural', homeId: 'grandparents' },
    });
  });

  it('may change only the home: the region stays', () => {
    const state = makeState({ residence: { regionId: 'rural', homeId: 'parents' } });
    applyEvent(state, makeEvent({ effects: { residence: { home: 'grandparents' } } }));
    expect(state.residence).toEqual({ regionId: 'rural', homeId: 'grandparents' });
  });

  it('records nothing when the character already lives there', () => {
    const state = makeState({ residence: { regionId: 'rural', homeId: 'grandparents' } });
    applyEvent(state, makeEvent({ effects: { residence: { region: 'rural', home: 'grandparents' } } }));
    expect(state.eventHistory[0]!.residenceChange).toBeUndefined();
  });

  it.each([
    [{ residence: {} }, 'must name a region, a home, or both'],
    [{ residence: { region: 'moon' } }, 'unknown region "moon"'],
    [{ residence: { home: 'castle' } }, 'unknown home "castle"'],
    [{ residence: { home: 'parents', street: 'x' } }, 'unknown field "street"'],
  ])('rejects %j', (effects, expected) => {
    expect(() => parseEvents([{ ...makeEvent(), effects }])).toThrow(expected);
  });
});

describe('applyChoice', () => {
  const dream = makeEvent({
    id: 'dream',
    effects: undefined as never,
    choices: [
      { id: 'rider', effects: { stats: { mentalHealth: 2 }, setFlags: ['dream_rider'] } },
      { id: 'tech', conditions: { stats: [{ stat: 'academic', op: '>=', value: 70 }] }, effects: {} },
    ],
  });

  it('applies the chosen effects under the event source and records the choice with the event age', () => {
    const state = makeState({ ageInMonths: 144, condition: { mentalHealth: 60 } });
    applyChoice(state, dream, 'rider', 144);
    expect(state.condition.mentalHealth).toBe(62);
    expect(state.yearLog.mentalHealth).toEqual({ 'event.dream': 2 });
    expect(state.flags).toContain('dream_rider');
    expect(state.eventHistory).toEqual([{ id: 'dream', ageInMonths: 144, choiceId: 'rider' }]);
  });

  it('refuses a locked or unknown choice', () => {
    expect(() => applyChoice(makeState({ skills: { academic: 10 } }), dream, 'tech', 144)).toThrow('locked');
    expect(() => applyChoice(makeState(), dream, 'pilot', 144)).toThrow('no choice "pilot"');
  });
});

describe('trait and habit effects (D41)', () => {
  const grit = (amount: number) => makeEvent({ id: 'grit', effects: { traits: { discipline: amount } } });

  it('changes traits fully before 15 and by the "later" factor from 15', () => {
    const child = makeState({ ageInMonths: 14 * 12 + 11, traits: { discipline: 50 } });
    const teen = makeState({ ageInMonths: 15 * 12, traits: { discipline: 50 } });
    applyEvent(child, grit(10));
    applyEvent(teen, grit(10));
    expect(child.traits.discipline).toBe(60);
    expect(teen.traits.discipline).toBe(50 + 10 * BALANCE.events.traitFactorLater);
    expect(traitEffectFactor(teen)).toBe(BALANCE.events.traitFactorLater);
  });

  it('records the REAL trait change after clamping, on the history record', () => {
    const state = makeState({ ageInMonths: 100, traits: { discipline: 97 } });
    applyEvent(state, grit(10));
    expect(state.traits.discipline).toBe(100);
    expect(state.eventHistory[0]!.traitChanges).toEqual({ discipline: 3 });
  });

  it('a temporary habit records its months and starts a timer back to the old level (D56)', () => {
    const state = makeState({ ageInMonths: 100, habits: { sleep: 'enough' } });
    applyEvent(state, makeEvent({ effects: { habits: { sleep: { level: 'short', months: 2 } } } }));
    expect(state.habits.sleep).toBe('short');
    expect(state.habitTimers.sleep).toEqual({ revertTo: 'enough', untilMonth: 102 });
    expect(state.eventHistory[0]).toMatchObject({ habitChanges: { sleep: 'short' }, habitMonths: { sleep: 2 } });
  });

  it('switches habits and records only the ones that really changed', () => {
    const state = makeState({ habits: { exercise: 'none', sleep: 'enough' } });
    applyEvent(state, makeEvent({ effects: { habits: { exercise: 'regular', sleep: 'enough' } } }));
    expect(state.habits.exercise).toBe('regular');
    expect(state.eventHistory[0]!.habitChanges).toEqual({ exercise: 'regular' });
  });
});

describe('hasHappened', () => {
  it('counts an event that is still waiting for a choice', () => {
    expect(hasHappened(makeState({ pendingChoices: [{ eventId: 'dream', ageInMonths: 144 }] }), 'dream')).toBe(true);
  });
});

describe('real events over many lives (Monte Carlo)', () => {
  const ends = Array.from({ length: 500 }, (_, seed) => simulateWholeLife(createNewLife(seed)));
  const ids = (end: (typeof ends)[number]) => end.eventHistory.map((record) => record.id);

  it('every life gets exactly one infant vaccine event, in the first month, matching family wealth', () => {
    for (const end of ends) {
      const vaccine = end.eventHistory.filter((r) => r.id.startsWith('health_infant_vaccine'));
      expect(vaccine).toHaveLength(1);
      expect(vaccine[0]!.ageInMonths).toBe(1);
      // Wealth at BIRTH: events can change it later (e.g. a parent losing their job).
      const wealthAtBirth = createNewLife(end.seed).environment.familyWealth;
      const expected = wealthAtBirth >= 50 ? 'health_infant_vaccine_extra' : 'health_infant_vaccine_basic';
      expect(vaccine[0]!.id).toBe(expected);
    }
  });

  it('everyone who reaches 13 wrote down exactly one childhood dream, in March at age 12', () => {
    const grown = ends.filter((end) => end.ageInMonths >= 13 * 12);
    expect(grown.length).toBeGreaterThan(400);
    for (const end of grown) {
      const dreams = end.eventHistory.filter((r) => r.id === 'life_childhood_dream');
      expect(dreams).toHaveLength(1);
      expect(Math.floor(dreams[0]!.ageInMonths / 12)).toBe(12);
      expect(calendarMonth({ birthMonth: end.birthMonth, ageInMonths: dreams[0]!.ageInMonths })).toBe(3);
      expect(end.flags).toContain(`dream_${dreams[0]!.choiceId}`);
    }
  });

  const CHICKENPOX = ['health_chickenpox_preschool', 'health_chickenpox'];
  const hadChickenpox = (end: (typeof ends)[number]) => ids(end).filter((id) => CHICKENPOX.includes(id)).length;

  it('children with extra vaccines never get chickenpox', () => {
    const vaccinated = ends.filter((end) => end.flags.includes('extra_vaccines'));
    expect(vaccinated.length).toBeGreaterThan(0);
    expect(vaccinated.filter((end) => hadChickenpox(end) > 0)).toEqual([]);
  });

  it('chickenpox happens at most once per life, in the version for the age (3–5 play, 6–12 school)', () => {
    let preschool = 0;
    for (const end of ends) {
      expect(hadChickenpox(end)).toBeLessThanOrEqual(1);
      for (const record of end.eventHistory) {
        const age = Math.floor(record.ageInMonths / 12);
        if (record.id === 'health_chickenpox_preschool') {
          preschool += 1;
          expect(age).toBeGreaterThanOrEqual(3);
          expect(age).toBeLessThanOrEqual(5);
        }
        if (record.id === 'health_chickenpox') expect(age).toBeGreaterThanOrEqual(6);
      }
    }
    expect(preschool).toBeGreaterThan(0);
  });

  it('children without extra vaccines nearly all get chickenpox by 13 (common: 50% a year from age 3)', () => {
    const basic = ends.filter((end) => !end.flags.includes('extra_vaccines') && end.ageInMonths >= 13 * 12);
    const share = basic.filter((end) => hadChickenpox(end) > 0).length / basic.length;
    expect(share).toBeGreaterThan(0.9);
  });

  it('food allergy happens only in about 10% of lives (lifetime chance)', () => {
    const grown = ends.filter((end) => end.ageInMonths >= 19 * 12);
    const share = grown.filter((end) => ids(end).includes('health_food_allergy')).length / grown.length;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.15);
  });

  describe('family story stays consistent (job loss, grandparents)', () => {
    const HOME_EVENTS = [
      'family_new_sibling',
      'family_dad_morning_run',
      'family_bedtime_rule',
      'family_home_atmosphere_better',
      'family_market_helper',
      'family_move_far_from_school',
    ];
    const GRANDPARENTS = ['family_live_with_grandparents', 'family_live_with_grandparents_after_job_loss'];
    const indexOf = (end: (typeof ends)[number], id: string) => ids(end).indexOf(id);

    it('moves to the grandparents at most once, and lives there (countryside) afterwards', () => {
      let moved = 0;
      for (const end of ends) {
        const moves = ids(end).filter((id) => GRANDPARENTS.includes(id));
        expect(moves.length).toBeLessThanOrEqual(1);
        if (moves.length === 1) {
          moved += 1;
          expect(end.residence).toEqual({ regionId: 'rural', homeId: 'grandparents' });
        } else {
          expect(end.residence).toEqual({ regionId: end.birthRegionId, homeId: 'parents' });
        }
      }
      expect(moved).toBeGreaterThan(0);
    });

    it('no event that needs the parents\' home happens after moving to the grandparents', () => {
      for (const end of ends) {
        const moveAt = Math.max(...GRANDPARENTS.map((id) => indexOf(end, id)));
        if (moveAt < 0) continue;
        expect(ids(end).slice(moveAt).filter((id) => HOME_EVENTS.includes(id))).toEqual([]);
      }
    });

    it('the "after job loss" version happens only while a parent is out of work; the plain one never', () => {
      let afterJobLoss = 0;
      for (const end of ends) {
        const lost = indexOf(end, 'family_parent_lost_job');
        const found = indexOf(end, 'family_parent_new_job');
        const unemployedAt = (at: number) => lost >= 0 && lost < at && (found < 0 || found > at);
        const special = indexOf(end, 'family_live_with_grandparents_after_job_loss');
        const plain = indexOf(end, 'family_live_with_grandparents');
        if (special >= 0) {
          afterJobLoss += 1;
          expect(unemployedAt(special)).toBe(true);
        }
        if (plain >= 0) expect(unemployedAt(plain)).toBe(false);
      }
      expect(afterJobLoss).toBeGreaterThan(0);
    });

    it('big family changes (moves, divorce) never happen within 12 months of each other', () => {
      const BIG = ['family_move_far_from_school', ...GRANDPARENTS, 'family_parents_divorce'];
      for (const end of ends) {
        const big = end.eventHistory.filter((r) => BIG.includes(r.id));
        big.slice(1).forEach((record, i) => expect(record.ageInMonths - big[i]!.ageInMonths).toBeGreaterThanOrEqual(12));
      }
    });

    it('moving to the grandparents ends the long commute from the old home', () => {
      for (const end of ends) {
        if (GRANDPARENTS.some((id) => ids(end).includes(id))) expect(end.flags).not.toContain('long_commute');
      }
    });

    it('a parent finds a new job only after losing one, at least 6 months later', () => {
      const LOSSES = ['family_parent_lost_job', 'family_parent_lost_job_while_away'];
      let found = 0;
      for (const end of ends) {
        let lostAt: number | undefined;
        for (const record of end.eventHistory) {
          if (LOSSES.includes(record.id)) lostAt = record.ageInMonths;
          if (record.id === 'family_parent_new_job') {
            found += 1;
            expect(lostAt).toBeDefined();
            expect(record.ageInMonths - lostAt!).toBeGreaterThanOrEqual(6);
            lostAt = undefined; // back at work: the next new job needs a new loss
          }
        }
      }
      expect(found).toBeGreaterThan(0);
    });

    it('a job loss while living with the grandparents uses its own text (no tense home, no lost sleep)', () => {
      for (const end of ends) {
        const moveAt = Math.max(...GRANDPARENTS.map((id) => indexOf(end, id)));
        const ids_ = ids(end);
        ids_.forEach((id, i) => {
          if (id === 'family_parent_lost_job') expect(moveAt < 0 || i < moveAt).toBe(true);
          if (id === 'family_parent_lost_job_while_away') expect(moveAt >= 0 && i > moveAt).toBe(true);
        });
      }
    });
  });

  it('growth: at most one special interest per life, its flag set; milestones only in their age window', () => {
    const INTERESTS = ['nature', 'machines', 'music', 'stories'];
    let withInterest = 0;
    for (const end of ends) {
      const interests = ids(end).filter((id) => id.startsWith('growth_interest_'));
      expect(interests.length).toBeLessThanOrEqual(1);
      if (interests.length === 1) {
        withInterest += 1;
        const kind = interests[0]!.replace('growth_interest_', '');
        expect(INTERESTS).toContain(kind);
        expect(end.flags).toContain(`interest_${kind}`);
      }
      for (const record of end.eventHistory) {
        const age = Math.floor(record.ageInMonths / 12);
        if (record.id.startsWith('growth_first_word')) expect(age).toBe(1);
        if (record.id === 'growth_first_sentence') expect(age).toBe(2);
        if (record.id.startsWith('growth_')) expect(age).toBeLessThanOrEqual(6);
      }
    }
    // Four interests, each 5% a year over ages 3–6: about half of all children find one (D67).
    expect(withInterest / ends.length).toBeGreaterThan(0.4);
    expect(withInterest / ends.length).toBeLessThan(0.7);
  });

  it('growth: the family\'s warmth decides which version of first word and drawing a child gets, never both', () => {
    let cold = 0;
    for (const end of ends) {
      const warmthAtBirth = createNewLife(end.seed).environment.familyWarmth; // nothing changes it before 6 yet
      for (const [warmId, coldId] of [
        ['growth_first_word', 'growth_first_word_unnoticed'],
        ['growth_drawing', 'growth_drawing_scolded'],
      ] as const) {
        const got = ids(end).filter((id) => id === warmId || id === coldId);
        expect(got.length).toBeLessThanOrEqual(1);
        if (got[0] === coldId) cold += 1;
        if (got.length === 1) expect(got[0]).toBe(warmthAtBirth < 31 ? coldId : warmId);
      }
    }
    expect(cold).toBeGreaterThan(0);
  });

  describe('school (D66)', () => {
    const SCHOOL_FLAGS = SCHOOL_IDS.map((id) => `school_${id}`);
    const schoolFlags = (flags: string[]) => flags.filter((flag) => SCHOOL_FLAGS.includes(flag));
    const monthOf = (end: (typeof ends)[number], ageInMonths: number) => calendarMonth({ birthMonth: end.birthMonth, ageInMonths });
    /** Family wealth just before each event: only events change it, and each records its real change. */
    const wealthBefore = (end: (typeof ends)[number]) => {
      let wealth = createNewLife(end.seed).environment.familyWealth;
      return end.eventHistory.map((record) => {
        const before = wealth;
        wealth += record.environmentChanges?.familyWealth ?? 0;
        return before;
      });
    };
    const inSchool = ends.filter((end) => end.ageInMonths >= 8 * 12);

    it('every school in the balance table has an event that puts the child there (Grade 1, or Grade 7 for the selective school)', () => {
      for (const id of SCHOOL_IDS) {
        const start = EVENTS.find((e) => e.id === (id === 'top_public' ? 'school_m1_start_top_public' : `school_start_${id}`));
        expect(start?.effects?.setFlags).toContain(`school_${id}`);
      }
    });

    it('a condition meaning "in any school" lists every school, including ones added later (D70)', () => {
      // A list naming most schools but not all is almost certainly an old list that missed a new school:
      // the child in the missing school would silently never get the event. Short lists (e.g. fee-paying schools only) are deliberate.
      const conditions = EVENTS.flatMap((e) => [
        { at: e.id, flags: e.conditions.flagsAny },
        ...(e.choices ?? []).map((c) => ({ at: `${e.id}.${c.id}`, flags: c.conditions?.flagsAny })),
      ]);
      const incomplete = conditions
        .filter(({ flags }) => (flags ?? []).filter((flag) => SCHOOL_FLAGS.includes(flag)).length >= 3)
        .filter(({ flags }) => !SCHOOL_FLAGS.every((flag) => flags!.includes(flag)))
        .map(({ at }) => at);
      expect(incomplete).toEqual([]);
    });

    it('every child starts school exactly once, in May at age 6, in the school the family can afford', () => {
      expect(inSchool.length).toBeGreaterThan(400);
      const seen = new Set<string>();
      for (const end of inSchool) {
        const wealth = wealthBefore(end);
        const starts = end.eventHistory.map((r, i) => [r, i] as const).filter(([r]) => r.id.startsWith('school_start_'));
        expect(starts).toHaveLength(1);
        const [record, index] = starts[0]!;
        seen.add(record.id);
        expect(Math.floor(record.ageInMonths / 12)).toBe(6);
        expect(monthOf(end, record.ageInMonths)).toBe(5);
        const w = wealth[index]!;
        const expected =
          w >= 80 ? ['school_start_international'] : w >= 60 ? ['school_start_private'] : w >= 31 ? ['school_start_public'] : ['school_start_scholarship', 'school_start_local'];
        expect(expected).toContain(record.id);
      }
      // All five kinds show up over 500 lives (international is only ~2%).
      expect(seen.size).toBeGreaterThanOrEqual(4);
    });

    it('each moment comes in one version only: first month, uniform, rules, commute, first term', () => {
      for (const end of ends) {
        for (const prefix of ['school_first_month_', 'school_supplies_', 'school_rules_', 'school_commute_', 'school_first_term_']) {
          expect(end.eventHistory.filter((r) => r.id.startsWith(prefix)).length).toBeLessThanOrEqual(1);
        }
      }
    });

    it('a child always has exactly one school after starting', () => {
      for (const end of inSchool) expect(schoolFlags(end.flags)).toHaveLength(1);
    });

    it('no school event happens before the school year starts', () => {
      for (const end of ends) {
        const startAt = end.eventHistory.findIndex((r) => r.id.startsWith('school_start_'));
        end.eventHistory.forEach((record, i) => {
          if (record.id.startsWith('school_') && !record.id.startsWith('school_start_')) expect(startAt >= 0 && i > startAt).toBe(true);
        });
      }
    });

    it('first month (the month after starting) and first-term results (October) happen exactly once each', () => {
      for (const end of inSchool) {
        const start = end.eventHistory.find((r) => r.id.startsWith('school_start_'))!;
        const firstMonth = end.eventHistory.filter((r) => r.id.startsWith('school_first_month_'));
        const firstTerm = end.eventHistory.filter((r) => r.id.startsWith('school_first_term_'));
        expect(firstMonth).toHaveLength(1);
        expect(firstMonth[0]!.ageInMonths).toBe(start.ageInMonths + 1);
        expect(firstTerm).toHaveLength(1);
        expect(monthOf(end, firstTerm[0]!.ageInMonths)).toBe(10);
        expect(firstTerm[0]!.ageInMonths).toBe(start.ageInMonths + 5);
      }
    });

    it('moving to the grandparents happens only after school started, and switches to the village school', () => {
      let moved = 0;
      for (const end of ends) {
        const moveAt = end.eventHistory.findIndex((r) => r.id.startsWith('family_live_with_grandparents'));
        if (moveAt < 0) continue;
        moved += 1;
        const startAt = end.eventHistory.findIndex((r) => r.id.startsWith('school_start_'));
        expect(startAt).toBeGreaterThanOrEqual(0);
        expect(startAt).toBeLessThan(moveAt);
        expect(schoolFlags(end.flags)).toEqual(['school_local']);
      }
      expect(moved).toBeGreaterThan(0);
    });

    it('school fees become a burden only for fee-paying schools, and the child moves to a public school', () => {
      for (const end of ends) {
        const at = end.eventHistory.findIndex((r) => r.id === 'school_fees_burden');
        if (at < 0) continue;
        const start = end.eventHistory.find((r) => r.id.startsWith('school_start_'))!;
        expect(['school_start_private', 'school_start_international']).toContain(start.id);
        expect(wealthBefore(end)[at]).toBeLessThan(50);
        const later = end.eventHistory.slice(at).some((r) => r.id.startsWith('family_live_with_grandparents'));
        expect(schoolFlags(end.flags)).toEqual([later ? 'school_local' : 'school_public']);
      }
    });

    it('at most one favourite subject per life, matching the early interest when there was one', () => {
      for (const end of ends) {
        const favourites = end.eventHistory.filter((r) => r.id.startsWith('school_favorite_'));
        expect(favourites.length).toBeLessThanOrEqual(1);
        const interest = end.flags.find((flag) => flag.startsWith('interest_'));
        if (favourites[0] && interest) {
          const match = { interest_nature: 'science', interest_machines: 'crafts', interest_music: 'music', interest_stories: 'language' }[interest];
          expect(favourites[0].id).toBe(`school_favorite_${match}`);
        }
        if (favourites[0]?.id === 'school_favorite_pe') expect(interest).toBeUndefined();
      }
    });
  });

  describe('choosing a school for Grade 7 / ม.1 (D70)', () => {
    const CHOICE_IDS = ['school_m1_choice', 'school_m1_choice_private', 'school_m1_family_decides'];
    const monthOf = (end: GameState, ageInMonths: number) => calendarMonth({ birthMonth: end.birthMonth, ageInMonths });
    const schoolStart = (end: GameState) => end.eventHistory.find((r) => r.id.startsWith('school_start_'))!;
    const schoolOf = (end: GameState) => end.flags.filter((flag) => SCHOOL_FLAGS.includes(flag));

    /** Runs a life up to an age (or death), answering the ม.1 question with `pick`; other choices as usual. */
    function liveUntil13(seed: number, pick: (available: string[], state: GameState) => string): GameState {
      const chooser: Chooser = (state, event) => {
        if (!CHOICE_IDS.includes(event.id)) return firstAvailableChoice(state, event);
        const available = event.choices!.filter((c) => lockReasons(c, state).length === 0).map((c) => c.id);
        return pick(available, state);
      };
      let state = createNewLife(seed);
      while (state.death === null && state.ageInMonths < 13 * 12) state = advanceUntilStop(state, { chooser }).state;
      return state;
    }
    const grown = (lives: GameState[]) => lives.filter((end) => end.ageInMonths >= 13 * 12);
    // Every child who can takes the exam; the ambitious one asks for the most expensive school the family can pay for.
    const examLives = grown(Array.from({ length: 400 }, (_, seed) => liveUntil13(seed, (a) => (a.includes('exam') ? 'exam' : a[0]!))));
    const ambitiousLives = grown(
      Array.from({ length: 400 }, (_, seed) =>
        liveUntil13(seed + 1000, (a) => ['international', 'private', 'exam', 'stay'].find((id) => a.includes(id))!),
      ),
    );

    it('every child in Grade 6 meets the question once, in January, 68 months after starting school', () => {
      const all = [...grown(ends), ...examLives, ...ambitiousLives];
      expect(all.length).toBeGreaterThan(1000);
      let asked = 0;
      for (const end of all) {
        const records = end.eventHistory.filter((r) => CHOICE_IDS.includes(r.id));
        // Bilingual schools teach up to Grade 12: their children are not asked (unless fees moved them out).
        if (schoolStart(end).id !== 'school_start_international') expect(records).toHaveLength(1);
        expect(records.length).toBeLessThanOrEqual(1);
        if (records[0] === undefined) continue;
        asked += 1;
        expect(records[0].ageInMonths).toBe(schoolStart(end).ageInMonths + 68);
        expect(monthOf(end, records[0].ageInMonths)).toBe(1);
      }
      expect(asked).toBeGreaterThan(900);
    });

    it('a cold family decides for the child; a child already in a private school is not offered "move to private"', () => {
      let decided = 0;
      for (const end of [...grown(ends), ...examLives]) {
        const record = end.eventHistory.find((r) => CHOICE_IDS.includes(r.id));
        if (record?.id === 'school_m1_family_decides') decided += 1;
        if (record?.id === 'school_m1_choice_private') expect(findEvent(record.id)!.choices!.map((c) => c.id)).not.toContain('private');
      }
      expect(decided).toBeGreaterThan(0);
    });

    it('the exam result comes in March (70 months), and the new school starts in May (72 months)', () => {
      let passed = 0;
      for (const end of [...examLives, ...ambitiousLives]) {
        const start = schoolStart(end).ageInMonths;
        for (const r of end.eventHistory.filter((x) => x.id.startsWith('school_m1_exam_'))) {
          expect(r.ageInMonths).toBe(start + 70);
          expect(monthOf(end, r.ageInMonths)).toBe(3);
        }
        for (const r of end.eventHistory.filter((x) => x.id.startsWith('school_m1_start_'))) {
          expect(r.ageInMonths).toBe(start + 72);
          expect(monthOf(end, r.ageInMonths)).toBe(5);
        }
        if (end.eventHistory.some((r) => r.id === 'school_m1_exam_pass')) passed += 1;
      }
      expect(passed).toBeGreaterThan(0);
    });

    it('only children who chose the exam get a result, and exactly one result (pass or fail)', () => {
      for (const end of [...grown(ends), ...examLives]) {
        const results = end.eventHistory.filter((r) => r.id.startsWith('school_m1_exam_'));
        const tookExam = end.eventHistory.some((r) => CHOICE_IDS.includes(r.id) && r.choiceId === 'exam');
        expect(results).toHaveLength(tookExam ? 1 : 0);
      }
    });

    it('passing needs academic at the threshold (boundary), measured at the result', () => {
      const pass = findEvent('school_m1_exam_pass')!;
      const fail = findEvent('school_m1_exam_fail')!;
      const threshold = pass.conditions.stats!.find((s) => s.stat === 'academic')!.value;
      const atResult = (academic: number) =>
        makeState({ ageInMonths: 12 * 12, skills: { academic }, flags: ['plan_m1_exam'], eventHistory: [{ id: 'school_start_public', ageInMonths: 12 * 12 - 70 }] });
      expect(isEligible(pass, atResult(threshold))).toBe(true);
      expect(isEligible(fail, atResult(threshold))).toBe(false);
      expect(isEligible(pass, atResult(threshold - 0.1))).toBe(false);
      expect(isEligible(fail, atResult(threshold - 0.1))).toBe(true);
    });

    it('balance guard: if every child took the exam, 15–35% would pass (the top quarter)', () => {
      const took = examLives.filter((end) => end.eventHistory.some((r) => r.id.startsWith('school_m1_exam_')));
      const passed = took.filter((end) => end.eventHistory.some((r) => r.id === 'school_m1_exam_pass'));
      expect(took.length).toBeGreaterThan(300);
      expect(passed.length / took.length).toBeGreaterThan(0.15);
      expect(passed.length / took.length).toBeLessThan(0.35);
    });

    it('after ม.1 starts, the child is in exactly the school they got into', () => {
      const expected: Record<string, string> = {
        school_m1_start_top_public: 'school_top_public',
        school_m1_start_private: 'school_private',
        school_m1_start_international: 'school_international',
      };
      const moved = new Set<string>();
      for (const end of [...examLives, ...ambitiousLives]) {
        const start = end.eventHistory.find((r) => r.id.startsWith('school_m1_start_'));
        if (start === undefined) continue;
        moved.add(start.id);
        const later = end.eventHistory.filter((r) => r.ageInMonths > start.ageInMonths);
        // The grandparents and school fees can still move the child afterwards: check only lives where nothing did.
        if (later.some((r) => r.id.startsWith('family_live_with_grandparents') || r.id === 'school_fees_burden')) continue;
        expect(schoolOf(end)).toEqual([expected[start.id]]);
      }
      expect(moved).toContain('school_m1_start_top_public');
    });

    it('each ม.1 start event leaves the child in its own school only, whichever school they came from', () => {
      // Moving to private or bilingual at ม.1 is rare in real lives (families who can pay chose it at Grade 1),
      // so every path is checked directly here.
      const expected: Record<string, string> = {
        school_m1_start_top_public: 'school_top_public',
        school_m1_start_private: 'school_private',
        school_m1_start_international: 'school_international',
      };
      for (const [eventId, school] of Object.entries(expected)) {
        for (const before of SCHOOL_FLAGS) {
          const state = makeState({ ageInMonths: 12 * 12, flags: [before, 'plan_m1_exam'] });
          applyEvent(state, findEvent(eventId)!);
          expect(schoolOf(state)).toEqual([school]);
        }
      }
    });

    it('whatever the player picks, a child is never in two schools', () => {
      for (const end of [...examLives, ...ambitiousLives]) expect(schoolOf(end)).toHaveLength(1);
    });
  });

  it('milestones everyone goes through happen to every child, once, inside their age range (D67 window)', () => {
    const MILESTONES: [string[], number, number][] = [
      [['growth_first_word', 'growth_first_word_unnoticed'], 1, 1],
      [['growth_first_sentence'], 2, 2],
      [['growth_self_care'], 2, 4],
      [['growth_toilet_training'], 2, 3],
      [['growth_numbers_letters'], 4, 6],
      [['growth_memory_problem_solving'], 4, 6],
      [['school_first_club'], 7, 9],
    ];
    for (const end of ends.filter((e) => e.ageInMonths >= 10 * 12)) {
      for (const [versions, from, to] of MILESTONES) {
        const got = end.eventHistory.filter((r) => versions.includes(r.id));
        expect(got).toHaveLength(1);
        const age = Math.floor(got[0]!.ageInMonths / 12);
        expect(age).toBeGreaterThanOrEqual(from);
        expect(age).toBeLessThanOrEqual(to);
      }
    }
  });

  it('a rare event stays rare: a seriously ill relative in about 1 in 12 lives, not nearly all (D67)', () => {
    const grown = ends.filter((end) => end.ageInMonths >= 18 * 12);
    const share = grown.filter((end) => ids(end).includes('family_relative_seriously_ill')).length / grown.length;
    expect(share).toBeLessThan(0.15); // 1% a year over ages 10–17 ≈ 8%; it was 99% with the shared pool
  });

  it('timid children are bullied more often than bold ones (D68: chanceBy risk-taking low)', () => {
    const rate = (keep: (riskTaking: number) => boolean) => {
      const group = ends.filter((end) => end.ageInMonths >= 10 * 12 && keep(createNewLife(end.seed).traits.riskTaking));
      return group.filter((end) => ids(end).includes('school_bullied')).length / group.length;
    };
    expect(rate((r) => r < 40)).toBeGreaterThan(rate((r) => r >= 60) * 1.5);
  });

  describe('traits: downsides and events that change them', () => {
    const TRAITS = ['discipline', 'resilience', 'riskTaking', 'imagination'] as const;
    type TraitValues = Record<(typeof TRAITS)[number], number>;

    /**
     * Traits right before each record's MONTH: only events change traits, and
     * each record keeps its real change, so the birth values plus the changes
     * so far rebuild them exactly. Event conditions are checked before any
     * event of the month is applied, hence "before the month".
     */
    /** Traits and family values: the values event conditions can test that only events change. */
    type Values = TraitValues & { familyWealth: number; familyWarmth: number };

    function traitsBeforeEachMonth(end: (typeof ends)[number]): Values[] {
      const birth = createNewLife(end.seed);
      const running: Values = { ...birth.traits, familyWealth: birth.environment.familyWealth, familyWarmth: birth.environment.familyWarmth };
      let monthStart: Values = { ...running };
      let month = -1;
      return end.eventHistory.map((record) => {
        if (record.ageInMonths !== month) {
          month = record.ageInMonths;
          monthStart = { ...running };
        }
        for (const [key, change] of [...Object.entries(record.traitChanges ?? {}), ...Object.entries(record.environmentChanges ?? {})]) {
          if (key in running) running[key as keyof Values] += change;
        }
        return monthStart;
      });
    }

    it('rebuilding traits from the records matches the final traits (the check below relies on it)', () => {
      for (const end of ends) {
        const running = { ...createNewLife(end.seed).traits };
        for (const r of end.eventHistory) for (const [t, c] of Object.entries(r.traitChanges ?? {})) running[t as keyof TraitValues] += c;
        for (const t of TRAITS) expect(running[t]).toBeCloseTo(end.traits[t], 6);
      }
    });

    it('every event that needs a trait or family level (discipline ≥ 70, warmth ≥ 60...) only happened at that level', () => {
      const CHECKED = [...TRAITS, 'familyWealth', 'familyWarmth'];
      let checked = 0;
      for (const end of ends) {
        const before = traitsBeforeEachMonth(end);
        end.eventHistory.forEach((record, i) => {
          for (const s of findEvent(record.id)!.conditions.stats ?? []) {
            if (!CHECKED.includes(s.stat)) continue;
            const value = before[i]![s.stat as keyof Values];
            expect(s.op === '>=' ? value >= s.value : value < s.value).toBe(true);
            checked += 1;
          }
        });
      }
      expect(checked).toBeGreaterThan(500);
    });

    it('a story that states a family fact also requires it (a value that only makes it likelier is not enough)', () => {
      // Reported by the player: "over-protective, worried adults" in a family with warmth 15.
      const needs: Record<string, { stat: string; op: '>=' | '<' }> = {
        family_overprotective: { stat: 'familyWarmth', op: '>=' },
        family_praise_only_when_perfect: { stat: 'familyWarmth', op: '<' },
        family_harsh_scolding: { stat: 'familyWarmth', op: '<' },
        family_art_supplies: { stat: 'familyWealth', op: '>=' },
      };
      for (const [id, need] of Object.entries(needs)) {
        expect(findEvent(id)!.conditions.stats?.some((s) => s.stat === need.stat && s.op === need.op), id).toBe(true);
      }
    });

    it('opposite parenting styles never happen in the same life (overprotected vs free to experiment)', () => {
      for (const end of ends) {
        expect(ids(end).includes('family_overprotective') && ids(end).includes('family_freedom_to_experiment')).toBe(false);
      }
    });

    it('"someone stood by you" only comes after a hard time in the family', () => {
      const HARD = [
        'family_parent_lost_job', 'family_parent_lost_job_while_away', 'family_parents_divorce',
        'family_relative_seriously_ill', 'family_live_with_grandparents', 'family_live_with_grandparents_after_job_loss',
      ];
      let seen = 0;
      for (const end of ends) {
        const at = ids(end).indexOf('family_supported_through_hard_time');
        if (at < 0) continue;
        seen += 1;
        expect(ids(end).slice(0, at).some((id) => HARD.includes(id))).toBe(true);
      }
      expect(seen).toBeGreaterThan(0);
    });

    it('balance guard: content keeps every trait roughly where it started (mean, spread)', () => {
      // Growing up raises discipline for everyone (self-care, toilet training, class rules: about +4),
      // which shifts all children together; the guard catches content that pushes a trait much further,
      // or squeezes or stretches the spread so that a trait stops telling children apart.
      const grown = ends.filter((end) => end.ageInMonths >= 19 * 12);
      for (const t of TRAITS) {
        const birth = grown.map((end) => createNewLife(end.seed).traits[t]);
        const at18 = grown.map((end) => end.history.find((y) => y.age === 18)!.snapshot.traits![t]);
        const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length;
        const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
        expect(Math.abs(mean(at18) - mean(birth)), `${t}: mean moved too far`).toBeLessThan(5);
        expect(sd(at18) / sd(birth), `${t}: spread changed`).toBeGreaterThan(0.85);
        expect(sd(at18) / sd(birth), `${t}: spread changed`).toBeLessThan(1.15);
      }
    });
  });

  describe('smoking and drinking (D69)', () => {
    const KINDS = [
      { key: 'smoking', tryFrom: 13, tryTo: 17 },
      { key: 'drinking', tryFrom: 18, tryTo: 30 },
    ] as const;

    it('try only in its age range; addicted only after trying; quitting only after deciding to quit', () => {
      let hooked = 0;
      let quit = 0;
      for (const end of ends) {
        for (const { key, tryFrom, tryTo } of KINDS) {
          const p = `health_${key}`;
          let tried = false;
          let addicted = false;
          let quitting = false;
          for (const record of end.eventHistory) {
            const age = Math.floor(record.ageInMonths / 12);
            if (record.id === `${p}_try`) {
              expect(age).toBeGreaterThanOrEqual(tryFrom);
              expect(age).toBeLessThanOrEqual(tryTo);
              tried = record.choiceId === 'try';
            }
            if (record.id === `${p}_hooked`) {
              expect(tried).toBe(true);
              addicted = true;
              hooked += 1;
            }
            if (record.id === `${p}_cost` || record.id === `${p}_want_to_quit`) expect(addicted).toBe(true);
            if (record.id === `${p}_want_to_quit` && record.choiceId !== 'not_now') quitting = true;
            if (record.id === `${p}_relapse`) {
              expect(quitting).toBe(true);
              quitting = false;
            }
            if (record.id === `${p}_quit_with_clinic` || record.id === `${p}_quit_alone`) {
              expect(quitting).toBe(true);
              addicted = false;
              quitting = false;
              quit += 1;
            }
          }
          // The habit at the end of the life tells the same story as the events.
          expect(end.habits[key]).toBe(addicted ? 'addicted' : 'none');
        }
      }
      expect(hooked).toBeGreaterThan(0);
      expect(quit).toBeGreaterThan(0);
    });

    it('late-night gaming only in families that can afford a phone or computer (wealth ≥ 31)', () => {
      for (const end of ends) {
        let wealth = createNewLife(end.seed).environment.familyWealth;
        for (const record of end.eventHistory) {
          if (record.id === 'social_late_night_gaming') expect(wealth).toBeGreaterThanOrEqual(31);
          wealth += record.environmentChanges?.familyWealth ?? 0;
        }
      }
    });
  });

  it('malnutrition hits only poor families, at most once per 12 months', () => {
    for (const end of ends) {
      const months = end.eventHistory.filter((r) => r.id === 'health_malnutrition').map((r) => r.ageInMonths);
      // Family wealth when it happened: only events change it, and each records its real change.
      let wealth = createNewLife(end.seed).environment.familyWealth;
      for (const record of end.eventHistory) {
        if (record.id === 'health_malnutrition') expect(wealth).toBeLessThan(31);
        wealth += record.environmentChanges?.familyWealth ?? 0;
      }
      expect(wealth).toBeCloseTo(end.environment.familyWealth, 5);
      months.slice(1).forEach((month, i) => expect(month - months[i]!).toBeGreaterThanOrEqual(12));
    }
  });
});
