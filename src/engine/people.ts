/**
 * People in the character's life (D72, phase 1: friends).
 *
 * Rules the engine keeps, whatever the content does:
 * - at most one best friend at a time (a new one turns the old one into a friend);
 * - a person's periods follow each other and never overlap;
 * - an ended relationship has an end reason, and its last period has an end;
 * - nobody is removed: the life summary counts friendships that ended too.
 *
 * One event is about one person (`about` in events.json): the current best
 * friend, or someone new. Someone new is made when the event happens, so the
 * choice popup can already show their name, and is kept only if the event
 * befriends them.
 *
 * Functions that change the state MUTATE it (engine-private copy, like the
 * rest of the engine); the read helpers never do.
 */

import { BALANCE } from '../data/balance';
import names from '../data/names.json';
import type { Rng } from './rng';
import type { EndReason, GameState, Person, PersonRef, Relation, RelationPeriod, Sex } from './types';

// ── Reading ─────────────────────────────────────────────────────────────────

/** The period still going on, or undefined when the relationship ended. */
export function currentPeriod(person: Person): RelationPeriod | undefined {
  const last = person.periods.at(-1);
  return last !== undefined && last.to === undefined ? last : undefined;
}

/** What the person is to the character now; undefined once the relationship ended. */
export function currentRelation(person: Person): Relation | undefined {
  return currentPeriod(person)?.relation;
}

/** Everyone the character is still close to, best friend first, then by when they met. */
export function currentFriends(state: Pick<GameState, 'people'>): Person[] {
  const current = state.people.filter((person) => currentRelation(person) !== undefined);
  return [...current].sort((a, b) => Number(currentRelation(b) === 'best_friend') - Number(currentRelation(a) === 'best_friend'));
}

export function bestFriend(state: Pick<GameState, 'people'>): Person | undefined {
  return state.people.find((person) => currentRelation(person) === 'best_friend');
}

/** When they met: the start of the first period (months of the character's age). */
export function metAt(person: Person): number {
  return person.periods[0]?.from ?? 0;
}

/**
 * Months the two spent as `relation` (or in any relation when omitted).
 * A period still going on counts until `now` (the character's age, or the age at death).
 */
export function monthsTogether(person: Person, now: number, relation?: Relation): number {
  return person.periods
    .filter((period) => relation === undefined || period.relation === relation)
    .reduce((sum, period) => sum + Math.max(0, (period.to ?? now) - period.from), 0);
}

/** The highest relation the person ever had: a best friend stays "best friend" in the summary even after a change. */
export function closestRelation(person: Person): Relation {
  return person.periods.some((period) => period.relation === 'best_friend') ? 'best_friend' : 'friend';
}

export function refOf(person: Person, kept: boolean): PersonRef {
  return kept ? { nickname: person.nickname, id: person.id } : { nickname: person.nickname };
}

// ── Meeting someone new ─────────────────────────────────────────────────────

const OTHER_SEX: Record<Sex, Sex> = { male: 'female', female: 'male' };

/** Everyone who already has a name in this life: the character, the people, and someone met in a choice still waiting. */
function takenNames(state: GameState): Set<string> {
  return new Set([state.nickname, ...state.people.map((p) => p.nickname), ...state.pendingChoices.flatMap((c) => (c.person ? [c.person.nickname] : []))]);
}

function nextId(state: GameState): number {
  const ids = [...state.people.map((p) => p.id), ...state.pendingChoices.flatMap((c) => (c.person ? [c.person.id] : []))];
  return Math.max(0, ...ids) + 1;
}

/**
 * Someone new, met in `metVia`. Not added to `people`: the event decides.
 * RNG draws: 3 (sex, nickname, age gap).
 * A name nobody in this life has yet; if a list ever ran out (50 names each),
 * a name may repeat rather than fail.
 */
export function meetSomeone(state: GameState, rng: Rng, metVia: string): Person {
  const { sameSexShare, classmateAgeGapMonths } = BALANCE.people;
  const sex: Sex = rng.chance(sameSexShare) ? state.sex : OTHER_SEX[state.sex];
  const taken = takenNames(state);
  const list: readonly string[] = names[sex];
  const free = list.filter((name) => !taken.has(name));
  const nickname = rng.pick(free.length > 0 ? free : list);
  const ageGapMonths = rng.int(-classmateAgeGapMonths, classmateAgeGapMonths);
  return { id: nextId(state), nickname, sex, ageGapMonths, metVia, tags: [], periods: [] };
}

// ── Changing relationships ──────────────────────────────────────────────────

/** What an event does to the person it is about (events.json `effects.person`). */
export interface PersonEffect {
  /** Someone new becomes a friend or the best friend (only for `about: "new_person"`). */
  befriend?: Relation;
  /** A friend becomes the best friend, or the other way round. */
  become?: Relation;
  /** The relationship ends, for this reason. */
  end?: EndReason;
  tag?: string;
  untag?: string;
}

/** Who a `friends` effect applies to: friends who are not the best friend, the best friend, or everyone still close. */
export const FRIEND_GROUPS = ['friends', 'best_friend', 'everyone'] as const;
export type FriendGroup = (typeof FRIEND_GROUPS)[number];

/**
 * What an event does to a whole group of friends (events.json `effects.friends`),
 * e.g. everyone in the class goes their own way after Grade 12, or the
 * character changes school and loses touch with the old classmates.
 */
export interface FriendsEffect {
  who: FriendGroup;
  end?: EndReason;
  tag?: string;
}

/** Starts a new period from `age`. A period that would last zero months is replaced instead. */
function changeRelation(person: Person, relation: Relation, age: number): void {
  const period = currentPeriod(person);
  if (period === undefined || period.relation === relation) return;
  if (period.from === age) {
    period.relation = relation;
    return;
  }
  period.to = age;
  person.periods.push({ relation, from: age });
}

function endRelationship(person: Person, reason: EndReason, age: number): void {
  const period = currentPeriod(person);
  if (period === undefined) return;
  period.to = age;
  person.endReason = reason;
}

/** One best friend at a time: the current one (other than `keep`) becomes a friend. */
function stepDownBestFriend(state: GameState, age: number, keep?: Person): void {
  const current = bestFriend(state);
  if (current !== undefined && current !== keep) changeRelation(current, 'friend', age);
}

/**
 * Applies `effect` to the person an event is about and returns how the
 * record names them. `person` is the stored person (best friend) or someone
 * just met; someone met is added to `people` only by `befriend`.
 */
export function applyPersonEffect(state: GameState, person: Person, effect: PersonEffect, age: number): PersonRef {
  let stored = state.people.find((p) => p.id === person.id);
  if (stored === undefined && effect.befriend !== undefined) {
    if (effect.befriend === 'best_friend') stepDownBestFriend(state, age);
    stored = { ...person, tags: [...person.tags], periods: [{ relation: effect.befriend, from: age }] };
    state.people.push(stored);
  }
  if (stored === undefined) return refOf(person, false);
  // A relationship that already ended (e.g. by another event the same month) is left as it is.
  if (currentPeriod(stored) === undefined) return refOf(stored, true);

  if (effect.become !== undefined) {
    if (effect.become === 'best_friend') stepDownBestFriend(state, age, stored);
    changeRelation(stored, effect.become, age);
  }
  if (effect.tag !== undefined && !stored.tags.includes(effect.tag)) stored.tags.push(effect.tag);
  if (effect.untag !== undefined) stored.tags = stored.tags.filter((tag) => tag !== effect.untag);
  if (effect.end !== undefined) endRelationship(stored, effect.end, age);
  return refOf(stored, true);
}

function friendsIn(state: GameState, who: FriendGroup): Person[] {
  const current = currentFriends(state);
  if (who === 'everyone') return current;
  return current.filter((person) => (currentRelation(person) === 'best_friend') === (who === 'best_friend'));
}

export function applyFriendsEffects(state: GameState, effects: readonly FriendsEffect[], age: number): void {
  for (const effect of effects) {
    for (const person of friendsIn(state, effect.who)) {
      if (effect.tag !== undefined && !person.tags.includes(effect.tag)) person.tags.push(effect.tag);
      if (effect.end !== undefined) endRelationship(person, effect.end, age);
    }
  }
}

// ── Conditions ──────────────────────────────────────────────────────────────

/** events.json `conditions.people`. Tags are about the person the event is about (the best friend). */
export interface PeopleConditions {
  /** true: must have a best friend; false: must not. */
  bestFriend?: boolean;
  /** At least this many friends right now (the best friend counts). */
  friendsMin?: number;
  /** The person the event is about has every one of these tags. */
  tagsAll?: string[];
  /** …and none of these. */
  tagsNone?: string[];
}

export function meetsPeopleConditions(state: GameState, c: PeopleConditions, about: Person | undefined): boolean {
  if (c.bestFriend !== undefined && (bestFriend(state) !== undefined) !== c.bestFriend) return false;
  if (c.friendsMin !== undefined && currentFriends(state).length < c.friendsMin) return false;
  if (c.tagsAll && !(about !== undefined && c.tagsAll.every((tag) => about.tags.includes(tag)))) return false;
  if (c.tagsNone && about !== undefined && c.tagsNone.some((tag) => about.tags.includes(tag))) return false;
  return true;
}
