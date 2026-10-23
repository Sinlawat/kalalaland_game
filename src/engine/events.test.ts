import { describe, expect, it } from 'vitest';
import { hasMessage } from '../i18n/i18n';
import { BALANCE } from '../data/balance';
import {
  applyChoice,
  applyEvent,
  calendarMonth,
  EVENTS,
  hasHappened,
  isEligible,
  lockReasons,
  monthlyPoolChance,
  poolEventsPerYear,
  pickWeighted,
  lifetimeRoll,
  parseEvents,
  rollEvents,
  traitEffectFactor,
  type EventChoice,
  type EventDef,
} from './events';
import { simulateWholeLife } from './game';
import { createNewLife } from './newLife';
import { createRng } from './rng';
import { makeState } from './testUtils';

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

  it('every real event has a Thai title and text, and every choice a label and a result', () => {
    const keys = EVENTS.flatMap((e) => [
      `event.${e.id}.title`,
      `event.${e.id}.text`,
      ...(e.choices ?? []).flatMap((c) => [
        `event.${e.id}.choice.${c.id}`,
        `event.${e.id}.result.${c.id}`,
        // A flag condition cannot explain itself: the writer must say why the choice is locked.
        ...(c.conditions?.flagsAll || c.conditions?.flagsNone ? [`event.${e.id}.choice.${c.id}.locked`] : []),
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
      const locked: EventChoice = { id: 'b', conditions: { stats: [{ stat: 'knowledge', op: '>=', value: 70 }] }, effects: {} };
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
    conditions: { stats: [{ stat: 'knowledge', op: '>=', value: 70 }], flagsNone: ['expelled'] },
    effects: {},
  };

  it('is empty when every condition is met (70 is enough for >= 70)', () => {
    expect(lockReasons(choice, makeState({ condition: { knowledge: 70 } }))).toEqual([]);
  });

  it('names the missing stat with the current value, and a separate reason for flags', () => {
    expect(lockReasons(choice, makeState({ condition: { knowledge: 45 }, flags: ['expelled'] }))).toEqual([
      { kind: 'stat', stat: 'knowledge', op: '>=', value: 70, current: 45 },
      { kind: 'flag' },
    ]);
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

describe('the event pool (D53)', () => {
  const poolEvent = (id: string, frequency: EventDef['frequency'], ageMax = 99): EventDef =>
    makeEvent({ id, frequency, once: false, conditions: { ageMin: 0, ageMax } });

  it('has 4 events a year for children and working age, 3 from 60, 2 from 75', () => {
    expect([0, 22, 59, 60, 74, 75, 100].map(poolEventsPerYear)).toEqual([4, 4, 4, 3, 3, 2, 2]);
    expect(monthlyPoolChance(30)).toBeCloseTo(4 / 12, 12);
  });

  it('at most ONE pool event a month, about 4 a year, however many events are written', () => {
    for (const size of [1, 50, 2000]) {
      const events = Array.from({ length: size }, (_, i) => poolEvent(`e${i}`, 'normal'));
      const state = makeState({ ageInMonths: 30 * 12 });
      const rng = createRng(size);
      let total = 0;
      for (let month = 0; month < 1200; month++) {
        const got = rollEvents(state, rng, events);
        expect(got.length).toBeLessThanOrEqual(1);
        total += got.length;
      }
      expect(total / 100).toBeGreaterThan(3.5); // 1200 months = 100 years
      expect(total / 100).toBeLessThan(4.5);
    }
  });

  it('picks by weight: common (14) about 14 times as often as rare (1)', () => {
    const pool = [poolEvent('r', 'rare'), poolEvent('c', 'common')];
    const rng = createRng(3);
    const counts = { r: 0, c: 0 };
    for (let i = 0; i < 15000; i++) counts[pickWeighted(pool, rng).id as 'r' | 'c'] += 1;
    expect(counts.c / counts.r).toBeGreaterThan(12);
    expect(counts.c / counts.r).toBeLessThan(16.5);
  });

  it('guaranteed events are outside the pool: they always happen, alongside a pool event', () => {
    const always = makeEvent({ id: 'always', frequency: 'guaranteed', once: true, conditions: { ageMin: 30, ageMax: 30 } });
    const events = [always, poolEvent('p', 'common')];
    const state = makeState({ ageInMonths: 30 * 12 });
    const rng = createRng(1);
    const months = Array.from({ length: 60 }, () => rollEvents(state, rng, events).map((e) => e.id));
    expect(months.every((ids) => ids.includes('always'))).toBe(true);
    expect(months.some((ids) => ids.includes('p'))).toBe(true);
  });

  it('nothing happens when no pool event fits the age', () => {
    const later = poolEvent('later', 'common');
    later.conditions = { ageMin: 50, ageMax: 60 };
    const rng = createRng(1);
    for (let month = 0; month < 100; month++) expect(rollEvents(makeState({ ageInMonths: 30 * 12 }), rng, [later])).toEqual([]);
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
      { id: 'tech', conditions: { stats: [{ stat: 'knowledge', op: '>=', value: 70 }] }, effects: {} },
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
    expect(() => applyChoice(makeState({ condition: { knowledge: 10 } }), dream, 'tech', 144)).toThrow('locked');
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

  it('children with extra vaccines never get chickenpox', () => {
    const vaccinated = ends.filter((end) => end.flags.includes('extra_vaccines'));
    expect(vaccinated.length).toBeGreaterThan(0);
    expect(vaccinated.filter((end) => ids(end).includes('health_chickenpox'))).toEqual([]);
  });

  it('children without extra vaccines nearly all get chickenpox by 13 (few childhood events compete in the pool yet)', () => {
    const basic = ends.filter((end) => !end.flags.includes('extra_vaccines') && end.ageInMonths >= 13 * 12);
    const share = basic.filter((end) => ids(end).includes('health_chickenpox')).length / basic.length;
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

    it('a parent finds a new job only after losing one', () => {
      for (const end of ends) {
        const found = indexOf(end, 'family_parent_new_job');
        if (found >= 0) expect(indexOf(end, 'family_parent_lost_job')).toBeLessThan(found);
        if (found >= 0) expect(indexOf(end, 'family_parent_lost_job')).toBeGreaterThanOrEqual(0);
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
