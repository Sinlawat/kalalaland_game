/**
 * Builds the life timeline from data the save already has:
 * - `eventHistory`: which event happened at which age,
 * - `history[].changes`: what each source changed during each year.
 *
 * Pure functions (no React), so they are unit-tested directly.
 */

import type { GameState, StatTarget } from '../engine/types';

/** Design decision: the timeline card shows the last 5 years; older ones are in the history popup. */
export const RECENT_YEARS = 5;

/** Order of effect chips under an event. */
export const EFFECT_ORDER: StatTarget[] = ['physicalHealth', 'mentalHealth', 'knowledge', 'looks'];

/** Effects smaller than this are hidden (they would show as "0"). */
const MIN_VISIBLE = 0.05;

export interface EffectChip {
  target: StatTarget;
  amount: number;
}

export interface TimelineEntry {
  id: string;
  /** Age of the first occurrence in this year of age. */
  ageInMonths: number;
  /** How many times it happened in this year of age (repeatable events). */
  count: number;
  /** What the event REALLY changed (after clamping to 0–100), summed over occurrences. */
  effects: EffectChip[];
}

export interface TimelineYear {
  /** Whole years of age when the events happened (0 = first year of life). */
  age: number;
  entries: TimelineEntry[];
}

type TimelineSource = Pick<GameState, 'eventHistory' | 'history' | 'yearLog'>;

/**
 * The summary year that contains month `ageInMonths`, as a month range.
 * Summary years end on birthdays: months 1–12 close at age 1, 13–24 at 2…
 * A month after the last closed year belongs to the running `yearLog`.
 */
function summaryYearOf(state: TimelineSource, ageInMonths: number) {
  const closed = state.history.find((summary) => Math.round(summary.age * 12) >= ageInMonths);
  if (!closed) return { changes: state.yearLog, start: -Infinity, end: Infinity };
  const end = Math.round(closed.age * 12);
  return { changes: closed.changes, start: end - 12, end };
}

/**
 * The actual effect of ONE occurrence of an event. The log stores one total
 * per (stat, source) per summary year, so if the same event happened twice in
 * that year, each occurrence gets an equal share.
 */
function effectsOfOccurrence(state: TimelineSource, id: string, ageInMonths: number): EffectChip[] {
  const year = summaryYearOf(state, ageInMonths);
  const occurrences = state.eventHistory.filter(
    (record) => record.id === id && record.ageInMonths > year.start && record.ageInMonths <= year.end,
  ).length;
  const source = `event.${id}`;
  return EFFECT_ORDER.map((target) => ({
    target,
    amount: (year.changes[target]?.[source] ?? 0) / Math.max(1, occurrences),
  })).filter((chip) => chip.amount !== 0);
}

/** All years that had events, newest first; within a year, events in the order they happened. */
export function buildTimeline(state: TimelineSource): TimelineYear[] {
  const years = new Map<number, Map<string, TimelineEntry>>();

  for (const record of state.eventHistory) {
    const age = Math.floor(record.ageInMonths / 12);
    const entries = years.get(age) ?? new Map<string, TimelineEntry>();
    years.set(age, entries);

    const effects = effectsOfOccurrence(state, record.id, record.ageInMonths);
    const existing = entries.get(record.id);
    if (existing) {
      existing.count += 1;
      for (const chip of effects) {
        const same = existing.effects.find((e) => e.target === chip.target);
        if (same) same.amount += chip.amount;
        else existing.effects.push({ ...chip });
      }
    } else {
      entries.set(record.id, { id: record.id, ageInMonths: record.ageInMonths, count: 1, effects });
    }
  }

  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([age, entries]) => ({
      age,
      entries: [...entries.values()].map((entry) => ({
        ...entry,
        effects: entry.effects.filter((chip) => Math.abs(chip.amount) >= MIN_VISIBLE),
      })),
    }));
}

/** Splits the timeline into the last `RECENT_YEARS` years of age and everything older. */
export function splitRecent(timeline: TimelineYear[], currentAgeInMonths: number): {
  recent: TimelineYear[];
  older: TimelineYear[];
} {
  const firstRecentAge = Math.floor(currentAgeInMonths / 12) - RECENT_YEARS + 1;
  return {
    recent: timeline.filter((year) => year.age >= firstRecentAge),
    older: timeline.filter((year) => year.age < firstRecentAge),
  };
}

export function countEntries(years: TimelineYear[]): number {
  return years.reduce((sum, year) => sum + year.entries.reduce((s, e) => s + e.count, 0), 0);
}
