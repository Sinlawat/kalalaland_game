/**
 * D83: the calendar. A typical month of 30 days (day 1 is a Monday) drawn
 * from the time budget: what each day is made of, hour by hour. The week's
 * hours are the engine's (time.ts); the days only lay them out, so a week of
 * days adds up to the same hours. Pure functions, unit-tested.
 */

import { BALANCE } from '../data/balance';
import { currentEnrollment, programDef } from '../engine/education';
import { OWN_LIFESTYLE_FROM_MONTH } from '../engine/lifestyle';
import { studyPlace } from '../engine/study';
import { fits, TIME_HABITS, weekHours, type TimeHabit, type WeekHours } from '../engine/time';
import type { GameState } from '../engine/types';
import { currentJob } from '../engine/work';

export const ACTIVITIES = ['sleep', 'essentials', 'commute', 'study', 'work', 'exercise', 'free'] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** A stretch of one day, in hours from midnight (0–24; halves allowed). */
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

type ScheduleSource = Pick<GameState, 'education' | 'flags' | 'work' | 'ageInMonths' | 'habits' | 'timeCut'>;

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

/**
 * One day of the typical month, midnight to midnight, with no gaps:
 * asleep until waking up (an hour and a half before the first thing of the
 * day, or at 7 / 8 on a free day), an hour to get ready, the fixed parts,
 * exercise after them, two hours for dinner and washing, then free time
 * until bed. Bedtime gives the night its hours of sleep.
 */
export function daySchedule(state: ScheduleSource, weekday: number): Block[] {
  const fixed = fixedBlocks(state, weekday);
  const sleep = sleepHours(state);
  const first = fixed[0]?.start;
  const wake = first !== undefined ? Math.min(first - 1, 7) : weekday >= 5 ? 8 : 7;
  // Bedtime the evening before; after midnight (a short night) the first hours of the day are still awake.
  const bed = 24 - (sleep - wake);
  const blocks: Block[] = bed > 24 ? [{ start: 0, end: bed - 24, activity: 'free' }] : [];
  blocks.push({ start: Math.max(0, bed - 24), end: wake, activity: 'sleep' });
  let cursor = wake;
  const add = (start: number, end: number, activity: Activity) => {
    if (start > cursor) blocks.push({ start: cursor, end: start, activity: 'free' });
    blocks.push({ start, end, activity });
    cursor = end;
  };
  add(cursor, cursor + 1, 'essentials');
  for (const block of fixed) add(Math.max(block.start, cursor), Math.max(block.start, cursor) + (block.end - block.start), block.activity);
  // A free day: the evening starts at the usual time.
  if (fixed.length === 0 && cursor < 17) {
    blocks.push({ start: cursor, end: 17, activity: 'free' });
    cursor = 17;
  }
  if (exercisesOn(state, weekday)) add(cursor, cursor + 1, 'exercise');
  add(cursor, cursor + 2, 'essentials');
  // Activities that run past bedtime take it from the night.
  const night = Math.min(Math.max(bed, cursor), 24);
  if (night > cursor) blocks.push({ start: cursor, end: night, activity: 'free' });
  if (night < 24) blocks.push({ start: night, end: 24, activity: 'sleep' });
  return blocks.filter((block) => block.end > block.start);
}

/** Hours of each activity in a day. */
export function dayTotals(blocks: Block[]): Record<Activity, number> {
  const totals = Object.fromEntries(ACTIVITIES.map((a) => [a, 0])) as Record<Activity, number>;
  for (const block of blocks) totals[block.activity] += block.end - block.start;
  return totals;
}

/** "07:30" from 7.5. */
export function clock(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
