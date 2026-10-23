/**
 * Event system (design doc section 8).
 *
 * Two kinds of events, both DATA in src/data/events.json:
 * - without choices: `effects` are applied as soon as the event happens;
 * - with choices (D39): the event waits for the player, then the chosen
 *   choice's `effects` are applied. Choices whose conditions are not met are
 *   still shown, disabled, with the reason.
 *
 * Which events happen (D53, the event pool):
 * - 'guaranteed' events happen in the first month their conditions are met;
 * - every other eligible event sits in a POOL. Each month the game decides
 *   whether something happens (a few times a year, by age), and if so picks
 *   ONE event from the pool, weighted by its frequency word. Writing more
 *   events adds variety, not frequency.
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
import { setHabitFromEvent } from './lifestyle';
import { createRng, type Rng } from './rng';
import { applyContributions, clampStat, type Contribution } from './stats';
import {
  HABIT_LEVELS,
  HOME_IDS,
  REGION_IDS,
  type EnvironmentKey,
  type EventRecord,
  type GameState,
  type HabitKey,
  type Habits,
  type HomeId,
  type RegionId,
  type StatTarget,
  type TraitKey,
} from './types';

// ── Data types ──────────────────────────────────────────────────────────────

export const FREQUENCIES = ['guaranteed', 'rare', 'uncommon', 'normal', 'common'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export type PoolFrequency = Exclude<Frequency, 'guaranteed'>;

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

/**
 * The family environment an event may change (D57), e.g. a parent losing
 * their job lowers Family wealth. Work and financial stress are left out on
 * purpose: the career and finance systems will own them.
 */
export const EFFECT_ENVIRONMENT = ['familyWealth', 'familyWarmth'] as const satisfies readonly EnvironmentKey[];
export type EffectEnvironment = (typeof EFFECT_ENVIRONMENT)[number];

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
  /** The lifestyle the character must have right now, e.g. { overtime: 'heavy' }. */
  habits?: Partial<Habits>;
}

export interface EventConditions extends CharacterConditions {
  /** Whole years, inclusive: 3–12 means from the 3rd birthday until just before the 13th. */
  ageMin: number;
  ageMax: number;
  /** Calendar months 1–12; absent = every month. */
  months?: number[];
}

/** A lifestyle change: a level (lasting), or a level for some months (D56). */
export type HabitEffect<K extends HabitKey> = Habits[K] | { level: Habits[K]; months: number };

export interface EventEffects {
  stats?: Partial<Record<EffectStat, number>>;
  traits?: Partial<Record<TraitKey, number>>;
  environment?: Partial<Record<EffectEnvironment, number>>;
  habits?: { [K in HabitKey]?: HabitEffect<K> };
  /** Moves the character (save version 7), e.g. to the grandparents' home in the countryside. */
  residence?: { region?: RegionId; home?: HomeId };
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
  /** Repeatable events: months to wait after an occurrence before it can happen again. */
  cooldownMonths?: number;
  /**
   * 0–1: the share of lives in which this event can EVER happen (e.g. a
   * hereditary condition). Decided once per life, see `lifetimeRoll`.
   */
  lifetimeChance?: number;
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

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isHabitLevel(habit: string, level: unknown): boolean {
  const levels = HABIT_LEVELS[habit as HabitKey] as readonly unknown[] | undefined;
  return levels !== undefined && levels.includes(level);
}

/** Collects problems and flag usage while one file is checked. */
interface Checker {
  problems: string[];
  flagsSet: Set<string>;
  flagsTested: { at: string; flag: string }[];
}

/** stats / flagsAll / flagsNone / habits: shared by event conditions and choice conditions. */
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
  if (c.habits !== undefined) {
    if (!isRecord(c.habits)) check.problems.push(`${at}: conditions.habits must be an object`);
    else
      for (const [habit, level] of Object.entries(c.habits)) {
        if (!isHabitLevel(habit, level)) check.problems.push(`${at}: invalid lifestyle condition ${habit} = ${JSON.stringify(level)}`);
      }
  }
}

function checkEffects(e: unknown, at: string, check: Checker): void {
  const { problems } = check;
  if (!isRecord(e)) {
    problems.push(`${at}: effects must be an object (use {} for no effect)`);
    return;
  }
  for (const key of unknownKeys(e, ['stats', 'traits', 'environment', 'habits', 'residence', 'setFlags', 'removeFlags'])) {
    problems.push(`${at}: unknown effect "${key}"`);
  }
  for (const [field, allowed] of [
    ['stats', EFFECT_STATS],
    ['traits', EFFECT_TRAITS],
    ['environment', EFFECT_ENVIRONMENT],
  ] as const) {
    const changes = e[field];
    if (changes === undefined) continue;
    if (!isRecord(changes)) {
      problems.push(`${at}: effects.${field} must be an object`);
      continue;
    }
    for (const [name, amount] of Object.entries(changes)) {
      const kind = { stats: 'stat', traits: 'trait', environment: 'environment value' }[field];
      if (!(allowed as readonly string[]).includes(name)) problems.push(`${at}: effect on unsupported ${kind} "${name}"`);
      if (typeof amount !== 'number' || !Number.isFinite(amount)) problems.push(`${at}: effect on "${name}" must be a number`);
    }
  }
  if (e.habits !== undefined) {
    if (!isRecord(e.habits)) problems.push(`${at}: effects.habits must be an object`);
    else
      for (const [habit, spec] of Object.entries(e.habits)) {
        const level = isRecord(spec) ? spec.level : spec;
        if (!(habit in HABIT_LEVELS)) problems.push(`${at}: effect on unknown habit "${habit}"`);
        else if (!isHabitLevel(habit, level)) problems.push(`${at}: habit "${habit}" has no level ${JSON.stringify(level)}`);
        if (isRecord(spec)) {
          for (const key of unknownKeys(spec, ['level', 'months'])) problems.push(`${at}: habit "${habit}": unknown field "${key}"`);
          if (!isPositiveInteger(spec.months)) problems.push(`${at}: habit "${habit}": months must be a whole number above 0`);
        }
      }
  }
  if (e.residence !== undefined) {
    const residence = e.residence;
    if (!isRecord(residence) || (residence.region === undefined && residence.home === undefined)) {
      problems.push(`${at}: effects.residence must name a region, a home, or both`);
    } else {
      for (const key of unknownKeys(residence, ['region', 'home'])) problems.push(`${at}: residence: unknown field "${key}"`);
      if (residence.region !== undefined && !(REGION_IDS as readonly unknown[]).includes(residence.region)) {
        problems.push(`${at}: residence: unknown region ${JSON.stringify(residence.region)}`);
      }
      if (residence.home !== undefined && !(HOME_IDS as readonly unknown[]).includes(residence.home)) {
        problems.push(`${at}: residence: unknown home ${JSON.stringify(residence.home)}`);
      }
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
      for (const key of unknownKeys(choice.conditions, ['stats', 'flagsAll', 'flagsNone', 'habits'])) {
        problems.push(`${where}: unknown condition "${key}" (a choice may only test stats, flags and lifestyle)`);
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

    for (const key of unknownKeys(item, ['id', 'conditions', 'frequency', 'once', 'cooldownMonths', 'lifetimeChance', 'effects', 'choices'])) {
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
    if (item.cooldownMonths !== undefined) {
      if (!isPositiveInteger(item.cooldownMonths)) problems.push(`${at}: cooldownMonths must be a whole number above 0`);
      if (item.once === true) problems.push(`${at}: cooldownMonths only makes sense for a repeatable event (once: false)`);
    }
    if (item.lifetimeChance !== undefined) {
      const chance = item.lifetimeChance;
      if (typeof chance !== 'number' || !(chance > 0 && chance < 1)) {
        problems.push(`${at}: lifetimeChance must be a number between 0 and 1 (0.1 = 10% of lives)`);
      }
    }

    const c = item.conditions;
    if (!isRecord(c)) {
      problems.push(`${at}: conditions must be an object`);
    } else {
      for (const key of unknownKeys(c, ['ageMin', 'ageMax', 'stats', 'flagsAll', 'flagsNone', 'habits', 'months'])) {
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

function habitEntries(habits: Partial<Habits> | undefined): [HabitKey, string][] {
  return Object.entries(habits ?? {}) as [HabitKey, string][];
}

function meetsCharacterConditions(state: GameState, c: CharacterConditions): boolean {
  if (c.flagsAll && !c.flagsAll.every((flag) => state.flags.includes(flag))) return false;
  if (c.flagsNone && c.flagsNone.some((flag) => state.flags.includes(flag))) return false;
  if (habitEntries(c.habits).some(([habit, level]) => state.habits[habit] !== level)) return false;
  return (c.stats ?? []).every((s) => meetsStat(state, s));
}

/**
 * Last month each event happened in, including events still waiting for a
 * choice. Built once per month, so checking hundreds of events stays cheap
 * however long the life history gets.
 */
export type HappenedIndex = ReadonlyMap<string, number>;

export function happenedIndex(state: Pick<GameState, 'eventHistory' | 'pendingChoices'>): HappenedIndex {
  const last = new Map<string, number>();
  for (const record of state.eventHistory) last.set(record.id, record.ageInMonths);
  for (const pending of state.pendingChoices) last.set(pending.eventId, pending.ageInMonths);
  return last;
}

export function hasHappened(state: GameState, eventId: string): boolean {
  return happenedIndex(state).has(eventId);
}

/**
 * A number in [0, 1) fixed for this life and this event: the same seed and
 * event id always give the same value. Used for `lifetimeChance`, so it
 * behaves as if it were rolled at birth, yet:
 * - it draws nothing from the game's RNG (no other result changes), and
 * - it also works for events added by an update after the life started.
 */
export function lifetimeRoll(seed: number, eventId: string): number {
  // FNV-1a hash of "seed|id", then one step of the game's generator to spread the bits.
  let hash = 0x811c9dc5;
  for (const char of `${seed}|${eventId}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return createRng(hash).next();
}

export function isEligible(event: EventDef, state: GameState, happened: HappenedIndex = happenedIndex(state)): boolean {
  const c = event.conditions;
  const age = Math.floor(state.ageInMonths / 12);
  if (age < c.ageMin || age > c.ageMax) return false;
  const last = happened.get(event.id);
  if (last !== undefined) {
    if (event.once) return false;
    if (event.cooldownMonths !== undefined && state.ageInMonths - last < event.cooldownMonths) return false;
  }
  if (c.months && !c.months.includes(calendarMonth(state))) return false;
  if (event.lifetimeChance !== undefined && lifetimeRoll(state.seed, event.id) >= event.lifetimeChance) return false;
  return meetsCharacterConditions(state, c);
}

/** Why a choice cannot be picked now; the UI turns each reason into text. */
export type LockReason =
  | { kind: 'stat'; stat: ConditionStat; op: '>=' | '<'; value: number; current: number }
  | { kind: 'habit'; habit: HabitKey; level: string }
  /** A flag condition is not met; the event's content explains it in its own words. */
  | { kind: 'flag' };

/** Empty list = the choice is available. */
export function lockReasons(choice: EventChoice, state: GameState): LockReason[] {
  const c = choice.conditions;
  if (!c) return [];
  const reasons: LockReason[] = (c.stats ?? [])
    .filter((s) => !meetsStat(state, s))
    .map((s) => ({ kind: 'stat', stat: s.stat, op: s.op, value: s.value, current: readConditionStat(state, s.stat) }));
  for (const [habit, level] of habitEntries(c.habits)) {
    if (state.habits[habit] !== level) reasons.push({ kind: 'habit', habit, level });
  }
  const flagsOk =
    (c.flagsAll ?? []).every((flag) => state.flags.includes(flag)) &&
    !(c.flagsNone ?? []).some((flag) => state.flags.includes(flag));
  if (!flagsOk) reasons.push({ kind: 'flag' });
  return reasons;
}

// ── Selection: guaranteed events + the pool (D53) ───────────────────────────

/** Ages above this share one bucket in the age index. */
const MAX_INDEXED_AGE = 120;

/**
 * Events grouped by every whole year of age they can happen in, keeping the
 * file order within a year (so results never depend on the grouping).
 * Built once per event list; with thousands of events a month then only
 * looks at the few that fit the age, instead of all of them.
 */
const ageIndexCache = new WeakMap<readonly EventDef[], EventDef[][]>();

function ageIndex(events: readonly EventDef[]): EventDef[][] {
  let index = ageIndexCache.get(events);
  if (!index) {
    index = Array.from({ length: MAX_INDEXED_AGE + 1 }, () => []);
    for (const event of events) {
      const last = Math.min(event.conditions.ageMax, MAX_INDEXED_AGE);
      for (let age = Math.min(event.conditions.ageMin, MAX_INDEXED_AGE); age <= last; age++) index[age]!.push(event);
    }
    ageIndexCache.set(events, index);
  }
  return index;
}

/** D53: average number of pool events per year at this age. */
export function poolEventsPerYear(age: number): number {
  const band = BALANCE.events.poolEventsPerYear.find((b) => age >= b.fromAge);
  return band ? band.perYear : 0;
}

/** Chance that ONE pool event happens in a month. */
export function monthlyPoolChance(age: number): number {
  return Math.min(1, poolEventsPerYear(age) / 12);
}

/** Picks one event, each with probability weight / total weight. */
export function pickWeighted(pool: readonly EventDef[], rng: Rng): EventDef {
  const weights = pool.map((event) => BALANCE.events.poolWeights[event.frequency as PoolFrequency]);
  let roll = rng.next() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return pool[i]!;
  }
  return pool.at(-1)!; // floating-point safety: roll landed exactly on the total
}

/**
 * Which events happen this month: every eligible guaranteed event, plus at
 * most one event from the pool. Eligibility is checked for all events
 * BEFORE any is applied, so one event cannot unlock another in the same month.
 * The RNG is used only when the pool is not empty: one draw for "does
 * something happen", one more to pick.
 */
export function rollEvents(state: GameState, rng: Rng, events: readonly EventDef[] = EVENTS): EventDef[] {
  const age = Math.floor(state.ageInMonths / 12);
  const happened = happenedIndex(state);
  const eligible = ageIndex(events)[Math.min(age, MAX_INDEXED_AGE)]!.filter((event) => isEligible(event, state, happened));

  const result = eligible.filter((event) => event.frequency === 'guaranteed');
  const pool = eligible.filter((event) => event.frequency !== 'guaranteed');
  if (pool.length > 0 && rng.chance(monthlyPoolChance(age))) result.push(pickWeighted(pool, rng));
  return result;
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

  // Environment (D57): full effect at any age, clamped to 0–100, real change recorded.
  const environmentChanges: Partial<Record<EnvironmentKey, number>> = {};
  for (const [key, amount] of Object.entries(effects.environment ?? {}) as [EffectEnvironment, number][]) {
    const before = state.environment[key];
    state.environment[key] = clampStat(before + amount);
    const actual = state.environment[key] - before;
    if (actual !== 0) environmentChanges[key] = actual;
  }
  if (Object.keys(environmentChanges).length > 0) record.environmentChanges = environmentChanges;

  const habitChanges: Record<string, string> = {};
  const habitMonths: Partial<Record<HabitKey, number>> = {};
  for (const [habit, spec] of Object.entries(effects.habits ?? {}) as [HabitKey, HabitEffect<HabitKey>][]) {
    const level = typeof spec === 'string' ? spec : spec.level;
    const months = typeof spec === 'string' ? undefined : spec.months;
    if (!setHabitFromEvent(state, habit, level as Habits[typeof habit], months)) continue;
    habitChanges[habit] = level;
    if (months !== undefined) habitMonths[habit] = months;
  }
  if (Object.keys(habitChanges).length > 0) record.habitChanges = habitChanges as Partial<Habits>;
  if (Object.keys(habitMonths).length > 0) record.habitMonths = habitMonths;

  if (effects.residence) {
    const from = { ...state.residence };
    const to = {
      regionId: effects.residence.region ?? from.regionId,
      homeId: effects.residence.home ?? from.homeId,
    };
    if (to.regionId !== from.regionId || to.homeId !== from.homeId) {
      state.residence = to;
      record.residenceChange = { from, to };
    }
  }

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
