import { describe, expect, it } from 'vitest';
import type { Person } from '../engine/types';
import { friendLines, lifeFriends } from './friends';

function person(id: number, nickname: string, periods: Person['periods'], extra: Partial<Person> = {}): Person {
  return { id, nickname, sex: 'female', ageGapMonths: 0, metVia: 'social_new_best_friend', tags: [], periods, ...extra };
}

const people: Person[] = [
  person(1, 'แพร', [{ relation: 'friend', from: 150, to: 198 }], { endReason: 'fell_out' }),
  person(2, 'ต้น', [
    { relation: 'friend', from: 100, to: 110 },
    { relation: 'best_friend', from: 110 },
  ]),
  person(3, 'ภูมิ', [{ relation: 'friend', from: 170 }]),
];

describe('friends card (D72)', () => {
  it('shows only friends still close, best friend first, since the current relation began', () => {
    expect(friendLines({ people })).toEqual([
      { id: 2, nickname: 'ต้น', relation: 'best_friend', sinceAge: 9 },
      { id: 3, nickname: 'ภูมิ', relation: 'friend', sinceAge: 14 },
    ]);
  });
});

describe('life summary friends (D72)', () => {
  const summary = lifeFriends({ people }, 900);

  it('counts everyone ever a friend, and those still there at the end', () => {
    expect(summary.lifetime).toBe(3);
    expect(summary.untilTheEnd).toBe(2);
  });

  it('lists them in the order they met, with time together and how it ended', () => {
    expect(summary.rows.map((row) => [row.nickname, row.relation, row.months, row.fromAge, row.toAge, row.endReason])).toEqual([
      ['ต้น', 'best_friend', 800, 8, 75, undefined],
      ['แพร', 'friend', 48, 12, 16, 'fell_out'],
      ['ภูมิ', 'friend', 730, 14, 75, undefined],
    ]);
  });

  it('is empty for a life without friends', () => {
    expect(lifeFriends({ people: [] }, 300)).toEqual({ rows: [], lifetime: 0, untilTheEnd: 0 });
  });
});
