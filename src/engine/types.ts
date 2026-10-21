/**
 * Core game state types — the 5-layer character model from the design doc
 * (section 4), limited to the attributes in MVP scope (section 17).
 *
 * Rule: everything in GameState must be plain JSON data (no classes, Sets,
 * Maps, Dates or functions). That keeps save/load a simple JSON round trip.
 */

// ── Layer 1: Traits (0–100). Slow to change; act as MODIFIERS. ──────────────
export interface Traits {
  discipline: number;
  resilience: number;
  riskTaking: number;
}
export type TraitKey = keyof Traits;

// ── Layer 2: Environment (0–100). Changes when life changes. ────────────────
export interface Environment {
  familyWealth: number;
  familyWarmth: number;
  /** 0 while not working. Set by the career system (later increment). */
  workStress: number;
  /** Derived from debt and cash by the finance system (later increment). */
  financialStress: number;
}
export type EnvironmentKey = keyof Environment;

// ── Layer 3: Habits. Player sets them; they apply every month. ──────────────
export const EXERCISE_LEVELS = ['none', 'light', 'regular'] as const;
export const SLEEP_LEVELS = ['short', 'enough'] as const;
export const OVERTIME_LEVELS = ['none', 'some', 'heavy'] as const;

export interface Habits {
  exercise: (typeof EXERCISE_LEVELS)[number];
  sleep: (typeof SLEEP_LEVELS)[number];
  overtime: (typeof OVERTIME_LEVELS)[number];
}
export type HabitKey = keyof Habits;

// ── Layer 4: Condition (0–100, stored as floats, rounded only for display) ──
export interface Condition {
  physicalHealth: number;
  mentalHealth: number;
  knowledge: number;
}
export type ConditionKey = keyof Condition;

// ── Layer 5: Outcome ────────────────────────────────────────────────────────
// Wealth is NOT stored here: it is net worth, computed by the finance system.
export interface Outcome {
  looks: number;
  fame: number;
}
export type OutcomeKey = keyof Outcome;

// ── Hidden state (added in save version 2) ──────────────────────────────────
export interface HiddenState {
  /** Accumulated long-term physical damage, 0–100. Lowers the health set point. */
  physicalWear: number;
}

/** Attributes that monthly contributions may change. */
export type StatTarget = ConditionKey | 'looks';

// ── Regions (design doc section 12) ─────────────────────────────────────────
export const REGION_IDS = ['city', 'suburb', 'rural'] as const;
export type RegionId = (typeof REGION_IDS)[number];

// ── Log: "where did this change come from?" (design doc section 6) ─────────
/**
 * `source` is an i18n key suffix, e.g. 'habit.exercise.regular'.
 * Amounts for the current year are SUMMED per (target, source) as months
 * pass, so the log never grows beyond a few dozen numbers.
 */
export type YearLog = Partial<Record<StatTarget, Record<string, number>>>;

export interface YearSummary {
  /** Age in years when the summary was closed: a whole number on a birthday,
   *  a fraction for the final, partial year in which the character died. */
  age: number;
  changes: YearLog;
  /** Values at the end of the year, for the life summary chart. */
  snapshot: Condition & { looks: number };
}

// ── Death ───────────────────────────────────────────────────────────────────
export const DEATH_CAUSES = ['illness', 'oldAge', 'accident'] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

export interface Death {
  cause: DeathCause;
  ageInMonths: number;
}

// ── Whole game state ────────────────────────────────────────────────────────
export interface GameState {
  /** The seed the life started from (shown to the player, used to replay). */
  seed: number;
  /** Current RNG state; advanced every time the engine draws a random number. */
  rngState: number;

  name: { first: string; last: string };
  ageInMonths: number;
  /** Calendar month of birth, 1–12. Used later for seasonal events. */
  birthMonth: number;
  regionId: RegionId;

  traits: Traits;
  environment: Environment;
  habits: Habits;
  condition: Condition;
  outcome: Outcome;
  /** Values the engine uses but the player never sees as numbers. */
  hidden: HiddenState;

  /** Things that have happened, e.g. 'graduated_high_school'. */
  flags: string[];

  /** Running totals for the current (unfinished) year. */
  yearLog: YearLog;
  /** One entry per completed year of life. */
  history: YearSummary[];

  death: Death | null;
}

/** Why the engine stopped advancing and handed control back to the player. */
export type StopReason = 'yearEnd' | 'death';
