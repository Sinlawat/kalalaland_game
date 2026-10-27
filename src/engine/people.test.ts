import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import names from '../data/names.json';
import { applyEvent, applyChoice, isEligible, parseEvents, personFor, type EventDef } from './events';
import { advanceOneMonth } from './game';
import {
  applyFriendsEffects,
  applyPersonEffect,
  bestFriend,
  closestRelation,
  currentFriends,
  currentRelation,
  meetSomeone,
  meetsPeopleConditions,
  monthsTogether,
} from './people';
import { createRng } from './rng';
import { makeState } from './testUtils';
import { END_REASONS, type GameState, type Person } from './types';

/** A person as the engine would store them, for tests that start with friends already made. */
function person(id: number, nickname: string, periods: Person['periods'], extra: Partial<Person> = {}): Person {
  return { id, nickname, sex: 'male', ageGapMonths: 0, metVia: 'test', tags: [], periods, ...extra };
}

const AGE = 120; // 10 years old

describe('meeting someone new (D72)', () => {
  it('never gives a name the character or anyone in this life already has', () => {
    const state = makeState({ sex: 'male', nickname: names.male[0]!, people: names.male.slice(1, 40).map((n, i) => person(i + 1, n, [{ relation: 'friend', from: 0 }])) });
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const met = meetSomeone(state, rng, 'test');
      if (met.sex === 'male') expect(names.male.slice(0, 40)).not.toContain(met.nickname);
    }
  });

  it('does not give the same name to two people met in the same month (one still waiting for a choice)', () => {
    const state = makeState({ sex: 'female' });
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const first = meetSomeone(state, rng, 'test');
      const waiting = { ...state, pendingChoices: [{ eventId: 'test', ageInMonths: AGE, person: first }] };
      const second = meetSomeone(waiting, rng, 'test');
      expect(second.nickname).not.toBe(first.nickname);
      expect(second.id).not.toBe(first.id);
    }
  });

  it('uses a name again only when the whole list is taken, instead of failing', () => {
    const everyone = [...names.male, ...names.female].map((n, i) => person(i + 1, n, [{ relation: 'friend', from: 0 }]));
    const met = meetSomeone(makeState({ people: everyone }), createRng(5), 'test');
    expect([...names.male, ...names.female]).toContain(met.nickname);
  });

  it(`is the same sex as the character about ${BALANCE.people.sameSexShare * 100}% of the time, a classmate's age, with a new id`, () => {
    const state = makeState({ sex: 'female', people: [person(7, 'x', [{ relation: 'friend', from: 0 }])] });
    const rng = createRng(11);
    let same = 0;
    const tries = 4000;
    for (let i = 0; i < tries; i++) {
      const met = meetSomeone(state, rng, 'social_x');
      if (met.sex === 'female') same += 1;
      expect(Math.abs(met.ageGapMonths)).toBeLessThanOrEqual(BALANCE.people.classmateAgeGapMonths);
      expect(met.id).toBe(8);
      expect(met.metVia).toBe('social_x');
      expect(met.periods).toEqual([]);
    }
    expect(same / tries).toBeGreaterThan(BALANCE.people.sameSexShare - 0.03);
    expect(same / tries).toBeLessThan(BALANCE.people.sameSexShare + 0.03);
  });

  it('draws exactly three random numbers (sex, name, age gap)', () => {
    const state = makeState();
    const rng = createRng(99);
    meetSomeone(state, rng, 'test');
    const after = createRng(99);
    after.next();
    after.next();
    after.next();
    expect(rng.state).toBe(after.state);
  });
});

describe('changing relationships (D72)', () => {
  const stranger = (): Person => person(1, 'ต้น', []);

  it('someone new is kept only when befriended', () => {
    const state = makeState({ ageInMonths: AGE });
    expect(applyPersonEffect(state, stranger(), {}, AGE)).toEqual({ nickname: 'ต้น' });
    expect(state.people).toEqual([]);
    expect(applyPersonEffect(state, stranger(), { befriend: 'friend' }, AGE)).toEqual({ nickname: 'ต้น', id: 1 });
    expect(state.people[0]!.periods).toEqual([{ relation: 'friend', from: AGE }]);
  });

  it('there is one best friend at a time: a new one turns the old one into a friend', () => {
    const state = makeState({ people: [person(1, 'ก้อง', [{ relation: 'best_friend', from: 80 }])] });
    applyPersonEffect(state, person(2, 'บีม', []), { befriend: 'best_friend' }, AGE);
    expect(currentRelation(state.people[0]!)).toBe('friend');
    expect(state.people[0]!.periods).toEqual([
      { relation: 'best_friend', from: 80, to: AGE },
      { relation: 'friend', from: AGE },
    ]);
    expect(bestFriend(state)?.nickname).toBe('บีม');
  });

  it('"become" moves a friend up (stepping the old best friend down) without overlapping periods', () => {
    const state = makeState({
      people: [person(1, 'ก้อง', [{ relation: 'best_friend', from: 80 }]), person(2, 'บีม', [{ relation: 'friend', from: 90 }])],
    });
    applyPersonEffect(state, state.people[1]!, { become: 'best_friend' }, AGE);
    expect(bestFriend(state)?.id).toBe(2);
    expect(state.people[1]!.periods).toEqual([
      { relation: 'friend', from: 90, to: AGE },
      { relation: 'best_friend', from: AGE },
    ]);
    expect(state.people.filter((p) => currentRelation(p) === 'best_friend')).toHaveLength(1);
  });

  it('a change in the month they met replaces the relation instead of making a zero-month period', () => {
    const state = makeState();
    applyPersonEffect(state, stranger(), { befriend: 'friend' }, AGE);
    applyPersonEffect(state, state.people[0]!, { become: 'best_friend' }, AGE);
    expect(state.people[0]!.periods).toEqual([{ relation: 'best_friend', from: AGE }]);
  });

  it('ending keeps the person, closes the last period and records why', () => {
    const state = makeState({ people: [person(1, 'ก้อง', [{ relation: 'best_friend', from: 80 }])] });
    applyPersonEffect(state, state.people[0]!, { end: 'moved_away' }, AGE);
    expect(state.people).toHaveLength(1);
    expect(state.people[0]!.endReason).toBe('moved_away');
    expect(state.people[0]!.periods).toEqual([{ relation: 'best_friend', from: 80, to: AGE }]);
    expect(currentFriends(state)).toEqual([]);
  });

  it('leaves a relationship that already ended as it was', () => {
    const ended = person(1, 'ก้อง', [{ relation: 'friend', from: 80, to: 100 }], { endReason: 'fell_out' });
    const state = makeState({ people: [ended] });
    applyPersonEffect(state, state.people[0]!, { become: 'best_friend', end: 'moved_away', tag: 'x' }, AGE);
    expect(state.people[0]).toEqual(ended);
  });

  it('tags and untags', () => {
    const state = makeState({ people: [person(1, 'ก้อง', [{ relation: 'best_friend', from: 80 }])] });
    applyPersonEffect(state, state.people[0]!, { tag: 'far_away' }, AGE);
    applyPersonEffect(state, state.people[0]!, { tag: 'far_away' }, AGE);
    expect(state.people[0]!.tags).toEqual(['far_away']);
    applyPersonEffect(state, state.people[0]!, { untag: 'far_away' }, AGE);
    expect(state.people[0]!.tags).toEqual([]);
  });

  it('a group effect reaches only its group: friends, the best friend, or everyone still close', () => {
    const make = () =>
      makeState({
        people: [
          person(1, 'ก้อง', [{ relation: 'best_friend', from: 80 }]),
          person(2, 'บีม', [{ relation: 'friend', from: 90 }]),
          person(3, 'ปาย', [{ relation: 'friend', from: 70, to: 100 }], { endReason: 'fell_out' }),
        ],
      });
    const friends = make();
    applyFriendsEffects(friends, [{ who: 'friends', end: 'graduated' }], AGE);
    expect(friends.people.map((p) => p.endReason)).toEqual([undefined, 'graduated', 'fell_out']);
    expect(friends.people[2]!.periods[0]!.to).toBe(100); // an old ending is not moved

    const best = make();
    applyFriendsEffects(best, [{ who: 'best_friend', tag: 'far_away' }], AGE);
    expect(best.people.map((p) => p.tags)).toEqual([['far_away'], [], []]);

    const everyone = make();
    applyFriendsEffects(everyone, [{ who: 'everyone', end: 'changed_school' }], AGE);
    expect(currentFriends(everyone)).toEqual([]);
  });
});

describe('counting time together (D72)', () => {
  const life = person(1, 'ก้อง', [
    { relation: 'friend', from: 96, to: 108 },
    { relation: 'best_friend', from: 108, to: 216 },
  ]);

  it('adds up the periods, per relation or all together', () => {
    expect(monthsTogether(life, 900)).toBe(120);
    expect(monthsTogether(life, 900, 'best_friend')).toBe(108);
    expect(monthsTogether(life, 900, 'friend')).toBe(12);
  });

  it('a friendship still going counts until now, and is zero in the month they met', () => {
    const ongoing = person(2, 'บีม', [{ relation: 'friend', from: 100 }]);
    expect(monthsTogether(ongoing, 100)).toBe(0);
    expect(monthsTogether(ongoing, 160)).toBe(60);
  });

  it('a best friend stays a best friend in the summary, even after stepping down', () => {
    expect(closestRelation(person(3, 'ปาย', [{ relation: 'best_friend', from: 0, to: 5 }, { relation: 'friend', from: 5 }]))).toBe('best_friend');
    expect(closestRelation(person(4, 'ภู', [{ relation: 'friend', from: 0 }]))).toBe('friend');
  });
});

describe('people conditions (D72)', () => {
  const withBest = (tags: string[] = []) =>
    makeState({ people: [person(1, 'ก้อง', [{ relation: 'best_friend', from: 80 }], { tags }), person(2, 'บีม', [{ relation: 'friend', from: 90 }])] });

  it.each([
    [{ bestFriend: true }, withBest(), true],
    [{ bestFriend: true }, makeState(), false],
    [{ bestFriend: false }, makeState(), true],
    [{ friendsMin: 2 }, withBest(), true],
    [{ friendsMin: 3 }, withBest(), false],
    [{ tagsAll: ['far_away'] }, withBest(['far_away']), true],
    [{ tagsAll: ['far_away'] }, withBest(), false],
    [{ tagsNone: ['far_away'] }, withBest(['far_away']), false],
    [{ tagsNone: ['far_away'] }, withBest(), true],
  ])('%j', (conditions, state, expected) => {
    expect(meetsPeopleConditions(state, conditions, bestFriend(state))).toBe(expected);
  });
});

describe('events about a person (D72)', () => {
  const base = { conditions: { ageMin: 0, ageMax: 99 }, frequency: 'guaranteed', once: true };
  const [moves, meet, together] = parseEvents([
    { ...base, id: 'moves', about: 'best_friend', choices: [{ id: 'keep', effects: { person: { tag: 'far_away' } } }, { id: 'let_go', effects: { person: { end: 'moved_away' } } }] },
    { ...base, id: 'meet', about: 'new_person', choices: [{ id: 'yes', effects: { person: { befriend: 'best_friend' } } }, { id: 'no', effects: {} }] },
    { ...base, id: 'together', about: 'best_friend', conditions: { ageMin: 0, ageMax: 99, people: { tagsAll: ['far_away'] } }, effects: { person: { end: 'drifted_apart' } } },
  ]) as [EventDef, EventDef, EventDef];
  const withBest = (): GameState => makeState({ ageInMonths: AGE, people: [person(1, 'ก้อง', [{ relation: 'best_friend', from: 80 }])] });

  it('an event about the best friend cannot happen without one', () => {
    expect(isEligible(moves, makeState({ ageInMonths: AGE }))).toBe(false);
    expect(isEligible(moves, withBest())).toBe(true);
  });

  it('tags chain events: "drift apart" follows only "keep in touch"', () => {
    const state = withBest();
    expect(isEligible(together, state)).toBe(false);
    applyChoice(state, moves, 'keep', AGE, personFor(moves, state, createRng(1)));
    expect(isEligible(together, state)).toBe(true);
    applyEvent(state, together, personFor(together, state, createRng(1)));
    expect(state.people[0]!.endReason).toBe('drifted_apart');
    expect(state.eventHistory.map((r) => r.person)).toEqual([
      { nickname: 'ก้อง', id: 1 },
      { nickname: 'ก้อง', id: 1 },
    ]);
  });

  it('the record keeps the name of someone met but not befriended', () => {
    const state = makeState({ ageInMonths: AGE });
    const met = personFor(meet, state, createRng(4))!;
    applyChoice(state, meet, 'no', AGE, met);
    expect(state.people).toEqual([]);
    expect(state.eventHistory[0]!.person).toEqual({ nickname: met.nickname });
  });

  it('the game loop gives a waiting choice its person, and befriends them after the choice', () => {
    const state = makeState({ ageInMonths: AGE, pendingChoices: [] });
    const waiting = advanceOneMonth(state, [meet]).state;
    const pending = waiting.pendingChoices[0]!;
    expect(pending.person?.nickname).toBeTruthy();
    expect(waiting.people).toEqual([]);
    // resolveChoice looks events up in the game's own list, so apply the test event's choice directly.
    const after = structuredClone(waiting);
    applyChoice(after, meet, 'yes', pending.ageInMonths, pending.person);
    expect(after.people.map((p) => p.nickname)).toEqual([pending.person!.nickname]);
    expect(bestFriend(after)?.periods).toEqual([{ relation: 'best_friend', from: pending.ageInMonths }]);
    expect(after.eventHistory.at(-1)!.person).toEqual({ nickname: pending.person!.nickname, id: pending.person!.id });
  });

  it('every end reason has been written into the type list (no typo in content can slip through)', () => {
    expect(END_REASONS.length).toBeGreaterThan(0);
    expect(() => parseEvents([{ ...base, id: 'x', about: 'best_friend', effects: { person: { end: 'vanished' } } }])).toThrow('person.end must be one of');
  });
});
