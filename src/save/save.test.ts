import { beforeEach, describe, expect, it } from 'vitest';
import { advanceUntilStop } from '../engine/game';
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
    ['a valid envelope with a broken state', '{"saveVersion":1,"state":{"seed":"abc"}}'],
    ['a JSON array', '[1,2,3]'],
  ])('reports corrupt for %s', (_label, raw) => {
    storage.setItem(SAVE_KEY, raw);
    expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
  });

  describe('migration v1 → v2 (accumulated wear)', () => {
    /** A save exactly as version 1 of the game wrote it: no `hidden` field. */
    function writeVersion1Save(): void {
      const { hidden: _hidden, ...v1State } = createNewLife(77);
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 1, savedAt: '2026-10-21T00:00:00.000Z', state: v1State }));
    }

    it('loads a version 1 save and starts it with zero wear', () => {
      writeVersion1Save();
      const result = loadGame(storage);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') expect(result.state.hidden).toEqual({ physicalWear: 0 });
    });

    it('a migrated save can be played on', () => {
      writeVersion1Save();
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error('expected ok');
      expect(() => advanceUntilStop(result.state)).not.toThrow();
    });

    it('still rejects a broken version 1 save instead of crashing in the migration', () => {
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 1, state: 'not an object' }));
      expect(loadGame(storage)).toEqual({ status: 'error', reason: 'corrupt' });
    });
  });

  describe('migration v2 → v3 (event history)', () => {
    it('loads a version 2 save with an empty event history and keeps its wear', () => {
      const { eventHistory: _events, ...v2State } = createNewLife(78);
      v2State.hidden = { physicalWear: 7 };
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 2, savedAt: '2026-10-21T00:00:00.000Z', state: v2State }));
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
      expect(result.state.eventHistory).toEqual([]);
      expect(result.state.hidden.physicalWear).toBe(7);
    });
  });

  describe('migration v3 → v4 (habits per month)', () => {
    it('loads a version 3 save with an empty habit record for the running year', () => {
      const { yearHabits: _habits, ...v3State } = createNewLife(79);
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 3, savedAt: '2026-10-22T00:00:00.000Z', state: v3State }));
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
      expect(result.state.yearHabits).toEqual([]);
      expect(() => advanceUntilStop(result.state)).not.toThrow();
    });
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
