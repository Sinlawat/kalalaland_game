/**
 * Education history (D74).
 *
 * The character's studies are a list of facts, like the people of D72: each
 * program with the month it started, the month it ended and how it ended.
 * Everything else ("in Grade 11", "finished Grade 12", "left school") is
 * computed from that list, so nothing can get out of step.
 *
 * Rules the engine keeps, whatever the content does:
 * - at most one program at a time: starting one ends the one before;
 * - a program that ran its full length ends as 'graduated' at the start of
 *   that month, then the next one starts: the compulsory one that always
 *   follows (primary → lower secondary), or the one chosen in advance
 *   (`next`, e.g. the Grade 10 plan chosen in Grade 9); with neither, the
 *   character is no longer in education.
 *
 * Which school the character goes to stays the `school_<id>` flag (D66,
 * D70): the program is what they study, the flag is where.
 *
 * Functions that change the state MUTATE it (engine-private copy, like the
 * rest of the engine); the read helpers never do.
 */

import { BALANCE } from '../data/balance';
import programs from '../data/programs.json';
import { PROGRAM_IDS, type Education, type Enrollment, type EnrollmentResult, type GameState, type ProgramId } from './types';

export const PROGRAM_LEVELS = ['primary', 'lower_secondary', 'upper_secondary', 'vocational', 'non_formal', 'higher_vocational', 'bachelor'] as const;
export type ProgramLevel = (typeof PROGRAM_LEVELS)[number];

export interface ProgramDef {
  id: ProgramId;
  level: ProgramLevel;
  /** Length in months; the program ends 'graduated' when it has run this long. */
  months: number;
  /** The program that always follows (compulsory schooling). */
  then?: ProgramId;
}

/** Throws on bad data, listing every problem (like the event validator). */
export function parsePrograms(raw: unknown): ProgramDef[] {
  if (!Array.isArray(raw)) throw new Error('programs.json must be a list');
  const problems: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item: Record<string, unknown>, index) => {
    const at = `program ${index} (${String(item?.id)})`;
    if (!(PROGRAM_IDS as readonly unknown[]).includes(item?.id)) problems.push(`${at}: unknown id`);
    if (seen.has(String(item?.id))) problems.push(`${at}: duplicate id`);
    seen.add(String(item?.id));
    if (!(PROGRAM_LEVELS as readonly unknown[]).includes(item?.level)) problems.push(`${at}: unknown level`);
    if (!Number.isInteger(item?.months) || (item.months as number) <= 0) problems.push(`${at}: months must be a whole number above 0`);
    if (item?.then !== undefined && !(PROGRAM_IDS as readonly unknown[]).includes(item.then)) problems.push(`${at}: then must be a program id`);
  });
  for (const id of PROGRAM_IDS) if (!seen.has(id)) problems.push(`program "${id}" is missing`);
  if (problems.length > 0) throw new Error(`Invalid programs.json:\n${problems.join('\n')}`);
  return raw as ProgramDef[];
}

export const PROGRAMS: readonly ProgramDef[] = parsePrograms(programs);

export function programDef(id: ProgramId): ProgramDef {
  return PROGRAMS.find((program) => program.id === id)!;
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** The program being studied now, or undefined when not in education. */
export function currentEnrollment(state: Pick<GameState, 'education'>): Enrollment | undefined {
  const last = state.education.history.at(-1);
  return last !== undefined && last.to === undefined ? last : undefined;
}

/**
 * Whole months into the current program (0 in its first month), counting
 * the months carried over from a program of the same level it replaced
 * (`credit`); undefined when not studying.
 */
export function monthsInProgram(state: Pick<GameState, 'education' | 'ageInMonths'>): number | undefined {
  const current = currentEnrollment(state);
  return current === undefined ? undefined : state.ageInMonths - current.from + (current.credit ?? 0);
}

/** D82: the program studied now, or else the last one studied (finished, left or switched). */
export function lastProgram(state: Pick<GameState, 'education'>): ProgramId | undefined {
  return state.education.history.at(-1)?.program;
}

/** Finished (not left or switched) any of these programs. */
export function hasCompleted(state: Pick<GameState, 'education'>, ids: readonly ProgramId[]): boolean {
  return state.education.history.some((e) => e.result === 'graduated' && ids.includes(e.program));
}

// ── Changing ────────────────────────────────────────────────────────────────

function endCurrent(education: Education, age: number, result: EnrollmentResult): void {
  const current = education.history.at(-1);
  if (current === undefined || current.to !== undefined) return;
  current.to = age;
  current.result = result;
}

/**
 * Starts `program` now; a program still going on ends as 'switched'.
 * Switching within one level (e.g. from the science plan to the arts-math
 * plan in Grade 10) keeps the months already studied, so the class still
 * finishes Grade 12 together.
 */
export function enroll(state: GameState, program: ProgramId, age: number): void {
  const current = currentEnrollment(state);
  const credit = current !== undefined && programDef(current.program).level === programDef(program).level ? monthsInProgram({ ...state, ageInMonths: age }) ?? 0 : 0;
  endCurrent(state.education, age, 'switched');
  state.education.history.push(credit > 0 ? { program, from: age, credit } : { program, from: age });
  delete state.education.next;
}

/** Leaves the current program before its end (and forgets any program chosen to follow it). */
export function leaveEducation(state: GameState, age: number): void {
  endCurrent(state.education, age, 'left');
  delete state.education.next;
}

/**
 * Monthly step (game.ts, right after the age goes up): a program that has
 * run its full length ends 'graduated', and the program that follows starts
 * the same month. Returns true when something changed.
 */
export function advanceEducation(state: GameState): boolean {
  const current = currentEnrollment(state);
  if (current === undefined) return startWaitingProgram(state);
  const def = programDef(current.program);
  if ((monthsInProgram(state) ?? 0) < def.months) return false;
  endCurrent(state.education, state.ageInMonths, 'graduated');
  const following = def.then ?? state.education.next;
  delete state.education.next;
  if (following !== undefined) state.education.history.push({ program: following, from: state.ageInMonths });
  return true;
}

/**
 * D82: with no current program, a program chosen to follow (a place won after
 * a gap year, or one won after the last school year had already ended)
 * starts at the start of the school year.
 */
function startWaitingProgram(state: GameState): boolean {
  const next = state.education.next;
  if (next === undefined) return false;
  const month = ((state.birthMonth - 1 + state.ageInMonths) % 12) + 1;
  if (!(BALANCE.study.startMonths as readonly number[]).includes(month)) return false;
  delete state.education.next;
  state.education.history.push({ program: next, from: state.ageInMonths });
  return true;
}

// ── Events: effects and conditions (events.json) ────────────────────────────

/** events.json `effects.education`. */
export interface EducationEffect {
  /** Start this program now (a program going on ends as 'switched'). */
  enroll?: ProgramId;
  /** The program that starts when the current one ends. */
  next?: ProgramId;
  /** Leave the current program now. */
  leave?: true;
  /** D82: forget the program chosen to follow (e.g. a university place not won). */
  clearNext?: true;
}

export function applyEducationEffect(state: GameState, effect: EducationEffect, age: number): void {
  if (effect.clearNext) delete state.education.next;
  if (effect.leave) leaveEducation(state, age);
  if (effect.enroll !== undefined) enroll(state, effect.enroll, age);
  if (effect.next !== undefined) state.education.next = effect.next;
}

/** events.json `conditions.education`. Every field given must hold. */
export interface EducationConditions {
  /** true: studying any program now; false: not studying. */
  enrolled?: boolean;
  /** Studying one of these programs now. */
  current?: ProgramId[];
  /** Months since the current program started (needs a current program). */
  monthsIn?: { min?: number; max?: number };
  /** Finished at least one of these. */
  completed?: ProgramId[];
  /** Finished none of these. */
  notCompleted?: ProgramId[];
  /** D82: the program studied now or, when not studying, the last one studied, is one of these. */
  last?: ProgramId[];
}

export function meetsEducationConditions(state: Pick<GameState, 'education' | 'ageInMonths'>, c: EducationConditions): boolean {
  const current = currentEnrollment(state);
  if (c.enrolled !== undefined && (current !== undefined) !== c.enrolled) return false;
  if (c.current !== undefined && !(current !== undefined && c.current.includes(current.program))) return false;
  if (c.monthsIn !== undefined) {
    const months = monthsInProgram(state);
    if (months === undefined) return false;
    if (c.monthsIn.min !== undefined && months < c.monthsIn.min) return false;
    if (c.monthsIn.max !== undefined && months > c.monthsIn.max) return false;
  }
  if (c.completed !== undefined && !hasCompleted(state, c.completed)) return false;
  if (c.notCompleted !== undefined && hasCompleted(state, c.notCompleted)) return false;
  if (c.last !== undefined) {
    const last = lastProgram(state);
    if (last === undefined || !c.last.includes(last)) return false;
  }
  return true;
}
