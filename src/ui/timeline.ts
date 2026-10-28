/**
 * Builds the life timeline from data the save already has:
 * - `eventHistory`: which event happened at which age, which choice was
 *   made, and what it did to traits and habits,
 * - `history[].changes`: what each source changed in the stats during each year.
 *
 * Pure functions (no React), so they are unit-tested directly.
 */

import { calendarMonth } from '../engine/events';
import { TRAIT_KEYS, type EnvironmentKey, type EventRecord, type GameState, type HabitKey, type Habits, type StatTarget, type TraitKey, type WorkChange } from '../engine/types';

/** Design decision: the timeline card shows the last 5 years; older ones are in the history popup. */
export const RECENT_YEARS = 5;

/** Order of stat chips under an event. */
export const EFFECT_ORDER: StatTarget[] = [
  'physicalHealth', 'mentalHealth', 'academic', 'creative', 'communication', 'practical', 'looks',
];
/** Trait chips come after the stat chips, then the family environment. */
const TRAIT_ORDER: readonly TraitKey[] = TRAIT_KEYS;
const ENVIRONMENT_ORDER: EnvironmentKey[] = ['familyWealth', 'familyWarmth'];

/** Effects smaller than this are hidden (they would show as "0"). */
const MIN_VISIBLE = 0.05;

export interface EffectChip {
  /** A stat, a trait or an environment value; all have a `stat.<target>` label. */
  target: StatTarget | TraitKey | EnvironmentKey;
  amount: number;
}

export interface TimelineEntry {
  /**
   * Unique within a year: the event id, plus the choice for events with
   * choices, plus `@<n>` for a later, separate occurrence of the same one.
   */
  key: string;
  id: string;
  /** The choice made, for events with choices (the text then comes from the result). */
  choiceId?: string;
  /** Habits the event switched to (the latest occurrence wins). */
  habitChanges?: Partial<Habits>;
  /** Months for temporary changes (D56), matching `habitChanges`. */
  habitMonths?: Partial<Record<HabitKey, number>>;
  /** Where the event moved the character (the latest occurrence wins). */
  residenceChange?: EventRecord['residenceChange'];
  /** D72: the name of the person the event was about. */
  personName?: string;
  /** D77: what the event did to the savings, summed over occurrences. */
  moneyChange?: number;
  /** D77: the job the event started, changed or ended (the latest occurrence wins). */
  workChange?: WorkChange;
  /** Month of life of the LATEST occurrence in this year of age (entries are sorted by it, newest first). */
  ageInMonths: number;
  /** Calendar month (1–12) of that occurrence, shown beside the title so the order is visible. */
  calendarMonth: number;
  /** How many times it happened in this year of age (repeatable events). */
  count: number;
  /** What the event REALLY changed (after clamping to 0–100), summed over occurrences. */
  effects: EffectChip[];
}

export interface TimelineYear {
  /** Whole years of age when the events happened (0 = first year of life). */
  age: number;
  entries: TimelineEntry[];
  /** D77: wages earned and money given to the family in that year, when there were wages. */
  money?: { earned: number; given: number };
}

export type TimelineSource = Pick<GameState, 'eventHistory' | 'history' | 'yearLog' | 'birthMonth'> & Partial<Pick<GameState, 'money'>>;

/** D77: wages of the summary year of age `age` (closed on the next birthday, or the running year). */
function yearMoney(state: TimelineSource, age: number): TimelineYear['money'] {
  // The summary closed on the next birthday (or, in the year of death, a fraction of a year later).
  const closed = state.history.find((summary) => summary.age > age && summary.age <= age + 1);
  const money = closed !== undefined ? closed.money : state.history.every((summary) => summary.age <= age) ? state.money?.year : undefined;
  return money !== undefined && money.earned > 0 ? { earned: money.earned, given: money.given } : undefined;
}

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
export function effectsOfOccurrence(state: TimelineSource, id: string, ageInMonths: number): EffectChip[] {
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

/**
 * Everything one occurrence REALLY changed: stats (from the year log), and
 * traits and the family environment (stored on the record: they have no log).
 */
export function chipsOfRecord(state: TimelineSource, record: EventRecord): EffectChip[] {
  const traitChips = TRAIT_ORDER.flatMap((target) => {
    const amount = record.traitChanges?.[target];
    return amount === undefined ? [] : [{ target, amount }];
  });
  const environmentChips = ENVIRONMENT_ORDER.flatMap((target) => {
    const amount = record.environmentChanges?.[target];
    return amount === undefined ? [] : [{ target, amount }];
  });
  return [...effectsOfOccurrence(state, record.id, record.ageInMonths), ...traitChips, ...environmentChips];
}

/**
 * All years that had events, NEWEST FIRST — and within a year too, so the
 * whole card reads one way ("latest on top").
 *
 * An event that happened again RIGHT AFTER itself (nothing else in between,
 * same year of age) is one entry with a count, placed by its latest time.
 * If other events came in between, each occurrence keeps its own place:
 * merging "new job" across a second "lost job" would tell the story wrong.
 */
export function buildTimeline(state: TimelineSource): TimelineYear[] {
  const years = new Map<number, Map<string, TimelineEntry>>();
  // Position in the history of each entry's latest occurrence: the sort order.
  const latestIndex = new Map<TimelineEntry, number>();
  // The entry added or extended last in each year: only that one can absorb a repeat.
  const lastInYear = new Map<number, TimelineEntry>();

  state.eventHistory.forEach((record, index) => {
    const age = Math.floor(record.ageInMonths / 12);
    const entries = years.get(age) ?? new Map<string, TimelineEntry>();
    years.set(age, entries);

    const effects = chipsOfRecord(state, record);
    // D72: the same event about two different people is two stories, never one entry with a count.
    const baseKey = [record.id, record.choiceId, record.person?.nickname].filter((part) => part !== undefined).join(':');
    const previous = lastInYear.get(age);
    const existing = previous?.key.split('@')[0] === baseKey ? previous : undefined;
    // A separate, later occurrence needs its own unique key (React list keys).
    const key = entries.has(baseKey) ? `${baseKey}@${index}` : baseKey;
    if (existing) {
      existing.count += 1;
      for (const chip of effects) {
        const same = existing.effects.find((e) => e.target === chip.target);
        if (same) same.amount += chip.amount;
        else existing.effects.push({ ...chip });
      }
      if (record.habitChanges) existing.habitChanges = { ...existing.habitChanges, ...record.habitChanges };
      if (record.habitMonths) existing.habitMonths = { ...existing.habitMonths, ...record.habitMonths };
      if (record.residenceChange) existing.residenceChange = record.residenceChange;
      if (record.moneyChange !== undefined) existing.moneyChange = (existing.moneyChange ?? 0) + record.moneyChange;
      if (record.workChange) existing.workChange = record.workChange;
      existing.ageInMonths = record.ageInMonths;
      existing.calendarMonth = calendarMonth({ birthMonth: state.birthMonth, ageInMonths: record.ageInMonths });
      latestIndex.set(existing, index);
      lastInYear.set(age, existing);
    } else {
      const entry: TimelineEntry = {
        key,
        id: record.id,
        ...(record.choiceId !== undefined ? { choiceId: record.choiceId } : {}),
        ...(record.habitChanges ? { habitChanges: { ...record.habitChanges } } : {}),
        ...(record.habitMonths ? { habitMonths: { ...record.habitMonths } } : {}),
        ...(record.residenceChange ? { residenceChange: record.residenceChange } : {}),
        ...(record.person ? { personName: record.person.nickname } : {}),
        ...(record.moneyChange !== undefined ? { moneyChange: record.moneyChange } : {}),
        ...(record.workChange ? { workChange: record.workChange } : {}),
        ageInMonths: record.ageInMonths,
        calendarMonth: calendarMonth({ birthMonth: state.birthMonth, ageInMonths: record.ageInMonths }),
        count: 1,
        effects,
      };
      entries.set(key, entry);
      latestIndex.set(entry, index);
      lastInYear.set(age, entry);
    }
  });

  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([age, entries]) => ({
      age,
      ...(yearMoney(state, age) !== undefined ? { money: yearMoney(state, age)! } : {}),
      entries: [...entries.values()]
        .sort((a, b) => latestIndex.get(b)! - latestIndex.get(a)!)
        .map((entry) => ({
          ...entry,
          effects: entry.effects.filter((chip) => Math.abs(chip.amount) >= MIN_VISIBLE),
        })),
    }));
}

/**
 * D35: before Grade 1 the child does not know their own traits, so the
 * timeline must not show trait chips ("วินัย +2") either. The changes are
 * real and stay in the data; they appear once the traits are revealed.
 */
export function withoutTraitChips(years: TimelineYear[]): TimelineYear[] {
  return years.map((year) => ({
    ...year,
    entries: year.entries.map((entry) => ({
      ...entry,
      effects: entry.effects.filter((chip) => !(TRAIT_ORDER as readonly string[]).includes(chip.target)),
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
