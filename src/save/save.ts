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

import { ENROLLMENT_RESULTS, EXERCISE_LEVELS, HOME_IDS, JOB_IDS, PROGRAM_IDS, REGION_IDS, RELATIONS, SEXES, SPENDING_LEVELS, STUDY_FUNDING, WORK_LEVELS, WORK_RESULTS, type Enrollment, type GameState } from '../engine/types';

export const SAVE_KEY = 'kalalaland.save';
export const CURRENT_SAVE_VERSION = 16;
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
  10: addPeople,
  11: addEducation,
  12: addWorkAndMoney,
  13: addMoneyBySource,
  14: addSpending,
  15: addStudentLoan,
};

/** 15 → 16 (D82): no student loan yet (nobody could study after Grade 12 before). */
function addStudentLoan(state: unknown): unknown {
  if (!isRecord(state) || !isRecord(state.money)) return state;
  return { ...state, money: { ...state.money, studentLoan: 0 } };
}

/** 14 → 15 (D80): the character's own spending starts at the normal level, with nothing unpaid. */
function addSpending(state: unknown): unknown {
  if (!isRecord(state) || !isRecord(state.money)) return state;
  return { ...state, money: { ...state.money, spendingLevel: 'normal', shortfall: 0 } };
}

/**
 * 13 → 14 (D79): the year's money by source. The running year starts empty
 * (its wages so far stay in the totals); closed years simply have none.
 */
function addMoneyBySource(state: unknown): unknown {
  if (!isRecord(state) || !isRecord(state.money) || !isRecord(state.money.year)) return state;
  return { ...state, money: { ...state.money, year: { ...state.money.year, income: {}, spent: {} } } };
}

/**
 * 12 → 13 (D77): work and money. Nobody had a paid job before, so the work
 * history starts empty and the savings at 0. The family's money stress is
 * filled in by the next month's step.
 */
function addWorkAndMoney(state: unknown): unknown {
  if (!isRecord(state)) return state;
  return {
    ...state,
    work: { history: [] },
    // The shape of version 13: the year's money by source came in version 14 (addMoneyBySource).
    money: { cash: 0, familySharePercent: 0, monthGiven: 0, year: { earned: 0, given: 0 } },
  };
}

/**
 * 10 → 11 (D72): people. Lives before had no named friends, so the list
 * starts empty; records and waiting choices simply have no person.
 */
function addPeople(state: unknown): unknown {
  return isRecord(state) ? { ...state, people: [] } : state;
}

const SCHOOL_START_EVENTS = ['school_start_international', 'school_start_private', 'school_start_public', 'school_start_scholarship', 'school_start_local'];

/**
 * 11 → 12 (D74): education. Rebuilt from the school-start event: Grade 1
 * then, Grades 7–9 after six years, and — since these lives never chose a
 * plan for Grade 10 — the arts-math plan after nine (the plan that does not
 * need the science entrance exam). Before school: no education yet.
 */
function addEducation(state: unknown): unknown {
  if (!isRecord(state)) return state;
  const history: Enrollment[] = [];
  const records = Array.isArray(state.eventHistory) ? state.eventHistory : [];
  const start = records.find((r): r is { id: string; ageInMonths: number } => isRecord(r) && SCHOOL_START_EVENTS.includes(r.id as string) && typeof r.ageInMonths === 'number');
  const age = typeof state.ageInMonths === 'number' ? state.ageInMonths : 0;
  if (start !== undefined) {
    const steps: [Enrollment['program'], number][] = [['primary', 72], ['lower_secondary', 36], ['upper_secondary_arts_math', 36]];
    let from = start.ageInMonths;
    for (const [program, months] of steps) {
      if (from > age) break;
      const ends = from + months;
      history.push(ends <= age ? { program, from, to: ends, result: 'graduated' } : { program, from });
      from = ends;
    }
  }
  return { ...state, education: { history } };
}

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

function isValidResidence(value: unknown): boolean {
  return isRecord(value) && oneOf(REGION_IDS, value.regionId) && oneOf(HOME_IDS, value.homeId);
}

/** D72: the fields the friends card and the life summary read. */
function isValidEducation(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.history)) return false;
  if (value.next !== undefined && !(PROGRAM_IDS as readonly unknown[]).includes(value.next)) return false;
  if (value.homeBeforeStudy !== undefined && !isValidResidence(value.homeBeforeStudy)) return false;
  return value.history.every(
    (e) =>
      isRecord(e) &&
      (PROGRAM_IDS as readonly unknown[]).includes(e.program) &&
      typeof e.from === 'number' &&
      (e.credit === undefined || typeof e.credit === 'number') &&
      (e.to === undefined || typeof e.to === 'number') &&
      (e.result === undefined || (ENROLLMENT_RESULTS as readonly unknown[]).includes(e.result)),
  );
}

const oneOf = (list: readonly unknown[], value: unknown): boolean => list.includes(value);

/** D77: the jobs, in order. */
function isValidWork(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.history)) return false;
  return value.history.every(
    (job) =>
      isRecord(job) &&
      oneOf(JOB_IDS, job.job) &&
      oneOf(WORK_LEVELS, job.level) &&
      typeof job.from === 'number' &&
      (job.to === undefined || typeof job.to === 'number') &&
      (job.result === undefined || oneOf(WORK_RESULTS, job.result)) &&
      (job.untilMonth === undefined || typeof job.untilMonth === 'number') &&
      (job.restoreExercise === undefined || oneOf(EXERCISE_LEVELS, job.restoreExercise)),
  );
}

/** D79: { "job.cafe": 2400, ... }. */
function isAmountsBySource(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((amount) => typeof amount === 'number' && Number.isFinite(amount));
}

/** D77: savings are whole baht and never negative. */
function isValidMoney(value: unknown): boolean {
  if (!isRecord(value) || !hasNumbers(value, ['cash', 'familySharePercent', 'monthGiven'])) return false;
  return (
    (value.cash as number) >= 0 &&
    hasNumbers(value.year, ['earned', 'given']) &&
    isAmountsBySource((value.year as Record<string, unknown>).income) &&
    isAmountsBySource((value.year as Record<string, unknown>).spent) &&
    (value.jobLossRecoveryUntil === undefined || typeof value.jobLossRecoveryUntil === 'number') &&
    oneOf(SPENDING_LEVELS, value.spendingLevel) &&
    typeof value.shortfall === 'number' &&
    typeof value.studentLoan === 'number' &&
    (value.studentLoan as number) >= 0 &&
    (value.study === undefined || (isRecord(value.study) && oneOf(STUDY_FUNDING, value.study.tuition) && typeof value.study.livingLoan === 'boolean')) &&
    (value.familyRelief === undefined || hasNumbers(value.familyRelief, ['amount', 'untilMonth']))
  );
}

function isValidPerson(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasNumbers(value, ['id', 'ageGapMonths']) &&
    typeof value.nickname === 'string' &&
    (SEXES as readonly unknown[]).includes(value.sex) &&
    typeof value.metVia === 'string' &&
    Array.isArray(value.tags) &&
    Array.isArray(value.periods) &&
    value.periods.length > 0 &&
    value.periods.every((period: unknown) => isRecord(period) && (RELATIONS as readonly unknown[]).includes(period.relation) && typeof period.from === 'number')
  );
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
    Array.isArray(value.people) &&
    value.people.every(isValidPerson) &&
    isValidEducation(value.education) &&
    isValidWork(value.work) &&
    isValidMoney(value.money) &&
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
