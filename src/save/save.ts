/**
 * Save system (design doc section 14).
 *
 * - The engine never touches localStorage; this module does.
 * - Storage is passed in as a parameter (dependency injection), so tests
 *   use a simple in-memory fake and never need a browser.
 * - Every save carries `saveVersion`. When the state shape changes in a
 *   later increment, we bump CURRENT_SAVE_VERSION and add one migration
 *   step; old saves are upgraded step by step (v1 → v2 → v3 ...).
 * - A broken or missing save must never crash the game: every failure
 *   becomes a `LoadResult` the UI can show to the player.
 */

import { SEXES, type GameState } from '../engine/types';

export const SAVE_KEY = 'kalalaland.save';
export const CURRENT_SAVE_VERSION = 10;
/**
 * Saves older than this cannot be upgraded; the player starts a new life.
 * D71 (version 10): the first and last name became a sex and a nickname.
 * A nickname cannot be made from an old name, so older lives are outdated.
 */
export const OLDEST_LOADABLE_SAVE_VERSION = 10;

/** The subset of the browser Storage API we use. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface SaveEnvelope {
  saveVersion: number;
  savedAt: string;
  state: unknown;
}

export type LoadResult =
  | { status: 'ok'; state: GameState }
  | { status: 'empty' }
  | { status: 'error'; reason: 'unreadable' | 'corrupt' | 'tooNew' | 'outdated' };

export type SaveResult = { status: 'ok' } | { status: 'error'; reason: 'unwritable' };

/**
 * Migration steps: key N upgrades a version-N state to version N+1.
 *
 * Rules for writing a step:
 * - Never edit an old step once released; saves in the wild depend on it.
 * - Only ADD or RESHAPE data. Never assume the input is valid: a broken
 *   save must reach `isValidGameState` and be rejected there, not crash here.
 * - Each step is tested with a real save of the older version.
 */
const MIGRATIONS: Record<number, (state: unknown) => unknown> = {
  // Saves before 10 are "outdated" (D71: a nickname and sex instead of a name).
  // New steps go here: key N upgrades a version-N state to version N+1.
};

function migrate(state: unknown, fromVersion: number): unknown {
  let current = state;
  for (let version = fromVersion; version < CURRENT_SAVE_VERSION; version++) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`Missing migration from save version ${version}`);
    current = step(current);
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNumbers(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

/**
 * Structural check of a loaded state. Not a full schema validator, but it
 * catches the realistic failures: truncated JSON, hand-edited files, and
 * data from an unrelated app stored under the same key.
 */
export function isValidGameState(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  return (
    hasNumbers(value, ['seed', 'rngState', 'ageInMonths', 'birthMonth']) &&
    typeof value.birthRegionId === 'string' &&
    isRecord(value.residence) &&
    typeof value.residence.regionId === 'string' &&
    typeof value.residence.homeId === 'string' &&
    typeof value.nickname === 'string' &&
    value.nickname.length > 0 &&
    (SEXES as readonly unknown[]).includes(value.sex) &&
    hasNumbers(value.traits, ['discipline', 'resilience', 'riskTaking', 'imagination']) &&
    hasNumbers(value.environment, ['familyWealth', 'familyWarmth', 'workStress', 'financialStress']) &&
    isRecord(value.habits) &&
    ['exercise', 'sleep', 'overtime', 'smoking', 'drinking'].every((habit) => typeof (value.habits as Record<string, unknown>)[habit] === 'string') &&
    isRecord(value.habitTimers) &&
    hasNumbers(value.condition, ['physicalHealth', 'mentalHealth']) &&
    hasNumbers(value.skills, ['academic', 'creative', 'communication', 'practical']) &&
    hasNumbers(value.outcome, ['looks', 'fame']) &&
    hasNumbers(value.hidden, ['physicalWear']) &&
    Array.isArray(value.flags) &&
    Array.isArray(value.eventHistory) &&
    Array.isArray(value.pendingChoices) &&
    isRecord(value.yearLog) &&
    Array.isArray(value.yearHabits) &&
    Array.isArray(value.history) &&
    (value.death === null || isRecord(value.death))
  );
}

export function saveGame(storage: SaveStorage, state: GameState, now: Date = new Date()): SaveResult {
  const envelope: SaveEnvelope = {
    saveVersion: CURRENT_SAVE_VERSION,
    savedAt: now.toISOString(),
    state,
  };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(envelope));
    return { status: 'ok' };
  } catch {
    // Quota exceeded, private mode, or storage disabled.
    return { status: 'error', reason: 'unwritable' };
  }
}

export function loadGame(storage: SaveStorage): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { status: 'error', reason: 'unreadable' };
  }
  if (raw === null || raw === '') return { status: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'error', reason: 'corrupt' };
  }
  if (!isRecord(parsed) || typeof parsed.saveVersion !== 'number') {
    return { status: 'error', reason: 'corrupt' };
  }
  if (parsed.saveVersion > CURRENT_SAVE_VERSION) {
    // Saved by a newer version of the game (e.g. another open tab after a deploy).
    return { status: 'error', reason: 'tooNew' };
  }
  if (parsed.saveVersion < OLDEST_LOADABLE_SAVE_VERSION) {
    return { status: 'error', reason: 'outdated' };
  }

  let state: unknown;
  try {
    state = migrate(parsed.state, parsed.saveVersion);
  } catch {
    return { status: 'error', reason: 'corrupt' };
  }
  return isValidGameState(state) ? { status: 'ok', state } : { status: 'error', reason: 'corrupt' };
}

export function deleteSave(storage: SaveStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // Nothing useful to do; the next save overwrites it anyway.
  }
}
