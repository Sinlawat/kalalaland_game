import { beforeEach, describe, expect, it } from 'vitest';
import { advanceOneMonth, advanceUntilStop } from '../engine/game';
import { createNewLife } from '../engine/newLife';
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
