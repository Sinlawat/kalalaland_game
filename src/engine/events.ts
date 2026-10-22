/**
 * Event system, first increment (design doc section 8).
 *
 * Scope now: events WITHOUT choices — conditions, frequency, once,
 * guaranteed, stat effects and flags. Choices come in the next increment.
 *
 * Events are DATA (src/data/events.json). This module:
 * 1. validates the data when it loads (a typo must fail loudly, not
 *    silently make an event never happen),
 * 2. decides each month which events happen,
 * 3. applies their effects.
 */

import { BALANCE } from '../data/balance';
import eventsJson from '../data/events.json';
import { yearlyToMonthly } from './mortality';
import type { Rng } from './rng';
import { applyContributions, type Contribution } from './stats';
import type { GameState, StatTarget } from './types';

// ── Data types ──────────────────────────────────────────────────────────────

export const FREQUENCIES = ['guaranteed', 'rare', 'uncommon', 'normal', 'common'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Values a condition may test. */
export const CONDITION_STATS = [
  'physicalHealth', 'mentalHealth', 'knowledge', 'looks', 'fame',
  'discipline', 'resilience', 'riskTaking',
  'familyWealth', 'familyWarmth', 'workStress', 'financialStress',
] as const;
export type ConditionStat = (typeof CONDITION_STATS)[number];

/**
 * Values an effect may change — for now only those the yearly log already
 * handles. Traits and environment are added when the first event needs them.
 */
export const EFFECT_STATS = ['physicalHealth', 'mentalHealth', 'knowledge', 'looks'] as const satisfies readonly StatTarget[];
export type EffectStat = (typeof EFFECT_STATS)[number];

/** Flags that game systems (not events) set; conditions may test them. */
export const SYSTEM_FLAGS = ['working', 'traits_revealed'] as const;

export interface StatCondition {
  stat: ConditionStat;
  op: '>=' | '<';
  value: number;
}

export interface EventConditions {
  /** Whole years, inclusive: 3–12 means from the 3rd birthday until just before the 13th. */
  ageMin: number;
  ageMax: number;
  stats?: StatCondition[];
  flagsAll?: string[];
  flagsNone?: string[];
  /** Calendar months 1–12; absent = every month. */
  months?: number[];
}

export interface EventEffects {
  stats?: Partial<Record<EffectStat, number>>;
  setFlags?: string[];
  removeFlags?: string[];
}

export interface EventDef {
  id: string;
  conditions: EventConditions;
  frequency: Frequency;
  once: boolean;
  effects: EventEffects;
}

// ── Validation ──────────────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

/**
 * Checks the raw JSON and returns typed events, or throws ONE error listing
 * every problem found (fix them all in one go, not one per run).
 */
export function parseEvents(raw: unknown): EventDef[] {
  const problems: string[] = [];
  if (!Array.isArray(raw)) throw new Error('events.json must be an array');

  const ids = new Set<string>();
  const flagsSet = new Set<string>(SYSTEM_FLAGS);
  const flagsTested: { id: string; flag: string }[] = [];

  raw.forEach((item: unknown, index) => {
    const where = `event #${index}`;
    if (!isRecord(item)) {
      problems.push(`${where}: must be an object`);
      return;
    }
    const id = typeof item.id === 'string' ? item.id : '';
    const at = id ? `event "${id}"` : where;

    for (const key of unknownKeys(item, ['id', 'conditions', 'frequency', 'once', 'effects'])) {
      problems.push(`${at}: unknown field "${key}"`);
    }
    if (!ID_PATTERN.test(id)) problems.push(`${at}: id must be lowercase letters, digits and _`);
    if (ids.has(id)) problems.push(`${at}: duplicate id`);
    ids.add(id);

    if (!FREQUENCIES.includes(item.frequency as Frequency)) {
      problems.push(`${at}: frequency must be one of ${FREQUENCIES.join(', ')}`);
    }
    if (typeof item.once !== 'boolean') problems.push(`${at}: once must be true or false`);
    if (item.frequency === 'guaranteed' && item.once !== true) {
      problems.push(`${at}: a guaranteed event must be once (otherwise it happens every month)`);
    }

    // conditions
    const c = item.conditions;
    if (!isRecord(c)) {
      problems.push(`${at}: conditions must be an object`);
    } else {
      for (const key of unknownKeys(c, ['ageMin', 'ageMax', 'stats', 'flagsAll', 'flagsNone', 'months'])) {
        problems.push(`${at}: unknown condition "${key}"`);
      }
      const { ageMin, ageMax } = c;
      if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || (ageMin as number) < 0 || (ageMin as number) > (ageMax as number)) {
        problems.push(`${at}: ageMin/ageMax must be whole years with 0 <= ageMin <= ageMax`);
      }
      if (c.stats !== undefined) {
        if (!Array.isArray(c.stats)) problems.push(`${at}: conditions.stats must be a list`);
        else
          c.stats.forEach((s: unknown) => {
            if (
              !isRecord(s) ||
              !CONDITION_STATS.includes(s.stat as ConditionStat) ||
              (s.op !== '>=' && s.op !== '<') ||
              typeof s.value !== 'number' ||
              s.value < 0 ||
              s.value > 100
            ) {
              problems.push(`${at}: invalid stat condition ${JSON.stringify(s)}`);
            }
          });
      }
      for (const key of ['flagsAll', 'flagsNone'] as const) {
        const list = c[key];
        if (list === undefined) continue;
        if (!isStringArray(list)) problems.push(`${at}: ${key} must be a list of flag names`);
        else list.forEach((flag) => flagsTested.push({ id: at, flag }));
      }
      if (c.months !== undefined) {
        const ok = Array.isArray(c.months) && c.months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
        if (!ok) problems.push(`${at}: months must be a list of numbers 1–12`);
      }
    }

    // effects
    const e = item.effects;
    if (!isRecord(e)) {
      problems.push(`${at}: effects must be an object (use {} for no effect)`);
    } else {
      for (const key of unknownKeys(e, ['stats', 'setFlags', 'removeFlags'])) {
        problems.push(`${at}: unknown effect "${key}"`);
      }
      if (e.stats !== undefined) {
        if (!isRecord(e.stats)) problems.push(`${at}: effects.stats must be an object`);
        else
          for (const [stat, amount] of Object.entries(e.stats)) {
            if (!EFFECT_STATS.includes(stat as EffectStat)) problems.push(`${at}: effect on unsupported stat "${stat}"`);
            if (typeof amount !== 'number' || !Number.isFinite(amount)) problems.push(`${at}: effect on "${stat}" must be a number`);
          }
      }
      for (const key of ['setFlags', 'removeFlags'] as const) {
        const list = e[key];
        if (list === undefined) continue;
        if (!isStringArray(list)) problems.push(`${at}: ${key} must be a list of flag names`);
        else if (key === 'setFlags') list.forEach((flag) => flagsSet.add(flag));
      }
    }
  });

  // A condition on a flag that nothing ever sets can never be true (or is always true): almost certainly a typo.
  for (const { id, flag } of flagsTested) {
    if (!flagsSet.has(flag)) problems.push(`${id}: tests flag "${flag}", but no event or system ever sets it`);
  }

  if (problems.length > 0) {
    throw new Error(`Invalid events.json:\n- ${problems.join('\n- ')}`);
  }
  return raw as EventDef[];
}

/** All events, validated once when the game loads. */
export const EVENTS: readonly EventDef[] = parseEvents(eventsJson);

// ── Selection ───────────────────────────────────────────────────────────────

/** Calendar month (1–12) of the current game month. */
export function calendarMonth(state: Pick<GameState, 'birthMonth' | 'ageInMonths'>): number {
  return ((state.birthMonth - 1 + state.ageInMonths) % 12) + 1;
}

export function readConditionStat(state: GameState, stat: ConditionStat): number {
  switch (stat) {
    case 'physicalHealth':
    case 'mentalHealth':
    case 'knowledge':
      return state.condition[stat];
    case 'looks':
    case 'fame':
      return state.outcome[stat];
    case 'discipline':
    case 'resilience':
    case 'riskTaking':
      return state.traits[stat];
    case 'familyWealth':
    case 'familyWarmth':
    case 'workStress':
    case 'financialStress':
      return state.environment[stat];
  }
}

export function hasHappened(state: GameState, eventId: string): boolean {
  return state.eventHistory.some((record) => record.id === eventId);
}

export function isEligible(event: EventDef, state: GameState): boolean {
  const c = event.conditions;
  const age = Math.floor(state.ageInMonths / 12);
  if (age < c.ageMin || age > c.ageMax) return false;
  if (event.once && hasHappened(state, event.id)) return false;
  if (c.months && !c.months.includes(calendarMonth(state))) return false;
  if (c.flagsAll && !c.flagsAll.every((flag) => state.flags.includes(flag))) return false;
  if (c.flagsNone && c.flagsNone.some((flag) => state.flags.includes(flag))) return false;
  for (const s of c.stats ?? []) {
    const value = readConditionStat(state, s.stat);
    if (s.op === '>=' ? !(value >= s.value) : !(value < s.value)) return false;
  }
  return true;
}

export function monthlyChance(frequency: Frequency): number {
  if (frequency === 'guaranteed') return 1;
  return yearlyToMonthly(BALANCE.events.yearlyChance[frequency]);
}

/**
 * Which events happen this month. Eligibility is checked for all events
 * BEFORE any is applied, so the order of events in the file cannot make
 * one event unlock another within the same month.
 */
export function rollEvents(state: GameState, rng: Rng, events: readonly EventDef[] = EVENTS): EventDef[] {
  return events
    .filter((event) => isEligible(event, state))
    .filter((event) => rng.chance(monthlyChance(event.frequency)));
}

// ── Effects ─────────────────────────────────────────────────────────────────

/** Applies an event and records it. MUTATES `state` (engine-private copy). */
export function applyEvent(state: GameState, event: EventDef): void {
  const source = `event.${event.id}`;
  const contributions: Contribution[] = Object.entries(event.effects.stats ?? {}).map(([stat, amount]) => ({
    target: stat as EffectStat,
    source,
    amount: amount ?? 0,
  }));
  applyContributions(state, contributions);

  for (const flag of event.effects.setFlags ?? []) {
    if (!state.flags.includes(flag)) state.flags.push(flag);
  }
  if (event.effects.removeFlags) {
    state.flags = state.flags.filter((flag) => !event.effects.removeFlags!.includes(flag));
  }
  state.eventHistory.push({ id: event.id, ageInMonths: state.ageInMonths });
}
