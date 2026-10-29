/**
 * D83: the calendar. A typical month of 30 days (day 1 is a Monday) drawn
 * from the time budget: what each day is made of, hour by hour. The week's
 * hours are the engine's (time.ts); the days only lay them out, so a week of
 * days adds up to the same hours. Pure functions, unit-tested.
 * D85: activities with set hours (lessons, friends, caring), and each day
 * also as the player lives it, from waking up to the next morning.
 */

import { BALANCE } from '../data/balance';
import { activityHoursOn } from '../engine/activities';
import { currentEnrollment, programDef } from '../engine/education';
import { OWN_LIFESTYLE_FROM_MONTH } from '../engine/lifestyle';
import { studyPlace } from '../engine/study';
import { fits, TIME_HABITS, weekHours, type TimeHabit, type WeekHours } from '../engine/time';
import { ACTIVITY_KINDS, type GameState } from '../engine/types';
import { currentJob } from '../engine/work';

export const ACTIVITIES = ['sleep', 'chores', 'essentials', 'commute', 'study', 'work', 'lessons', 'care', 'exercise', 'friends', 'free'] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** A stretch of one day, in hours from midnight (0–24; halves allowed; a waking day runs past 24 into the next morning). */
export interface Block {
  start: number;
  end: number;
  activity: Activity;
}

export const DAYS_IN_MONTH = 30;
/** 0 = Monday … 6 = Sunday. Day 1 of the month is a Monday. */
export function weekdayOf(day: number): number {
  return (day - 1) % 7;
}

type ScheduleSource = Pick<GameState, 'education' | 'flags' | 'work' | 'ageInMonths' | 'habits' | 'timeCut' | 'activities'>;

/** The calendar is the character's from Grade 1 (before, the family runs the day). */
export function showsSchedule(state: Pick<GameState, 'ageInMonths'>): boolean {
  return state.ageInMonths >= OWN_LIFESTYLE_FROM_MONTH;
}

/** A habit the week has no time for: what the character wanted, and what it is now. */
export interface CutHabit {
  habit: TimeHabit;
  wanted: string;
  now: string;
}

/** The week's hours as they are now, whether the week is full, and what it had to cut. */
export function weekSummary(state: ScheduleSource): { hours: WeekHours; full: boolean; minFree: number; cut: CutHabit[] } {
  const hours = weekHours(state, state.habits);
  const cut = TIME_HABITS.filter((habit) => state.timeCut?.[habit] !== undefined).map((habit) => ({
    habit,
    wanted: state.timeCut![habit]!,
    now: state.habits[habit],
  }));
  return { hours, full: !fits(hours) || cut.length > 0, minFree: BALANCE.time.minFree, cut };
}

type StudyKind = 'school' | 'university' | 'distance' | undefined;

function studyKind(state: ScheduleSource): StudyKind {
  const current = currentEnrollment(state);
  if (current === undefined || currentJob(state)?.level === 'school_break') return undefined;
  const { level } = programDef(current.program);
  if (level === 'non_formal') return 'distance';
  if (level === 'bachelor') return studyPlace(state) === 'open' ? 'distance' : 'university';
  return 'school';
}

interface Fixed {
  start: number;
  end: number;
  activity: Activity;
}

/** The fixed parts of one weekday: study, work and the travel to them. */
function fixedBlocks(state: ScheduleSource, weekday: number): Fixed[] {
  const weekend = weekday >= 5;
  const blocks: Fixed[] = [];
  const study = studyKind(state);
  const longWay = state.flags.includes('long_commute');
  const travel = (start: number, end: number, each: number) => {
    blocks.push({ start: start - each, end: start, activity: 'commute' });
    blocks.push({ start: end, end: end + each, activity: 'commute' });
  };
  if (!weekend && study === 'school') {
    blocks.push({ start: 8, end: 16, activity: 'study' });
    travel(8, 16, longWay ? 1 : 0.5);
  } else if (!weekend && study === 'university') {
    blocks.push({ start: 9, end: 14, activity: 'study' });
    travel(9, 14, 0.5);
  } else if (weekday === 6 && study === 'distance') {
    blocks.push({ start: 9, end: 15, activity: 'study' });
  }
  const job = currentJob(state)?.level;
  if (job === 'full_time' || job === 'school_break') {
    if (weekday <= 5) blocks.push({ start: 8, end: 16, activity: 'work' });
    if (!weekend) travel(8, 16, 0.5);
  } else if (job === 'weekend' && weekend) {
    blocks.push({ start: 9, end: 16, activity: 'work' });
  } else if (job === 'daily') {
    blocks.push(weekend ? { start: 10, end: 17, activity: 'work' } : { start: 17, end: 20, activity: 'work' });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

function sleepHours(state: ScheduleSource): number {
  const t = BALANCE.time;
  const adult = state.ageInMonths >= t.sleepAdultFromAge * 12;
  return (state.habits.sleep === 'enough' ? (adult ? t.sleep.enoughAdult : t.sleep.enoughChild) : t.sleep.short) / 7;
}

function exercisesOn(state: ScheduleSource, weekday: number): boolean {
  if (state.habits.exercise === 'regular') return weekday <= 4;
  if (state.habits.exercise === 'light') return weekday === 1 || weekday === 3;
  return false;
}

/** When the character usually gets up: an hour and a half before the first fixed thing of the day, or at 7 / 8 on a free day. */
function usualWake(fixed: Fixed[], weekday: number): number {
  const first = fixed[0]?.start;
  return first !== undefined ? Math.min(first - 1, 7) : weekday >= 5 ? 8 : 7;
}

/**
 * The day from waking up until the evening is over (bedtime not yet
 * placed): an hour to get ready, the fixed parts, lessons and caring after
 * them, exercise, two hours for dinner and washing, time with friends.
 */
function dayUntilEvening(state: ScheduleSource, weekday: number, wake: number): { blocks: Block[]; end: number } {
  const fixed = fixedBlocks(state, weekday);
  const blocks: Block[] = [];
  let cursor = wake;
  const add = (start: number, end: number, activity: Activity) => {
    if (start > cursor) blocks.push({ start: cursor, end: start, activity: 'free' });
    blocks.push({ start, end, activity });
    cursor = end;
  };
  // D86: what comes before the day (the morning market), right after getting up.
  const early = activityHoursOn(state, weekday, true);
  for (const activity of ACTIVITY_KINDS) if (early[activity] > 0) add(cursor, cursor + early[activity], activity);
  add(cursor, cursor + 1, 'essentials');
  for (const block of fixed) add(Math.max(block.start, cursor), Math.max(block.start, cursor) + (block.end - block.start), block.activity);
  const extra = activityHoursOn(state, weekday);
  for (const activity of ['lessons', 'care', 'chores'] as const) if (extra[activity] > 0) add(cursor, cursor + extra[activity], activity);
  // A free day, or one that ends early (university classes end at 14): the evening starts at the usual time.
  if (cursor < 16) add(17, 17, 'free');
  if (exercisesOn(state, weekday)) add(cursor, cursor + 1, 'exercise');
  add(cursor, cursor + 2, 'essentials');
  // A night out starts in the evening.
  if (extra.friends > 0) add(Math.max(cursor, 19), Math.max(cursor, 19) + extra.friends, 'friends');
  return { blocks, end: cursor };
}

/**
 * When the character gets up: the usual time; on a day with nothing fixed,
 * later after a late evening, to get the night's sleep (a night out on
 * Friday, a lie-in on Saturday).
 */
function wakeOn(state: ScheduleSource, weekday: number): number {
  const fixed = fixedBlocks(state, weekday);
  // D86: up earlier for what comes before the day (the morning market before school).
  const early = Object.values(activityHoursOn(state, weekday, true)).reduce((sum, hours) => sum + hours, 0);
  const usual = usualWake(fixed, weekday) - early;
  if (fixed.length > 0) return usual;
  const yesterday = (weekday + 6) % 7;
  const lastEvening = dayUntilEvening(state, yesterday, usualWake(fixedBlocks(state, yesterday), yesterday)).end;
  return Math.max(usual, lastEvening - 24 + sleepHours(state));
}

/**
 * D85: one day from waking up to waking up the next morning: the day (see
 * dayUntilEvening), free time until bed, then the night's sleep. Bedtime is
 * set by TOMORROW's wake-up, so every night has the hours of sleep of the
 * lifestyle (D83 used today's, which made Friday night too long and Sunday
 * night too short). Hours past 24 belong to the next calendar day. On a
 * school or work morning, an evening that runs past bedtime takes it from
 * the night.
 */
export function wakingDay(state: ScheduleSource, weekday: number): Block[] {
  const { blocks, end } = dayUntilEvening(state, weekday, wakeOn(state, weekday));
  const nextWake = 24 + wakeOn(state, (weekday + 1) % 7);
  const bed = Math.min(Math.max(nextWake - sleepHours(state), end), nextWake);
  if (bed > end) blocks.push({ start: end, end: bed, activity: 'free' });
  if (nextWake > bed) blocks.push({ start: bed, end: nextWake, activity: 'sleep' });
  return merge(blocks.filter((block) => block.end > block.start));
}

/** Neighbouring blocks of the same activity become one. */
function merge(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    const last = result.at(-1);
    if (last !== undefined && last.activity === block.activity && last.end === block.start) last.end = block.end;
    else result.push({ ...block });
  }
  return result;
}

/**
 * One calendar day of the typical month, midnight to midnight, with no gaps:
 * the end of the night before (what yesterday's waking day ran past
 * midnight), then today's waking day up to midnight.
 */
export function daySchedule(state: ScheduleSource, weekday: number): Block[] {
  const lastNight = wakingDay(state, (weekday + 6) % 7)
    .filter((block) => block.end > 24)
    .map((block) => ({ ...block, start: Math.max(0, block.start - 24), end: block.end - 24 }));
  const today = wakingDay(state, weekday)
    .filter((block) => block.start < 24)
    .map((block) => ({ ...block, end: Math.min(24, block.end) }));
  return merge([...lastNight, ...today]);
}

/** Hours of each activity in a day. */
export function dayTotals(blocks: Block[]): Record<Activity, number> {
  const totals = Object.fromEntries(ACTIVITIES.map((a) => [a, 0])) as Record<Activity, number>;
  for (const block of blocks) totals[block.activity] += block.end - block.start;
  return totals;
}

/** "07:30" from 7.5; past midnight from the day before: "00:30" from 24.5. */
export function clock(hours: number): string {
  const whole = Math.floor(hours);
  const h = whole % 24;
  const m = Math.round((hours - whole) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
