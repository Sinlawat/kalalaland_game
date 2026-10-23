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

/**
 * A new life in the shape save version 6 wrote it: one `regionId`, no
 * birth region / residence / birth values. Older-version tests remove
 * more fields from this.
 */
function version6Life(seed: number): Record<string, unknown> & ReturnType<typeof createNewLife> {
  const { birthRegionId, residence: _residence, birthSnapshot: _birth, ...rest } = createNewLife(seed);
  return { ...rest, regionId: birthRegionId } as never;
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
      const { hidden: _hidden, ...v1State } = version6Life(77);
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
      const { eventHistory: _events, ...v2State } = version6Life(78);
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
      const { yearHabits: _habits, ...v3State } = version6Life(79);
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 3, savedAt: '2026-10-22T00:00:00.000Z', state: v3State }));
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
      expect(result.state.yearHabits).toEqual([]);
      expect(() => advanceUntilStop(result.state)).not.toThrow();
    });
  });

  describe('migration v4 → v5 (events with choices)', () => {
    it('loads a version 4 save with nothing waiting for a choice', () => {
      const { pendingChoices: _pending, ...v4State } = version6Life(80);
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 4, savedAt: '2026-10-22T00:00:00.000Z', state: v4State }));
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
      expect(result.state.pendingChoices).toEqual([]);
      expect(() => advanceUntilStop(result.state)).not.toThrow();
    });
  });

  describe('migration v5 → v6 (temporary lifestyle)', () => {
    it('loads a version 5 save with no temporary lifestyle running', () => {
      const { habitTimers: _timers, ...v5State } = version6Life(81);
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 5, savedAt: '2026-10-22T00:00:00.000Z', state: v5State }));
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
      expect(result.state.habitTimers).toEqual({});
      expect(() => advanceUntilStop(result.state)).not.toThrow();
    });
  });

  describe('migration v6 → v7 (birth region and residence)', () => {
    function writeVersion6Save(flags: string[] = []): void {
      const state = { ...version6Life(82), regionId: 'city', flags };
      storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 6, savedAt: '2026-10-22T00:00:00.000Z', state }));
    }

    it('keeps the old region as the birth region and as home with the parents', () => {
      writeVersion6Save();
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
      expect(result.state.birthRegionId).toBe('city');
      expect(result.state.residence).toEqual({ regionId: 'city', homeId: 'parents' });
      expect('regionId' in result.state).toBe(false);
      expect(result.state.birthSnapshot).toBeUndefined();
      expect(() => advanceUntilStop(result.state)).not.toThrow();
    });

    it('places a life that already moved to the grandparents (flag) in the countryside', () => {
      writeVersion6Save(['lives_with_grandparents']);
      const result = loadGame(storage);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
      expect(result.state.birthRegionId).toBe('city');
      expect(result.state.residence).toEqual({ regionId: 'rural', homeId: 'grandparents' });
    });
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
