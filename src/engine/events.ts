/**
 * Event system (design doc section 8).
 *
 * Two kinds of events, both DATA in src/data/events.json:
 * - without choices: `effects` are applied as soon as the event happens;
 * - with choices (D39): the event waits for the player, then the chosen
 *   choice's `effects` are applied. Choices whose conditions are not met are
 *   still shown, disabled, with the reason.
 *
 * This module:
 * 1. validates the data when it loads (a typo must fail loudly, not
 *    silently make an event never happen),
 * 2. decides each month which events happen,
 * 3. applies effects.
 * Pausing the month for a choice is the game loop's job (game.ts).
 */

import { BALANCE } from '../data/balance';
import eventsJson from '../data/events.json';
import { yearlyToMonthly } from './mortality';
import type { Rng } from './rng';
import { applyContributions, clampStat, type Contribution } from './stats';
import {
  EXERCISE_LEVELS,
  OVERTIME_LEVELS,
  SLEEP_LEVELS,
  type EventRecord,
  type GameState,
  type HabitKey,
  type Habits,
  type StatTarget,
  type TraitKey,
} from './types';

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

/** Stats an effect may change: the ones the yearly log handles. */
export const EFFECT_STATS = ['physicalHealth', 'mentalHealth', 'knowledge', 'looks'] as const satisfies readonly StatTarget[];
export type EffectStat = (typeof EFFECT_STATS)[number];

/** Traits an effect may change (D41: halved from age 15). */
export const EFFECT_TRAITS = ['discipline', 'resilience', 'riskTaking'] as const satisfies readonly TraitKey[];

/** Habit levels an effect may switch to. */
export const HABIT_LEVELS: { readonly [K in HabitKey]: readonly Habits[K][] } = {
  exercise: EXERCISE_LEVELS,
  sleep: SLEEP_LEVELS,
  overtime: OVERTIME_LEVELS,
};

/** Flags that game systems (not events) set; conditions may test them. */
export const SYSTEM_FLAGS = ['working', 'traits_revealed'] as const;

export interface StatCondition {
  stat: ConditionStat;
  op: '>=' | '<';
  value: number;
}

/** Conditions on the character, shared by events and by single choices. */
export interface CharacterConditions {
  stats?: StatCondition[];
  flagsAll?: string[];
  flagsNone?: string[];
}

export interface EventConditions extends CharacterConditions {
  /** Whole years, inclusive: 3–12 means from the 3rd birthday until just before the 13th. */
  ageMin: number;
  ageMax: number;
  /** Calendar months 1–12; absent = every month. */
  months?: number[];
}

export interface EventEffects {
  stats?: Partial<Record<EffectStat, number>>;
  traits?: Partial<Record<TraitKey, number>>;
  habits?: Partial<Habits>;
  setFlags?: string[];
  removeFlags?: string[];
}

export interface EventChoice {
  id: string;
  /** Absent = always available. */
  conditions?: CharacterConditions;
  effects: EventEffects;
}

/**
 * Exactly one of `effects` (applied at once) or `choices` (the player
 * picks one) is present; parseEvents enforces it.
 */
export interface EventDef {
  id: string;
  conditions: EventConditions;
  frequency: Frequency;
  once: boolean;
  effects?: EventEffects;
  choices?: EventChoice[];
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

/** Collects problems and flag usage while one file is checked. */
interface Checker {
  problems: string[];
  flagsSet: Set<string>;
  flagsTested: { at: string; flag: string }[];
}

/** stats / flagsAll / flagsNone: shared by event conditions and choice conditions. */
function checkCharacterConditions(c: Record<string, unknown>, at: string, check: Checker): void {
  if (c.stats !== undefined) {
    if (!Array.isArray(c.stats)) check.problems.push(`${at}: conditions.stats must be a list`);
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
          check.problems.push(`${at}: invalid stat condition ${JSON.stringify(s)}`);
        }
      });
  }
  for (const key of ['flagsAll', 'flagsNone'] as const) {
    const list = c[key];
    if (list === undefined) continue;
    if (!isStringArray(list)) check.problems.push(`${at}: ${key} must be a list of flag names`);
    else list.forEach((flag) => check.flagsTested.push({ at, flag }));
  }
}

function checkEffects(e: unknown, at: string, check: Checker): void {
  const { problems } = check;
  if (!isRecord(e)) {
    problems.push(`${at}: effects must be an object (use {} for no effect)`);
    return;
  }
  for (const key of unknownKeys(e, ['stats', 'traits', 'habits', 'setFlags', 'removeFlags'])) {
    problems.push(`${at}: unknown effect "${key}"`);
  }
  for (const [field, allowed] of [
    ['stats', EFFECT_STATS],
    ['traits', EFFECT_TRAITS],
  ] as const) {
    const changes = e[field];
    if (changes === undefined) continue;
    if (!isRecord(changes)) {
      problems.push(`${at}: effects.${field} must be an object`);
      continue;
    }
    for (const [name, amount] of Object.entries(changes)) {
      if (!(allowed as readonly string[]).includes(name)) problems.push(`${at}: effect on unsupported ${field === 'stats' ? 'stat' : 'trait'} "${name}"`);
      if (typeof amount !== 'number' || !Number.isFinite(amount)) problems.push(`${at}: effect on "${name}" must be a number`);
    }
  }
  if (e.habits !== undefined) {
    if (!isRecord(e.habits)) problems.push(`${at}: effects.habits must be an object`);
    else
      for (const [habit, level] of Object.entries(e.habits)) {
        const levels = HABIT_LEVELS[habit as HabitKey] as readonly unknown[] | undefined;
        if (!levels) problems.push(`${at}: effect on unknown habit "${habit}"`);
        else if (!levels.includes(level)) problems.push(`${at}: habit "${habit}" has no level ${JSON.stringify(level)}`);
      }
  }
  for (const key of ['setFlags', 'removeFlags'] as const) {
    const list = e[key];
    if (list === undefined) continue;
    if (!isStringArray(list)) problems.push(`${at}: ${key} must be a list of flag names`);
    else if (key === 'setFlags') list.forEach((flag) => check.flagsSet.add(flag));
  }
}

function checkChoices(choices: unknown, at: string, check: Checker): void {
  const { problems } = check;
  if (!Array.isArray(choices) || choices.length < 2) {
    problems.push(`${at}: choices must be a list of at least 2 choices`);
    return;
  }
  const ids = new Set<string>();
  let alwaysAvailable = 0;
  choices.forEach((choice: unknown, index) => {
    if (!isRecord(choice)) {
      problems.push(`${at}: choice #${index} must be an object`);
      return;
    }
    const id = typeof choice.id === 'string' ? choice.id : '';
    const where = `${at} choice "${id || `#${index}`}"`;
    for (const key of unknownKeys(choice, ['id', 'conditions', 'effects'])) problems.push(`${where}: unknown field "${key}"`);
    if (!ID_PATTERN.test(id)) problems.push(`${where}: id must be lowercase letters, digits and _`);
    if (ids.has(id)) problems.push(`${where}: duplicate choice id`);
    ids.add(id);

    if (choice.conditions === undefined) alwaysAvailable += 1;
    else if (!isRecord(choice.conditions)) problems.push(`${where}: conditions must be an object`);
    else {
      for (const key of unknownKeys(choice.conditions, ['stats', 'flagsAll', 'flagsNone'])) {
        problems.push(`${where}: unknown condition "${key}" (a choice may only test stats and flags)`);
      }
      checkCharacterConditions(choice.conditions, where, check);
    }
    checkEffects(choice.effects, where, check);
  });
  // The popup cannot be closed without choosing, so one choice must always be open.
  if (alwaysAvailable === 0) problems.push(`${at}: at least one choice must have no conditions (always available)`);
}

/**
 * Checks the raw JSON and returns typed events, or throws ONE error listing
 * every problem found (fix them all in one go, not one per run).
 */
export function parseEvents(raw: unknown): EventDef[] {
  if (!Array.isArray(raw)) throw new Error('events.json must be an array');
  const check: Checker = { problems: [], flagsSet: new Set<string>(SYSTEM_FLAGS), flagsTested: [] };
  const { problems } = check;
  const ids = new Set<string>();

  raw.forEach((item: unknown, index) => {
    const where = `event #${index}`;
    if (!isRecord(item)) {
      problems.push(`${where}: must be an object`);
      return;
    }
    const id = typeof item.id === 'string' ? item.id : '';
    const at = id ? `event "${id}"` : where;

    for (const key of unknownKeys(item, ['id', 'conditions', 'frequency', 'once', 'effects', 'choices'])) {
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
      checkCharacterConditions(c, at, check);
      if (c.months !== undefined) {
        const ok = Array.isArray(c.months) && c.months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
        if (!ok) problems.push(`${at}: months must be a list of numbers 1–12`);
      }
    }

    const hasEffects = item.effects !== undefined;
    const hasChoices = item.choices !== undefined;
    if (hasEffects === hasChoices) {
      problems.push(`${at}: needs exactly one of "effects" (no choice) or "choices" (the player picks one)`);
    } else if (hasEffects) {
      checkEffects(item.effects, at, check);
    } else {
      checkChoices(item.choices, at, check);
    }
  });

  // A condition on a flag that nothing ever sets can never be true (or is always true): almost certainly a typo.
  for (const { at, flag } of check.flagsTested) {
    if (!check.flagsSet.has(flag)) problems.push(`${at}: tests flag "${flag}", but no event or system ever sets it`);
  }

  if (problems.length > 0) {
    throw new Error(`Invalid events.json:\n- ${problems.join('\n- ')}`);
  }
  return raw as EventDef[];
}

/** All events, validated once when the game loads. */
export const EVENTS: readonly EventDef[] = parseEvents(eventsJson);

export function findEvent(id: string, events: readonly EventDef[] = EVENTS): EventDef | undefined {
  return events.find((event) => event.id === id);
}

export function hasChoices(event: EventDef): event is EventDef & { choices: EventChoice[] } {
  return event.choices !== undefined;
}

// ── Conditions ──────────────────────────────────────────────────────────────

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

function meetsStat(state: GameState, s: StatCondition): boolean {
  const value = readConditionStat(state, s.stat);
  return s.op === '>=' ? value >= s.value : value < s.value;
}

function meetsCharacterConditions(state: GameState, c: CharacterConditions): boolean {
  if (c.flagsAll && !c.flagsAll.every((flag) => state.flags.includes(flag))) return false;
  if (c.flagsNone && c.flagsNone.some((flag) => state.flags.includes(flag))) return false;
  return (c.stats ?? []).every((s) => meetsStat(state, s));
}

export function hasHappened(state: GameState, eventId: string): boolean {
  return (
    state.eventHistory.some((record) => record.id === eventId) ||
    state.pendingChoices.some((pending) => pending.eventId === eventId)
  );
}

export function isEligible(event: EventDef, state: GameState): boolean {
  const c = event.conditions;
  const age = Math.floor(state.ageInMonths / 12);
  if (age < c.ageMin || age > c.ageMax) return false;
  if (event.once && hasHappened(state, event.id)) return false;
  if (c.months && !c.months.includes(calendarMonth(state))) return false;
  return meetsCharacterConditions(state, c);
}

/** Why a choice cannot be picked now; the UI turns each reason into text. */
export type LockReason =
  | { kind: 'stat'; stat: ConditionStat; op: '>=' | '<'; value: number; current: number }
  /** A flag condition is not met; the event's content explains it in its own words. */
  | { kind: 'flag' };

/** Empty list = the choice is available. */
export function lockReasons(choice: EventChoice, state: GameState): LockReason[] {
  const c = choice.conditions;
  if (!c) return [];
  const reasons: LockReason[] = (c.stats ?? [])
    .filter((s) => !meetsStat(state, s))
    .map((s) => ({ kind: 'stat', stat: s.stat, op: s.op, value: s.value, current: readConditionStat(state, s.stat) }));
  const flagsOk =
    (c.flagsAll ?? []).every((flag) => state.flags.includes(flag)) &&
    !(c.flagsNone ?? []).some((flag) => state.flags.includes(flag));
  if (!flagsOk) reasons.push({ kind: 'flag' });
  return reasons;
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

/** D41: how strongly an event can still change traits at this age. */
export function traitEffectFactor(state: Pick<GameState, 'ageInMonths'>): number {
  const { traitEffectsReducedFromAge, traitFactorLater } = BALANCE.events;
  return state.ageInMonths / 12 >= traitEffectsReducedFromAge ? traitFactorLater : 1;
}

/**
 * Applies effects and records the occurrence. MUTATES `state` (engine-private copy).
 * Stats go through applyContributions (clamped, logged under `event.<id>`);
 * trait and habit changes are stored on the history record itself.
 */
function applyEffects(state: GameState, eventId: string, effects: EventEffects, ageInMonths: number, choiceId?: string): void {
  const source = `event.${eventId}`;
  const contributions: Contribution[] = Object.entries(effects.stats ?? {}).map(([stat, amount]) => ({
    target: stat as EffectStat,
    source,
    amount: amount ?? 0,
  }));
  applyContributions(state, contributions);

  const record: EventRecord = { id: eventId, ageInMonths, ...(choiceId !== undefined ? { choiceId } : {}) };

  const factor = traitEffectFactor(state);
  const traitChanges: Partial<Record<TraitKey, number>> = {};
  for (const [trait, amount] of Object.entries(effects.traits ?? {}) as [TraitKey, number][]) {
    const before = state.traits[trait];
    state.traits[trait] = clampStat(before + amount * factor);
    const actual = state.traits[trait] - before;
    if (actual !== 0) traitChanges[trait] = actual;
  }
  if (Object.keys(traitChanges).length > 0) record.traitChanges = traitChanges;

  const habitChanges: Partial<Habits> = {};
  for (const [habit, level] of Object.entries(effects.habits ?? {}) as [HabitKey, Habits[HabitKey]][]) {
    if (state.habits[habit] === level) continue;
    (state.habits as Record<HabitKey, string>)[habit] = level;
    (habitChanges as Record<HabitKey, string>)[habit] = level;
  }
  if (Object.keys(habitChanges).length > 0) record.habitChanges = habitChanges;

  for (const flag of effects.setFlags ?? []) {
    if (!state.flags.includes(flag)) state.flags.push(flag);
  }
  if (effects.removeFlags) {
    state.flags = state.flags.filter((flag) => !effects.removeFlags!.includes(flag));
  }
  state.eventHistory.push(record);
}

/** Applies an event WITHOUT choices and records it. MUTATES `state`. */
export function applyEvent(state: GameState, event: EventDef): void {
  if (hasChoices(event)) throw new Error(`Event "${event.id}" has choices; it must wait for the player`);
  applyEffects(state, event.id, event.effects ?? {}, state.ageInMonths);
}

/**
 * Applies the player's choice for an event that was waiting, and records it
 * with the age at which the event HAPPENED. MUTATES `state`.
 * Throws for an unknown or locked choice: the UI must never offer those.
 */
export function applyChoice(state: GameState, event: EventDef, choiceId: string, ageInMonths: number): void {
  const choice = event.choices?.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`Event "${event.id}" has no choice "${choiceId}"`);
  if (lockReasons(choice, state).length > 0) throw new Error(`Choice "${choiceId}" of "${event.id}" is locked`);
  applyEffects(state, event.id, choice.effects, ageInMonths, choiceId);
}
