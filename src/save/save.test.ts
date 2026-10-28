import { beforeEach, describe, expect, it } from 'vitest';
import { advanceOneMonth, advanceUntilStop } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import { makeState } from '../engine/testUtils';
import { CURRENT_SAVE_VERSION, deleteSave, loadGame, SAVE_KEY, saveGame, type SaveStorage } from './save';

/** In-memory stand-in for localStorage. */
class MemoryStorage implements SaveStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** Simulates a browser where storage access is blocked. */
const brokenStorage: SaveStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('save / load', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('round-trips the full state, every field', () => {
    let state = createNewLife(21);
    for (let i = 0; i < 3; i++) state = advanceUntilStop(state).state;
    expect(saveGame(storage, state)).toEqual({ status: 'ok' });
    expect(loadGame(storage)).toEqual({ status: 'ok', state });
  });

  it('writes the current save version', () => {
    saveGame(storage, createNewLife(1));
    const envelope = JSON.parse(storage.getItem(SAVE_KEY)!) as { saveVersion: number };
    expect(envelope.saveVersion).toBe(CURRENT_SAVE_VERSION);
  });

  it('reports empty when nothing was saved', () => {
    expect(loadGame(storage)).toEqual({ status: 'empty' });
  });

  it.each([
    ['not JSON', '{oops'],
    ['JSON without a version', '{"state":{}}'],
    ['a valid envelope with a broken state', `{"saveVersion":${CURRENT_SAVE_VERSION},"state":{"seed":"abc"}}`],
    ['a JSON array', '[1,2,3]'],
  ])('reports corrupt for %s', (_label, raw) => {
    storage.setItem(SAVE_KEY, raw);
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
  });

  // D65 (version 8) split knowledge into skills; D71 (version 10) replaced the
  // name with a sex and a nickname. Older lives cannot be converted, so the
  // game says so and the player starts a new life.
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('reports outdated for a save from version %i', (version) => {
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: version, savedAt: '2026-10-22T00:00:00.000Z', state: createNewLife(1) }));
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'outdated' });
  });

  it.each([
    ['no sex', { sex: undefined }],
    ['an unknown sex', { sex: 'other' }],
    ['no nickname', { nickname: undefined }],
    ['an empty nickname', { nickname: '' }],
  ])('rejects a save with %s (D71)', (_label, broken) => {
    const life = { ...createNewLife(3), ...broken };
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: CURRENT_SAVE_VERSION, state: life }));
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
  });

  it('upgrades a version 10 save: no named friends yet (D72)', () => {
    let life = createNewLife(21);
    for (let i = 0; i < 3; i++) life = advanceUntilStop(life).state;
    const { people: _people, ...v10 } = life;
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 10, savedAt: '2026-10-27T00:00:00.000Z', state: v10 }));
    expect(loadGame(storage)).toEqual({ status: 'ok', state: { ...life, people: [] } });
  });

  it('upgrades a version 11 save: education rebuilt from the school start (D74)', () => {
    let life = createNewLife(21);
    while (life.ageInMonths < 16 * 12) life = advanceUntilStop(life, { chooser: (_s, e) => e.choices![0]!.id }).state;
    const { education: _education, ...v11 } = life;
    const start = life.eventHistory.find((r) => r.id.startsWith('school_start_'))!.ageInMonths;
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 11, savedAt: '2026-10-27T00:00:00.000Z', state: v11 }));
    const loaded = loadGame(storage);
    expect(loaded.status).toBe('ok');
    // Lives from before D74 never chose a Grade 10 plan: they continue in the arts-math plan.
    expect(loaded.status === 'ok' && loaded.state.education).toEqual({
      history: [
        { program: 'primary', from: start, to: start + 72, result: 'graduated' },
        { program: 'lower_secondary', from: start + 72, to: start + 108, result: 'graduated' },
        { program: 'upper_secondary_arts_math', from: start + 108 },
      ],
    });
  });

  it('upgrades a version 11 save from before school: no education yet (D74)', () => {
    const { education: _education, ...v11 } = createNewLife(21);
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 11, savedAt: '2026-10-27T00:00:00.000Z', state: v11 }));
    const loaded = loadGame(storage);
    expect(loaded.status === 'ok' && loaded.state.education).toEqual({ history: [] });
  });

  it('upgrades a version 12 save: no job yet, savings 0 (D77)', () => {
    let life = createNewLife(21);
    for (let i = 0; i < 3; i++) life = advanceUntilStop(life).state;
    const { work: _work, money: _money, ...v12 } = life;
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 12, savedAt: '2026-10-28T00:00:00.000Z', state: v12 }));
    expect(loadGame(storage)).toEqual({
      status: 'ok',
      state: { ...life, work: { history: [] }, money: { cash: 0, familySharePercent: 0, monthGiven: 0, year: { earned: 0, given: 0, income: {}, spent: {} }, spendingLevel: 'normal', shortfall: 0, studentLoan: 0 } },
    });
  });

  it('upgrades a version 16 save: the exercise a job took away becomes what the week has no time for (D83)', () => {
    const life = makeState({ ageInMonths: 16 * 12, habits: { exercise: 'none' } });
    life.work = { history: [{ job: 'restaurant', level: 'daily', from: 16 * 12 - 3, restoreExercise: 'regular' }] };
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 16, savedAt: '2026-10-28T00:00:00.000Z', state: life }));
    const loaded = loadGame(storage);
    expect(loaded.status === 'ok' && loaded.state.timeCut).toEqual({ exercise: 'regular' });
    const noJob = makeState({ ageInMonths: 16 * 12 });
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 16, savedAt: '2026-10-28T00:00:00.000Z', state: noJob }));
    expect(loadGame(storage)).toEqual({ status: 'ok', state: noJob });
  });

  it('upgrades a version 15 save: no student loan yet (D82)', () => {
    const life = createNewLife(21);
    const { studentLoan: _loan, ...money15 } = life.money;
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 15, savedAt: '2026-10-28T00:00:00.000Z', state: { ...life, money: money15 } }));
    expect(loadGame(storage)).toEqual({ status: 'ok', state: life });
  });

  it('upgrades a version 14 save: spending starts at the normal level, nothing unpaid (D80)', () => {
    const life = createNewLife(21);
    const { spendingLevel: _level, shortfall: _short, studentLoan: _loan, ...money14 } = life.money;
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 14, savedAt: '2026-10-28T00:00:00.000Z', state: { ...life, money: money14 } }));
    expect(loadGame(storage)).toEqual({ status: 'ok', state: life });
  });

  it('upgrades a version 13 save: the year by source starts empty, the totals stay (D79)', () => {
    const life = createNewLife(21);
    const v13 = { ...life, money: { ...life.money, cash: 500, year: { earned: 2400, given: 0 } } };
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 13, savedAt: '2026-10-28T00:00:00.000Z', state: v13 }));
    const loaded = loadGame(storage);
    expect(loaded.status === 'ok' && loaded.state.money).toEqual({ ...life.money, cash: 500, year: { earned: 2400, given: 0, income: {}, spent: {} } });
  });

  it.each([
    ['negative savings', { money: { cash: -1, familySharePercent: 0, monthGiven: 0, year: { earned: 0, given: 0, income: {}, spent: {} } } }],
    ['income by source that is not a number (D79)', { money: { cash: 0, familySharePercent: 0, monthGiven: 0, year: { earned: 0, given: 0, income: { 'job.cafe': 'a lot' }, spent: {} } } }],
    ['no yearly totals', { money: { cash: 0, familySharePercent: 0, monthGiven: 0 } }],
    ['an unknown job', { work: { history: [{ job: 'bank', level: 'weekend', from: 180 }] } }],
    ['an unknown work level', { work: { history: [{ job: 'cafe', level: 'night_shift', from: 180 }] } }],
    ['no work history', { work: {} }],
    ['a negative student loan (D82)', { money: { ...createNewLife(3).money, studentLoan: -1 } }],
    ['an unknown way to pay the tuition (D82)', { money: { ...createNewLife(3).money, study: { tuition: 'lottery', livingLoan: false } } }],
    ['a time cut of an unknown level (D83)', { timeCut: { sleep: 'nap' } }],
    ['an unknown home before the dorm (D82)', { education: { history: [], homeBeforeStudy: { regionId: 'city', homeId: 'castle' } } }],
  ])('rejects a save with %s (D77)', (_label, broken) => {
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: CURRENT_SAVE_VERSION, state: { ...createNewLife(3), ...broken } }));
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
  });

  it.each([
    ['no history', { next: 'primary' }],
    ['an unknown program', { history: [{ program: 'university', from: 80 }] }],
    ['an unknown result', { history: [{ program: 'primary', from: 80, to: 90, result: 'expelled' }] }],
    ['an unknown next program', { history: [], next: 'university' }],
  ])('rejects a save with education with %s (D74)', (_label, education) => {
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: CURRENT_SAVE_VERSION, state: { ...createNewLife(3), education } }));
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
  });

  it.each([
    ['no periods', { periods: [] }],
    ['an unknown relation', { periods: [{ relation: 'partner', from: 80 }] }],
    ['no name', { nickname: undefined }],
  ])('rejects a save with a person with %s (D72)', (_label, broken) => {
    const friend = { id: 1, nickname: 'ต้น', sex: 'male', ageGapMonths: 0, metVia: 'x', tags: [], periods: [{ relation: 'friend', from: 80 }], ...broken };
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: CURRENT_SAVE_VERSION, state: { ...createNewLife(3), people: [friend] } }));
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
  });

  it('rejects a save whose habits miss a habit', () => {
    const life = createNewLife(3);
    const { smoking: _s, ...habits } = life.habits;
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: CURRENT_SAVE_VERSION, state: { ...life, habits } }));
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
  });

  it('keeps a choice that was waiting when the page closed', () => {
    // Born in March, 143 months old: the next month is the dream event.
    const waiting = advanceOneMonth({ ...createNewLife(7), birthMonth: 3, ageInMonths: 143 }).state;
    expect(waiting.pendingChoices).toHaveLength(1);
    saveGame(storage, waiting);
    expect(loadGame(storage)).toEqual({ status: 'ok', state: waiting });
  });

  it('reports tooNew for a save from a future game version', () => {
    storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: CURRENT_SAVE_VERSION + 1, state: {} }));
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'tooNew' });
  });

  it('never throws when storage is blocked', () => {
    expect(loadGame(brokenStorage)).toEqual({ status: 'error', reason: 'unreadable' });
    expect(saveGame(brokenStorage, createNewLife(1))).toEqual({ status: 'error', reason: 'unwritable' });
    expect(() => deleteSave(brokenStorage)).not.toThrow();
  });

  it('deleteSave removes the save', () => {
    saveGame(storage, createNewLife(1));
    deleteSave(storage);
    expect(loadGame(storage)).toEqual({ status: 'empty' });
  });
});
