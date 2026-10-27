/**
 * Event system (design doc section 8).
 *
 * Two kinds of events, both DATA in src/data/events.json:
 * - without choices: `effects` are applied as soon as the event happens;
 * - with choices (D39): the event waits for the player, then the chosen
 *   choice's `effects` are applied. Choices whose conditions are not met are
 *   still shown, disabled, with the reason.
 *
 * Which events happen (D67, D68):
 * - 'guaranteed': in the first month its conditions are met;
 * - 'window': once, in a random month of its age range (everyone goes
 *   through it, at their own time: first word, first club);
 * - the other frequency words are a CHANCE PER YEAR while the conditions are
 *   met. Each event rolls on its own, so adding events never makes the
 *   others rarer or more common. Values named in `chanceBy` (a trait, family
 *   wealth...) make an event more or less likely (D68).
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
import { applyEducationEffect, meetsEducationConditions, type EducationConditions, type EducationEffect } from './education';
import { setHabitFromEvent } from './lifestyle';
import {
  applyFriendsEffects,
  applyPersonEffect,
  bestFriend,
  FRIEND_GROUPS,
  meetSomeone,
  meetsPeopleConditions,
  type FriendsEffect,
  type PeopleConditions,
  type PersonEffect,
} from './people';
import { createRng, type Rng } from './rng';
import { applyContributions, clampStat, type Contribution } from './stats';
import {
  END_REASONS,
  HABIT_LEVELS,
  HOME_IDS,
  PROGRAM_IDS,
  REGION_IDS,
  RELATIONS,
  SCHOOL_FLAGS,
  type EnvironmentKey,
  type EventRecord,
  type GameState,
  type HabitKey,
  type Habits,
  type HomeId,
  type Person,
  type RegionId,
  type StatTarget,
  type TraitKey,
} from './types';

// ── Data types ──────────────────────────────────────────────────────────────

export const FREQUENCIES = ['guaranteed', 'window', 'rare', 'uncommon', 'normal', 'common'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
/** D67: the frequencies that are a chance per year (the others are certain). */
export const CHANCE_FREQUENCIES = ['rare', 'uncommon', 'normal', 'common'] as const;
export type ChanceFrequency = (typeof CHANCE_FREQUENCIES)[number];

/** Values a condition may test. */
export const CONDITION_STATS = [
  'physicalHealth', 'mentalHealth', 'looks', 'fame',
  'academic', 'creative', 'communication', 'practical',
  'discipline', 'resilience', 'riskTaking', 'imagination',
  'familyWealth', 'familyWarmth', 'workStress', 'financialStress',
] as const;
export type ConditionStat = (typeof CONDITION_STATS)[number];

/** Stats an effect may change: the ones the yearly log handles. */
export const EFFECT_STATS = [
  'physicalHealth', 'mentalHealth', 'looks',
  'academic', 'creative', 'communication', 'practical',
] as const satisfies readonly StatTarget[];
export type EffectStat = (typeof EFFECT_STATS)[number];

/** Traits an effect may change (D41: halved from age 15). */
export const EFFECT_TRAITS = ['discipline', 'resilience', 'riskTaking', 'imagination'] as const satisfies readonly TraitKey[];

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
  /** Every one of these flags. */
  flagsAll?: string[];
  /** At least one of these flags, e.g. "goes to any school" or "goes to a school that charges fees". */
  flagsAny?: string[];
  /** None of these flags. */
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
  /**
   * Only at least `min` months after the most recent of these events, and
   * never before any of them happened. E.g. a new job at least 6 months
   * after losing one: { events: ['family_parent_lost_job'], min: 6 }.
   */
  monthsSince?: { events: string[]; min: number };
  /**
   * Not within `months` months after any of these events. Passes when none
   * of them ever happened. Keeps big life changes apart, e.g. no move to the
   * grandparents a month after the family moved house.
   */
  notWithin?: { events: string[]; months: number };
  /**
   * None of these events ever happened. Keeps the versions of one moment
   * apart (D61), e.g. the first-term results: once a child got "top of the
   * class", a later "behind" must not happen too, even if the grades change.
   */
  eventsNone?: string[];
  /**
   * Where the character lives right now. Each field given must match one of
   * its values, e.g. { regions: ['city', 'suburb'] } = "not in the countryside".
   */
  residence?: { regions?: RegionId[]; homes?: HomeId[] };
  /** D72: the character's friends; tags are about the person the event is about. */
  people?: PeopleConditions;
  /** D74: what the character studies or has finished. */
  education?: EducationConditions;
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
  /** D72: what happens to the person the event is about (needs `about`). */
  person?: PersonEffect;
  /** D72: what happens to a group of friends, e.g. everyone after Grade 12. */
  friends?: FriendsEffect[];
  /** D74: start, choose or leave a program. */
  education?: EducationEffect;
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
/**
 * D72: who an event is about. 'best_friend': the current best friend (no
 * best friend = the event cannot happen). 'new_person': someone met in the
 * event, kept only if it befriends them. Texts name them with {name}.
 */
export const ABOUT = ['best_friend', 'new_person'] as const;
export type About = (typeof ABOUT)[number];

export interface EventDef {
  id: string;
  about?: About;
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
  /**
   * D68: values that make this event more (or less) likely, e.g. being
   * bullied is more likely the LOWER the risk-taking:
   * [{ "stat": "riskTaking", "toward": "low" }]. Only for chance frequencies.
   */
  chanceBy?: ChanceBy[];
  effects?: EventEffects;
  choices?: EventChoice[];
}

export interface ChanceBy {
  stat: ConditionStat;
  /** 'high' = the higher the value, the likelier the event; 'low' = the lower. */
  toward: 'high' | 'low';
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
  /** D72: person tags, checked like flags. */
  tagsSet: Set<string>;
  tagsTested: { at: string; tag: string }[];
}

/** stats / flagsAll / flagsAny / flagsNone / habits: shared by event conditions and choice conditions. */
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
  for (const key of ['flagsAll', 'flagsAny', 'flagsNone'] as const) {
    const list = c[key];
    if (list === undefined) continue;
    if (!isStringArray(list)) check.problems.push(`${at}: ${key} must be a list of flag names`);
    // An empty "at least one of" can never be met: the event or choice would be dead.
    else if (key === 'flagsAny' && list.length === 0) check.problems.push(`${at}: flagsAny must name at least one flag`);
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
  for (const key of unknownKeys(e, ['stats', 'traits', 'environment', 'habits', 'residence', 'setFlags', 'removeFlags', 'person', 'friends', 'education'])) {
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
  if (e.person !== undefined) checkPersonEffect(e.person, at, check);
  if (e.friends !== undefined) checkFriendsEffects(e.friends, at, check);
  if (e.education !== undefined) checkEducationEffect(e.education, at, problems);
  // D70: a child is in one school at a time, so putting them in a school must
  // take them out of every other one (even at Grade 1, when there is none yet:
  // one rule for every event is easier to trust than a list of exceptions).
  const removed = isStringArray(e.removeFlags) ? e.removeFlags : [];
  for (const school of (isStringArray(e.setFlags) ? e.setFlags : []).filter((flag) => SCHOOL_FLAGS.includes(flag))) {
    const kept = SCHOOL_FLAGS.filter((other) => other !== school && !removed.includes(other));
    if (kept.length > 0) problems.push(`${at}: sets "${school}" but does not remove ${kept.join(', ')} (a child is in one school at a time)`);
  }
}

function isTag(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** D72: { befriend?, become?, end?, tag?, untag? }. Which ones fit the event's `about` is checked per event. */
function checkPersonEffect(effect: unknown, at: string, check: Checker): void {
  const { problems } = check;
  if (!isRecord(effect) || Object.keys(effect).length === 0) {
    problems.push(`${at}: effects.person must be an object with at least one of befriend, become, end, tag, untag`);
    return;
  }
  for (const key of unknownKeys(effect, ['befriend', 'become', 'end', 'tag', 'untag'])) problems.push(`${at}: person: unknown field "${key}"`);
  for (const key of ['befriend', 'become'] as const) {
    if (effect[key] !== undefined && !(RELATIONS as readonly unknown[]).includes(effect[key])) {
      problems.push(`${at}: person.${key} must be one of ${RELATIONS.join(', ')}`);
    }
  }
  if (effect.end !== undefined && !(END_REASONS as readonly unknown[]).includes(effect.end)) {
    problems.push(`${at}: person.end must be one of ${END_REASONS.join(', ')}`);
  }
  for (const key of ['tag', 'untag'] as const) {
    if (effect[key] === undefined) continue;
    if (!isTag(effect[key])) problems.push(`${at}: person.${key} must be a tag name (lowercase letters, digits and _)`);
    else if (key === 'tag') check.tagsSet.add(effect[key]);
  }
}

/** D72: [{ who, end?, tag? }]: each entry changes a group of friends. */
function checkFriendsEffects(list: unknown, at: string, check: Checker): void {
  const { problems } = check;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${at}: effects.friends must be a non-empty list of { "who", "end"?, "tag"? }`);
    return;
  }
  for (const entry of list) {
    if (!isRecord(entry) || !(FRIEND_GROUPS as readonly unknown[]).includes(entry.who) || (entry.end === undefined && entry.tag === undefined)) {
      problems.push(`${at}: friends: each entry needs "who" (${FRIEND_GROUPS.join(', ')}) and an "end" or a "tag": ${JSON.stringify(entry)}`);
      continue;
    }
    for (const key of unknownKeys(entry, ['who', 'end', 'tag'])) problems.push(`${at}: friends: unknown field "${key}"`);
    if (entry.end !== undefined && !(END_REASONS as readonly unknown[]).includes(entry.end)) {
      problems.push(`${at}: friends: end must be one of ${END_REASONS.join(', ')}`);
    }
    if (entry.tag !== undefined) {
      if (!isTag(entry.tag)) problems.push(`${at}: friends: tag must be a tag name (lowercase letters, digits and _)`);
      else check.tagsSet.add(entry.tag);
    }
  }
}

const isProgramId = (value: unknown): boolean => (PROGRAM_IDS as readonly unknown[]).includes(value);
const isProgramList = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(isProgramId);

/** D74: { enroll?, next?, leave? }. */
function checkEducationEffect(effect: unknown, at: string, problems: string[]): void {
  if (!isRecord(effect) || Object.keys(effect).length === 0) {
    problems.push(`${at}: effects.education must have at least one of enroll, next, leave`);
    return;
  }
  for (const key of unknownKeys(effect, ['enroll', 'next', 'leave'])) problems.push(`${at}: effects.education: unknown field "${key}"`);
  for (const key of ['enroll', 'next'] as const) {
    if (effect[key] !== undefined && !isProgramId(effect[key])) problems.push(`${at}: effects.education.${key} must be one of ${PROGRAM_IDS.join(', ')}`);
  }
  if (effect.leave !== undefined && effect.leave !== true) problems.push(`${at}: effects.education.leave must be true`);
}

/** D74: { enrolled?, current?, monthsIn?, completed?, notCompleted? }. */
function checkEducationCondition(c: unknown, at: string, problems: string[]): void {
  if (!isRecord(c) || Object.keys(c).length === 0) {
    problems.push(`${at}: conditions.education must have at least one of enrolled, current, monthsIn, completed, notCompleted`);
    return;
  }
  for (const key of unknownKeys(c, ['enrolled', 'current', 'monthsIn', 'completed', 'notCompleted'])) problems.push(`${at}: conditions.education: unknown field "${key}"`);
  if (c.enrolled !== undefined && typeof c.enrolled !== 'boolean') problems.push(`${at}: conditions.education.enrolled must be true or false`);
  for (const key of ['current', 'completed', 'notCompleted'] as const) {
    if (c[key] !== undefined && !isProgramList(c[key])) problems.push(`${at}: conditions.education.${key} must be a non-empty list of program ids`);
  }
  if (c.monthsIn !== undefined) {
    const range = c.monthsIn;
    const whole = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0);
    if (!isRecord(range) || (range.min === undefined && range.max === undefined) || !whole(range.min) || !whole(range.max)) {
      problems.push(`${at}: conditions.education.monthsIn must be { "min"?, "max"? } in whole months from 0`);
    } else if (range.min !== undefined && range.max !== undefined && (range.min as number) > (range.max as number)) {
      problems.push(`${at}: conditions.education.monthsIn: min is above max`);
    }
    if (c.enrolled === false) problems.push(`${at}: conditions.education.monthsIn needs a program, so it cannot go with enrolled: false`);
  }
}

/** D72: { bestFriend?, friendsMin?, tagsAll?, tagsNone? }. */
function checkPeopleCondition(people: unknown, about: unknown, at: string, check: Checker): void {
  const { problems } = check;
  if (!isRecord(people) || Object.keys(people).length === 0) {
    problems.push(`${at}: conditions.people must have at least one of bestFriend, friendsMin, tagsAll, tagsNone`);
    return;
  }
  for (const key of unknownKeys(people, ['bestFriend', 'friendsMin', 'tagsAll', 'tagsNone'])) problems.push(`${at}: conditions.people: unknown field "${key}"`);
  if (people.bestFriend !== undefined && typeof people.bestFriend !== 'boolean') problems.push(`${at}: conditions.people.bestFriend must be true or false`);
  if (people.bestFriend === false && about === 'best_friend') {
    problems.push(`${at}: an event about the best friend cannot require having no best friend`);
  }
  if (people.friendsMin !== undefined && !isPositiveInteger(people.friendsMin)) problems.push(`${at}: conditions.people.friendsMin must be a whole number above 0`);
  for (const key of ['tagsAll', 'tagsNone'] as const) {
    const list = people[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length === 0 || !list.every(isTag)) problems.push(`${at}: conditions.people.${key} must be a non-empty list of tag names`);
    else list.forEach((tag) => check.tagsTested.push({ at, tag }));
    // Tags belong to a person: only an event about someone already known can test them.
    if (about !== 'best_friend') problems.push(`${at}: conditions.people.${key} tests the person the event is about, so it needs "about": "best_friend"`);
  }
}

/**
 * D72: person effects must fit `about`. Someone new can only be befriended
 * (then tagged); the best friend can change, end or be tagged, but not be
 * befriended again. An event about someone new that never befriends them
 * would make a person nobody can see: almost certainly a mistake.
 */
function checkAbout(item: Record<string, unknown>, at: string, problems: string[]): void {
  const about = item.about;
  const all = [item.effects, ...(Array.isArray(item.choices) ? item.choices.map((c: unknown) => (isRecord(c) ? c.effects : undefined)) : [])];
  const personEffects = all.flatMap((effects) => (isRecord(effects) && isRecord(effects.person) ? [effects.person] : []));
  if (about === undefined) {
    if (personEffects.length > 0) problems.push(`${at}: effects.person needs "about" (who the event is about)`);
    return;
  }
  if (!(ABOUT as readonly unknown[]).includes(about)) {
    problems.push(`${at}: about must be one of ${ABOUT.join(', ')}`);
    return;
  }
  for (const effect of personEffects) {
    if (about === 'best_friend' && effect.befriend !== undefined) {
      problems.push(`${at}: the best friend is already a friend: use "become", not "befriend"`);
    }
    if (about === 'new_person' && effect.befriend === undefined && Object.keys(effect).length > 0) {
      problems.push(`${at}: someone new who is not befriended is not kept, so ${Object.keys(effect).join(', ')} would do nothing: add "befriend"`);
    }
  }
  if (about === 'new_person' && !personEffects.some((effect) => effect.befriend !== undefined)) {
    problems.push(`${at}: an event about someone new must befriend them in its effects or in at least one choice`);
  }
}

/** { regions?: [...], homes?: [...] }: at least one field, each a non-empty list of known ids. */
function checkResidenceCondition(residence: unknown, at: string, problems: string[]): void {
  if (!isRecord(residence)) {
    problems.push(`${at}: conditions.residence must list regions, homes, or both`);
    return;
  }
  for (const key of unknownKeys(residence, ['regions', 'homes'])) problems.push(`${at}: conditions.residence: unknown field "${key}"`);
  if (residence.regions === undefined && residence.homes === undefined) {
    problems.push(`${at}: conditions.residence must list regions, homes, or both`);
  }
  for (const [field, known] of [
    ['regions', REGION_IDS],
    ['homes', HOME_IDS],
  ] as const) {
    const list = residence[field];
    if (list === undefined) continue;
    if (!isStringArray(list) || list.length === 0) {
      problems.push(`${at}: conditions.residence.${field} must be a non-empty list`);
      continue;
    }
    for (const id of list) {
      if (!(known as readonly string[]).includes(id)) problems.push(`${at}: conditions.residence: unknown ${field === 'regions' ? 'region' : 'home'} "${id}"`);
    }
  }
}

/** Every effect amount an event can have on one value, from its effects or any of its choices. */
function effectAmounts(item: Record<string, unknown>, stat: string): number[] {
  const all = [item.effects, ...(Array.isArray(item.choices) ? item.choices.map((c: unknown) => (isRecord(c) ? c.effects : undefined)) : [])];
  const amounts: number[] = [];
  for (const effects of all) {
    if (!isRecord(effects)) continue;
    for (const field of ['stats', 'traits', 'environment'] as const) {
      const changes = effects[field];
      if (isRecord(changes) && typeof changes[stat] === 'number') amounts.push(changes[stat]);
    }
  }
  return amounts;
}

/**
 * D68: chanceBy is a list of { stat, toward }, only on chance frequencies.
 * A REPEATABLE event must not push its own chanceBy value further the same
 * way (e.g. "likelier with high risk-taking" and "+risk-taking"): each time
 * it happened it would become likelier still, until the value hits 0 or 100.
 */
function checkChanceBy(item: Record<string, unknown>, at: string, problems: string[]): void {
  const list = item.chanceBy;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${at}: chanceBy must be a non-empty list of { "stat", "toward": "high" | "low" }`);
    return;
  }
  if (!(CHANCE_FREQUENCIES as readonly unknown[]).includes(item.frequency)) {
    problems.push(`${at}: chanceBy only works with a chance frequency (${CHANCE_FREQUENCIES.join(', ')}), not "${String(item.frequency)}"`);
  }
  for (const by of list) {
    if (!isRecord(by) || !CONDITION_STATS.includes(by.stat as ConditionStat) || (by.toward !== 'high' && by.toward !== 'low')) {
      problems.push(`${at}: invalid chanceBy ${JSON.stringify(by)}`);
      continue;
    }
    for (const key of unknownKeys(by, ['stat', 'toward'])) problems.push(`${at}: chanceBy: unknown field "${key}"`);
    if (item.once === true) continue;
    const sameWay = effectAmounts(item, by.stat as string).some((amount) => (by.toward === 'high' ? amount > 0 : amount < 0));
    if (sameWay) {
      problems.push(`${at}: repeatable event made likelier by ${by.toward} ${String(by.stat)} must not push ${String(by.stat)} further ${by.toward === 'high' ? 'up' : 'down'} (it would feed itself)`);
    }
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
      for (const key of unknownKeys(choice.conditions, ['stats', 'flagsAll', 'flagsAny', 'flagsNone', 'habits'])) {
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
  const check: Checker = { problems: [], flagsSet: new Set<string>(SYSTEM_FLAGS), flagsTested: [], tagsSet: new Set<string>(), tagsTested: [] };
  const { problems } = check;
  const ids = new Set<string>();
  const eventsReferenced: { at: string; eventId: string; field: string }[] = [];

  raw.forEach((item: unknown, index) => {
    const where = `event #${index}`;
    if (!isRecord(item)) {
      problems.push(`${where}: must be an object`);
      return;
    }
    const id = typeof item.id === 'string' ? item.id : '';
    const at = id ? `event "${id}"` : where;

    for (const key of unknownKeys(item, ['id', 'about', 'conditions', 'frequency', 'once', 'cooldownMonths', 'lifetimeChance', 'chanceBy', 'effects', 'choices'])) {
      problems.push(`${at}: unknown field "${key}"`);
    }
    if (!ID_PATTERN.test(id)) problems.push(`${at}: id must be lowercase letters, digits and _`);
    if (ids.has(id)) problems.push(`${at}: duplicate id`);
    ids.add(id);

    if (!FREQUENCIES.includes(item.frequency as Frequency)) {
      problems.push(`${at}: frequency must be one of ${FREQUENCIES.join(', ')}`);
    }
    if (typeof item.once !== 'boolean') problems.push(`${at}: once must be true or false`);
    // A repeatable guaranteed event needs a cooldown, or it would happen every month
    // (e.g. the end of a 3-month try at a new habit, which can be tried again later).
    if (item.frequency === 'guaranteed' && item.once !== true && item.cooldownMonths === undefined) {
      problems.push(`${at}: a guaranteed event must be once, or repeatable with cooldownMonths (otherwise it happens every month)`);
    }
    if (item.frequency === 'window') {
      if (item.once !== true) problems.push(`${at}: a window event must be once (it happens exactly once in its age range)`);
      if (isRecord(item.conditions) && item.conditions.months !== undefined) {
        problems.push(`${at}: a window event cannot be limited to months (it picks its own month in the age range)`);
      }
    }
    if (item.chanceBy !== undefined) checkChanceBy(item, at, problems);
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
      for (const key of unknownKeys(c, [
        'ageMin', 'ageMax', 'stats', 'flagsAll', 'flagsAny', 'flagsNone', 'habits', 'months', 'monthsSince', 'notWithin', 'eventsNone',
        'residence', 'people', 'education',
      ])) {
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
      if (c.monthsSince !== undefined) {
        const since = c.monthsSince;
        if (!isRecord(since) || !isStringArray(since.events) || since.events.length === 0 || !isPositiveInteger(since.min)) {
          problems.push(`${at}: monthsSince must be { "events": [event ids], "min": whole number of months above 0 }`);
        } else {
          for (const key of unknownKeys(since, ['events', 'min'])) problems.push(`${at}: monthsSince: unknown field "${key}"`);
          since.events.forEach((eventId) => eventsReferenced.push({ at, eventId, field: 'monthsSince' }));
        }
      }
      if (c.notWithin !== undefined) {
        const apart = c.notWithin;
        if (!isRecord(apart) || !isStringArray(apart.events) || apart.events.length === 0 || !isPositiveInteger(apart.months)) {
          problems.push(`${at}: notWithin must be { "events": [event ids], "months": whole number of months above 0 }`);
        } else {
          for (const key of unknownKeys(apart, ['events', 'months'])) problems.push(`${at}: notWithin: unknown field "${key}"`);
          apart.events.forEach((eventId) => eventsReferenced.push({ at, eventId, field: 'notWithin' }));
        }
      }
      if (c.eventsNone !== undefined) {
        if (!isStringArray(c.eventsNone) || c.eventsNone.length === 0) problems.push(`${at}: eventsNone must be a non-empty list of event ids`);
        else c.eventsNone.forEach((eventId) => eventsReferenced.push({ at, eventId, field: 'eventsNone' }));
      }
      if (c.residence !== undefined) checkResidenceCondition(c.residence, at, problems);
      if (c.people !== undefined) checkPeopleCondition(c.people, item.about, at, check);
      if (c.education !== undefined) checkEducationCondition(c.education, at, problems);
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
    checkAbout(item, at, problems);
  });

  // Naming an event that does not exist: almost certainly a typo (monthsSince would block forever, notWithin never).
  for (const { at, eventId, field } of eventsReferenced) {
    if (!ids.has(eventId)) problems.push(`${at}: ${field} names event "${eventId}", which does not exist`);
  }
  // A condition on a flag that nothing ever sets can never be true (or is always true): almost certainly a typo.
  for (const { at, flag } of check.flagsTested) {
    if (!check.flagsSet.has(flag)) problems.push(`${at}: tests flag "${flag}", but no event or system ever sets it`);
  }
  for (const { at, tag } of check.tagsTested) {
    if (!check.tagsSet.has(tag)) problems.push(`${at}: tests person tag "${tag}", but no event ever sets it`);
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
      return state.condition[stat];
    case 'academic':
    case 'creative':
    case 'communication':
    case 'practical':
      return state.skills[stat];
    case 'looks':
    case 'fame':
      return state.outcome[stat];
    case 'discipline':
    case 'resilience':
    case 'riskTaking':
    case 'imagination':
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
  if (c.flagsAny && !c.flagsAny.some((flag) => state.flags.includes(flag))) return false;
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
  if (c.monthsSince) {
    const times = c.monthsSince.events.flatMap((id) => happened.get(id) ?? []);
    if (times.length === 0 || state.ageInMonths - Math.max(...times) < c.monthsSince.min) return false;
  }
  if (c.notWithin) {
    const times = c.notWithin.events.flatMap((id) => happened.get(id) ?? []);
    if (times.length > 0 && state.ageInMonths - Math.max(...times) < c.notWithin.months) return false;
  }
  if (c.eventsNone && c.eventsNone.some((id) => happened.has(id))) return false;
  if (c.residence) {
    if (c.residence.regions && !c.residence.regions.includes(state.residence.regionId)) return false;
    if (c.residence.homes && !c.residence.homes.includes(state.residence.homeId)) return false;
  }
  if (event.lifetimeChance !== undefined && lifetimeRoll(state.seed, event.id) >= event.lifetimeChance) return false;
  // D72: an event about the best friend needs one.
  const about = event.about === 'best_friend' ? bestFriend(state) : undefined;
  if (event.about === 'best_friend' && about === undefined) return false;
  if (c.people && !meetsPeopleConditions(state, c.people, about)) return false;
  if (c.education && !meetsEducationConditions(state, c.education)) return false;
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
    (c.flagsAny === undefined || c.flagsAny.some((flag) => state.flags.includes(flag))) &&
    !(c.flagsNone ?? []).some((flag) => state.flags.includes(flag));
  if (!flagsOk) reasons.push({ kind: 'flag' });
  return reasons;
}

// ── Selection: guaranteed, window and chance events (D67, D68) ──────────────

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

/** D68: how much the event's chanceBy values multiply its chance (1 = unchanged). */
export function chanceFactor(event: EventDef, state: GameState): number {
  const max = BALANCE.events.chanceByMaxFactor;
  let factor = 1;
  for (const by of event.chanceBy ?? []) {
    const value = readConditionStat(state, by.stat);
    const direction = by.toward === 'high' ? 1 : -1;
    factor *= max ** ((direction * (value - 50)) / 50);
  }
  return factor;
}

/** D67 + D68: the chance per year of a chance-frequency event for this character now. */
export function yearlyChance(event: EventDef, state: GameState): number {
  const base = BALANCE.events.chancePerYear[event.frequency as ChanceFrequency];
  return Math.min(BALANCE.events.maxYearlyChance, base * chanceFactor(event, state));
}

/**
 * D67: the chance in ONE eligible month, so that a whole year of eligible
 * months adds up to the yearly chance: 1 − (1 − yearly)^(1 / months).
 * An event limited to some calendar months spreads its yearly chance over
 * those months only (a trip in April: the whole yearly chance in April).
 */
export function monthlyChance(event: EventDef, state: GameState): number {
  const monthsPerYear = event.conditions.months?.length ?? 12;
  return 1 - (1 - yearlyChance(event, state)) ** (1 / monthsPerYear);
}

/**
 * D67: a window event happens exactly once in its age range, in a random
 * month: each eligible month its chance is 1 / (months left in the range),
 * so every month is equally likely and the last month is certain.
 */
export function windowChance(event: EventDef, state: Pick<GameState, 'ageInMonths'>): number {
  const monthsLeft = (event.conditions.ageMax + 1) * 12 - state.ageInMonths;
  return 1 / Math.max(1, monthsLeft);
}

/**
 * Which events happen this month: every eligible guaranteed event, the window
 * events whose month it is, and at most `maxChanceEventsPerMonth` chance
 * events (when more roll a hit, a random one of them; the others simply did
 * not happen this month). Eligibility is checked for all events BEFORE any is
 * applied, so one event cannot unlock another in the same month.
 * RNG draws, in file order: one per eligible window and chance event, then
 * one per chance hit above the monthly limit (to drop a random one).
 */
export function rollEvents(state: GameState, rng: Rng, events: readonly EventDef[] = EVENTS): EventDef[] {
  const age = Math.floor(state.ageInMonths / 12);
  const happened = happenedIndex(state);
  const eligible = ageIndex(events)[Math.min(age, MAX_INDEXED_AGE)]!.filter((event) => isEligible(event, state, happened));

  const result: EventDef[] = [];
  const hits: EventDef[] = [];
  for (const event of eligible) {
    if (event.frequency === 'guaranteed') result.push(event);
    else if (event.frequency === 'window') {
      if (rng.chance(windowChance(event, state))) result.push(event);
    } else if (rng.chance(monthlyChance(event, state))) hits.push(event);
  }
  const max = BALANCE.events.maxChanceEventsPerMonth;
  while (hits.length > max) hits.splice(Math.floor(rng.next() * hits.length), 1);
  return [...result, ...hits];
}

// ── Who an event is about (D72) ─────────────────────────────────────────────

/**
 * The person an event that just happened is about: a copy of the best
 * friend, or someone new (3 RNG draws). Undefined for events about nobody.
 * A copy, so a choice that waits keeps the name it was shown with.
 */
export function personFor(event: EventDef, state: GameState, rng: Rng): Person | undefined {
  if (event.about === 'best_friend') {
    const current = bestFriend(state);
    return current === undefined ? undefined : structuredClone(current);
  }
  if (event.about === 'new_person') return meetSomeone(state, rng, event.id);
  return undefined;
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
function applyEffects(
  state: GameState,
  eventId: string,
  effects: EventEffects,
  ageInMonths: number,
  choiceId?: string,
  person?: Person,
): void {
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
  // D72: the group first, then the person the event is about (a best friend
  // kept at Grade 12 must not be ended by "everyone else goes their own way").
  if (effects.friends) applyFriendsEffects(state, effects.friends, ageInMonths);
  if (person !== undefined) record.person = applyPersonEffect(state, person, effects.person ?? {}, ageInMonths);
  if (effects.education) applyEducationEffect(state, effects.education, ageInMonths);
  state.eventHistory.push(record);
}

/** Applies an event WITHOUT choices and records it. `person`: who it is about (see personFor). MUTATES `state`. */
export function applyEvent(state: GameState, event: EventDef, person?: Person): void {
  if (hasChoices(event)) throw new Error(`Event "${event.id}" has choices; it must wait for the player`);
  applyEffects(state, event.id, event.effects ?? {}, state.ageInMonths, undefined, person);
}

/**
 * Applies the player's choice for an event that was waiting, and records it
 * with the age at which the event HAPPENED. MUTATES `state`.
 * Throws for an unknown or locked choice: the UI must never offer those.
 */
export function applyChoice(state: GameState, event: EventDef, choiceId: string, ageInMonths: number, person?: Person): void {
  const choice = event.choices?.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`Event "${event.id}" has no choice "${choiceId}"`);
  if (lockReasons(choice, state).length > 0) throw new Error(`Choice "${choiceId}" of "${event.id}" is locked`);
  applyEffects(state, event.id, choice.effects, ageInMonths, choiceId, person);
}
