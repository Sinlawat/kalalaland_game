/**
 * D72: what the friends card and the life summary show, computed from the
 * facts stored on each person (when they met, what they were to each other
 * and when, why it ended). Pure functions, unit-tested directly.
 */

import { closestRelation, currentFriends, currentRelation, metAt, monthsTogether } from '../engine/people';
import type { EndReason, GameState, Relation } from '../engine/types';

/** One line of the friends card: someone the character is still close to. */
export interface FriendLine {
  id: number;
  nickname: string;
  relation: Relation;
  /** Whole years of age when they became what they are now. */
  sinceAge: number;
}

/** Best friend first, then by how long the relationship has been what it is. */
export function friendLines(state: Pick<GameState, 'people'>): FriendLine[] {
  return currentFriends(state).map((person) => {
    const period = person.periods.at(-1)!;
    return { id: person.id, nickname: person.nickname, relation: currentRelation(person)!, sinceAge: Math.floor(period.from / 12) };
  });
}

/** One row of the life summary: everyone who was ever a friend. */
export interface LifeFriendRow {
  id: number;
  nickname: string;
  /** Best friend if they ever were one. */
  relation: Relation;
  /** Months as friends of any kind. */
  months: number;
  fromAge: number;
  toAge: number;
  /** Why it ended; undefined = still friends on the last day. */
  endReason?: EndReason;
  metVia: string;
}

export interface LifeFriends {
  rows: LifeFriendRow[];
  /** Everyone who was ever a friend: friendships that ended still count. */
  lifetime: number;
  /** Still friends on the last day of life. */
  untilTheEnd: number;
}

/**
 * The life summary's friends, in the order they met. `endAge` is the age
 * (months) the life ended or has reached: a friendship still going counts to it.
 */
export function lifeFriends(state: Pick<GameState, 'people'>, endAge: number): LifeFriends {
  const rows = [...state.people]
    .sort((a, b) => metAt(a) - metAt(b) || a.id - b.id)
    .map((person) => ({
      id: person.id,
      nickname: person.nickname,
      relation: closestRelation(person),
      months: monthsTogether(person, endAge),
      fromAge: Math.floor(metAt(person) / 12),
      toAge: Math.floor((person.periods.at(-1)?.to ?? endAge) / 12),
      ...(person.endReason !== undefined ? { endReason: person.endReason } : {}),
      metVia: person.metVia,
    }));
  return { rows, lifetime: rows.length, untilTheEnd: rows.filter((row) => row.endReason === undefined).length };
}
