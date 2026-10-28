/**
 * Work and money (D77, finance phase 1).
 *
 * While the character lives with the parents, the parents pay for living
 * (not simulated as numbers: Family wealth stands for how much they have).
 * Any job — a weekend part-time job at 15 counts — pays a wage into the
 * character's own savings every month, minus the share they give the family.
 *
 * Like education (D74), jobs are stored as facts: which job, at which level,
 * from which month, until which month and how it ended. "Working weekends
 * at the café for 5 months" is computed from that.
 *
 * Rules the engine keeps, whatever the content does:
 * - one job at a time: starting one ends the one before;
 * - a job's level sets the overtime habit and may limit exercise (no time
 *   left for it); the exercise comes back when the job ends;
 * - part-time work belongs to school days: when the character stops
 *   studying, it ends; the school break job ends after two months;
 * - the wage is paid from the month after the job started.
 *
 * Functions that change the state MUTATE it (engine-private copy, like the
 * rest of the engine); the read helpers never do.
 */

import { BALANCE } from '../data/balance';
import { currentEnrollment } from './education';
import { setHabitFromEvent } from './lifestyle';
import {
  EXERCISE_LEVELS,
  JOB_IDS,
  WORK_LEVELS,
  type GameState,
  type Habits,
  type Job,
  type JobId,
  type WorkChange,
  type WorkLevel,
  type WorkResult,
} from './types';

const B = BALANCE.work;

// ── Reading ─────────────────────────────────────────────────────────────────

/** The job the character has now, or undefined. */
export function currentJob(state: Pick<GameState, 'work'>): Job | undefined {
  const last = state.work.history.at(-1);
  return last !== undefined && last.to === undefined ? last : undefined;
}

/** Whole months at the current job and level (0 in its first month); undefined without a job. */
export function monthsInJob(state: Pick<GameState, 'work' | 'ageInMonths'>): number | undefined {
  const job = currentJob(state);
  return job === undefined ? undefined : state.ageInMonths - job.from;
}

/** Part-time work while studying (not the school break job, which takes no school time). */
export function isPartTime(level: WorkLevel): boolean {
  return level === 'weekend' || level === 'daily';
}

/** The monthly wage of a job at a level where the character lives now, in whole baht. */
export function monthlyWage(job: JobId, level: WorkLevel, region: GameState['residence']['regionId']): number {
  const payFactor = (B.jobPayFactor as Partial<Record<JobId, number>>)[job] ?? 1;
  if (level === 'full_time') return Math.round(B.fullTimeDailyWage[region] * B.fullTimeDaysPerMonth * payFactor);
  return Math.round(B.partTimeHourly * B.hoursPerMonth[level] * B.regionWageFactor[region] * payFactor);
}

/** Hours a month at a level, as a share of a full-time month (what the job teaches scales with it). */
export function workShare(level: WorkLevel): number {
  const hours = level === 'full_time' ? B.fullTimeHoursPerMonth : B.hoursPerMonth[level];
  return hours / B.fullTimeHoursPerMonth;
}

// ── Lifestyle that comes with a job ─────────────────────────────────────────

type ExerciseLevel = Habits['exercise'];

function lowerExercise(a: ExerciseLevel, b: ExerciseLevel | undefined): ExerciseLevel {
  if (b === undefined) return a;
  return EXERCISE_LEVELS.indexOf(a) <= EXERCISE_LEVELS.indexOf(b) ? a : b;
}

/** The exercise a job at this level leaves time for, given the exercise before the job. */
function exerciseWhileWorking(restore: ExerciseLevel, level: WorkLevel): ExerciseLevel {
  return lowerExercise(restore, (B.exerciseCap as Partial<Record<WorkLevel, ExerciseLevel>>)[level]);
}

/** Habit changes made by a job change, for the event record. */
export type HabitChanges = Partial<Habits>;

/**
 * Sets the overtime habit and the exercise that fits the new situation.
 * `before`: the job before the change (undefined = had none); `after`: the
 * job now (undefined = no job any more). Exercise only moves if it is still
 * what the old situation made it (an event may have changed it since).
 */
function applyJobLifestyle(state: GameState, before: Job | undefined, after: Job | undefined, restore: ExerciseLevel): HabitChanges {
  const changes: HabitChanges = {};
  const overtime = after === undefined ? 'none' : B.overtime[after.level];
  if (setHabitFromEvent(state, 'overtime', overtime)) changes.overtime = overtime;

  const expectedNow = before === undefined ? state.habits.exercise : exerciseWhileWorking(restore, before.level);
  const target = after === undefined ? restore : exerciseWhileWorking(restore, after.level);
  if (state.habits.exercise === expectedNow && target !== state.habits.exercise) {
    setHabitFromEvent(state, 'exercise', target);
    changes.exercise = target;
  }
  return changes;
}

// ── Changing ────────────────────────────────────────────────────────────────

function endJob(state: GameState, result: WorkResult): Job | undefined {
  const job = currentJob(state);
  if (job === undefined) return undefined;
  job.to = state.ageInMonths;
  job.result = result;
  return job;
}

/** Starts a job now; a job going on ends as 'changed'. */
export function startJob(state: GameState, job: JobId, level: WorkLevel): HabitChanges {
  const before = currentJob(state);
  const restore = before?.restoreExercise ?? state.habits.exercise;
  endJob(state, 'changed');
  const next: Job = { job, level, from: state.ageInMonths, restoreExercise: restore };
  if (level === 'school_break') next.untilMonth = state.ageInMonths + B.schoolBreakMonths;
  state.work.history.push(next);
  return applyJobLifestyle(state, before, next, restore);
}

/** Same job, another level (e.g. from every day to weekends only). */
export function changeWorkLevel(state: GameState, level: WorkLevel): HabitChanges {
  const before = currentJob(state);
  if (before === undefined || before.level === level) return {};
  return startJob(state, before.job, level);
}

/** Ends the current job (result 'quit' when the character decided, 'ended' when it ran its course). */
export function stopWork(state: GameState, result: WorkResult = 'quit'): HabitChanges {
  const before = currentJob(state);
  if (before === undefined) return {};
  endJob(state, result);
  return applyJobLifestyle(state, before, undefined, before.restoreExercise ?? state.habits.exercise);
}

// ── Monthly step ────────────────────────────────────────────────────────────

/** The family's money stress (0–100) from Family wealth, a parent out of work, and help from the character. */
export function familyMoneyStress(state: Pick<GameState, 'environment' | 'flags' | 'money' | 'ageInMonths'>): number {
  const b = BALANCE.familyMoneyStress;
  if (state.ageInMonths >= b.untilAge * 12) return 0;
  let stress = Math.max(0, (b.wealthAtZero - state.environment.familyWealth) * b.perWealthPoint);
  if (state.flags.includes('parent_lost_job')) stress += b.parentLostJob;
  stress -= Math.min(b.maxReliefFromGiving, (state.money.monthGiven / 1000) * b.reliefPer1000Given);
  const relief = state.money.familyRelief;
  if (relief !== undefined && state.ageInMonths <= relief.untilMonth) stress -= relief.amount;
  return Math.round(Math.min(100, Math.max(0, stress)));
}

/**
 * Monthly step (game.ts, after education): pays the wage of a job started
 * before this month, ends jobs that ran their course, and updates the
 * family's money stress.
 */
export function advanceWork(state: GameState): void {
  const job = currentJob(state);
  state.money.monthGiven = 0;
  if (job !== undefined && job.from < state.ageInMonths) {
    const wage = monthlyWage(job.job, job.level, state.residence.regionId);
    const given = Math.round((wage * state.money.familySharePercent) / 100);
    state.money.cash += wage - given;
    state.money.monthGiven = given;
    state.money.year.earned += wage;
    state.money.year.given += given;
  }
  if (job !== undefined) {
    const breakOver = job.untilMonth !== undefined && state.ageInMonths >= job.untilMonth;
    const schoolOver = isPartTime(job.level) && currentEnrollment(state) === undefined;
    if (breakOver || schoolOver) stopWork(state, 'ended');
  }
  if (state.money.familyRelief !== undefined && state.ageInMonths > state.money.familyRelief.untilMonth) delete state.money.familyRelief;
  state.environment.financialStress = familyMoneyStress(state);
}

// ── Events: effects and conditions (events.json) ────────────────────────────

/** events.json `effects.work`: exactly one of start, level, quit. */
export interface WorkEffect {
  start?: { job: JobId; level: WorkLevel };
  /** Same job, another level. */
  level?: WorkLevel;
  quit?: true;
}

/** Applies a work effect; returns the habit changes and the job change for the event record. */
export function applyWorkEffect(state: GameState, effect: WorkEffect): { habits: HabitChanges; change?: WorkChange } {
  const before = currentJob(state);
  let habits: HabitChanges = {};
  if (effect.start) habits = startJob(state, effect.start.job, effect.start.level);
  else if (effect.level !== undefined) habits = changeWorkLevel(state, effect.level);
  else if (effect.quit) habits = stopWork(state, 'quit');
  const after = currentJob(state);
  if (before?.job === after?.job && before?.level === after?.level) return { habits };
  const change: WorkChange = {};
  if (before !== undefined) change.from = { job: before.job, level: before.level };
  if (after !== undefined) change.to = { job: after.job, level: after.level };
  return { habits, change };
}

/** events.json `conditions.work`. Every field given must hold. */
export interface WorkConditions {
  /** true: has a job now; false: has none. */
  employed?: boolean;
  /** Works at one of these levels now. */
  levels?: WorkLevel[];
  /** Months at the current job and level. */
  monthsIn?: { min?: number; max?: number };
}

export function meetsWorkConditions(state: Pick<GameState, 'work' | 'ageInMonths'>, c: WorkConditions): boolean {
  const job = currentJob(state);
  if (c.employed !== undefined && (job !== undefined) !== c.employed) return false;
  if (c.levels !== undefined && !(job !== undefined && c.levels.includes(job.level))) return false;
  if (c.monthsIn !== undefined) {
    const months = monthsInJob(state);
    if (months === undefined) return false;
    if (c.monthsIn.min !== undefined && months < c.monthsIn.min) return false;
    if (c.monthsIn.max !== undefined && months > c.monthsIn.max) return false;
  }
  return true;
}

/** Adds to (or takes from) the savings, never below 0. Returns the real change. */
export function changeMoney(state: GameState, amount: number): number {
  const before = state.money.cash;
  state.money.cash = Math.max(0, before + Math.round(amount));
  return state.money.cash - before;
}

/** For validation. */
export const isJobId = (value: unknown): value is JobId => (JOB_IDS as readonly unknown[]).includes(value);
export const isWorkLevel = (value: unknown): value is WorkLevel => (WORK_LEVELS as readonly unknown[]).includes(value);
