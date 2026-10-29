/**
 * D83: the week has 168 hours.
 *
 * School or university, work, the daily essentials (eating, washing,
 * errands), sleep and exercise all take hours; at least a minimum of free
 * time must stay. When they do not fit, the lifestyle gives way: exercise
 * first, then sleep. The level the character would have with time to spare
 * is kept in `state.timeCut`, and comes back as soon as the hours allow.
 *
 * Content follows the same rule: an event that would give the character
 * more sleep or exercise does not happen when there is no time for it, and
 * a choice that would is locked ("no time").
 *
 * This replaces D77's job exercise limit: a job now takes the time it takes,
 * and the budget decides what is left.
 *
 * D85: activities with set hours (lessons, friends, caring for someone) take
 * their hours too; they never lock a choice, the week gives way instead.
 *
 * Functions that change the state MUTATE it; the read helpers never do.
 */

import { BALANCE } from '../data/balance';
import { activityHours } from './activities';
import { currentEnrollment, programDef } from './education';
import { OWN_LIFESTYLE_FROM_MONTH } from './lifestyle';
import { studyPlace } from './study';
import { EXERCISE_LEVELS, SLEEP_LEVELS, type GameState, type Habits, type WorkLevel } from './types';
import { currentJob } from './work';

const T = BALANCE.time;

/** The two habits that bend to the time budget. */
export const TIME_HABITS = ['exercise', 'sleep'] as const;
export type TimeHabit = (typeof TIME_HABITS)[number];
export type TimeCut = Partial<Pick<Habits, TimeHabit>>;

/** Hours a week of each kind of activity. */
export interface WeekHours {
  study: number;
  /** Travel to school or work. */
  commute: number;
  work: number;
  /** D85: activities with set hours. */
  lessons: number;
  friends: number;
  care: number;
  essentials: number;
  sleep: number;
  exercise: number;
  /** What is left (can be below the minimum, or below 0, when it does not fit). */
  free: number;
}

type HoursSource = Pick<GameState, 'education' | 'flags' | 'work' | 'ageInMonths' | 'activities'>;

/** Hours a week the current studies take (0 during a school-break job: the school is closed). */
function studyHours(state: HoursSource): number {
  const current = currentEnrollment(state);
  if (current === undefined) return 0;
  if (currentJob(state)?.level === 'school_break') return 0;
  const { level } = programDef(current.program);
  if (level === 'non_formal') return T.study.distance;
  if (level === 'bachelor') return studyPlace(state) === 'open' ? T.study.distance : T.study.university;
  return T.study.school;
}

function workHours(level: WorkLevel | undefined): number {
  return level === undefined ? 0 : T.work[level];
}

/** The week of the character with these sleep and exercise levels. */
export function weekHours(state: HoursSource, habits: Pick<Habits, TimeHabit>): WeekHours {
  const study = studyHours(state);
  const job = currentJob(state)?.level;
  const work = workHours(job);
  const commute =
    (study >= T.study.university ? T.commute : 0) +
    (study >= T.study.school && state.flags.includes('long_commute') ? T.longCommute : 0) +
    (job === 'full_time' || job === 'school_break' ? T.commute : 0);
  const adult = state.ageInMonths >= T.sleepAdultFromAge * 12;
  const sleep = habits.sleep === 'enough' ? (adult ? T.sleep.enoughAdult : T.sleep.enoughChild) : T.sleep.short;
  const exercise = T.exercise[habits.exercise];
  const { lessons, friends, care } = activityHours(state);
  const used = study + commute + work + lessons + friends + care + T.essentials + sleep + exercise;
  return { study, commute, work, lessons, friends, care, essentials: T.essentials, sleep, exercise, free: T.hoursPerWeek - used };
}

export function fits(week: WeekHours): boolean {
  return week.free >= T.minFree;
}

/** The levels the character would have with enough time (what a cut keeps). */
export function wishedHabits(state: Pick<GameState, 'habits' | 'timeCut'>): Pick<Habits, TimeHabit> {
  return {
    exercise: state.timeCut?.exercise ?? state.habits.exercise,
    sleep: state.timeCut?.sleep ?? state.habits.sleep,
  };
}

/**
 * The levels that fit the week: the wished ones if they fit; otherwise
 * exercise goes down step by step, and only when no exercise is left does
 * sleep go down too. (Exercise is not given back after sleep was cut: the
 * time for it was what went first.)
 */
export function fittedHabits(state: HoursSource, wished: Pick<Habits, TimeHabit>): Pick<Habits, TimeHabit> {
  for (let e = EXERCISE_LEVELS.indexOf(wished.exercise); e >= 0; e--) {
    const habits = { exercise: EXERCISE_LEVELS[e]!, sleep: wished.sleep };
    if (fits(weekHours(state, habits))) return habits;
  }
  return { exercise: 'none', sleep: SLEEP_LEVELS[0]! };
}

/**
 * Brings sleep and exercise in line with the hours the week has. Called at
 * the start of each month and after every event (a job, a school, a habit
 * may have changed). Before Grade 1 the family runs the child's day.
 */
export function fitTimeBudget(state: GameState): void {
  if (state.ageInMonths < OWN_LIFESTYLE_FROM_MONTH) return;
  const wished = wishedHabits(state);
  const fitted = fittedHabits(state, wished);
  const cut: TimeCut = {};
  for (const habit of TIME_HABITS) {
    (state.habits as Record<TimeHabit, string>)[habit] = fitted[habit];
    if (fitted[habit] !== wished[habit]) (cut as Record<TimeHabit, string>)[habit] = wished[habit];
  }
  if (Object.keys(cut).length > 0) state.timeCut = cut;
  else delete state.timeCut;
}

const rank = (habit: TimeHabit, level: string): number =>
  habit === 'exercise' ? (EXERCISE_LEVELS as readonly string[]).indexOf(level) : (SLEEP_LEVELS as readonly string[]).indexOf(level);

/**
 * Whether there is time for what an event's habits would give: false when
 * it raises sleep or exercise above the level now and the week would no
 * longer fit. Lowering a habit always fits.
 */
export function hasTimeFor(state: GameState, habits: Partial<Record<string, unknown>> | undefined): boolean {
  if (habits === undefined || state.ageInMonths < OWN_LIFESTYLE_FROM_MONTH) return true;
  const next: Pick<Habits, TimeHabit> = { exercise: state.habits.exercise, sleep: state.habits.sleep };
  let raises = false;
  for (const habit of TIME_HABITS) {
    const spec = habits[habit];
    if (spec === undefined) continue;
    const level = typeof spec === 'string' ? spec : (spec as { level: string }).level;
    if (rank(habit, level) > rank(habit, state.habits[habit])) {
      raises = true;
      (next as Record<TimeHabit, string>)[habit] = level;
    }
  }
  return !raises || fits(weekHours(state, next));
}
