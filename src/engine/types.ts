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
  /** D65: speeds up the creative skill. */
  imagination: number;
}
export type TraitKey = keyof Traits;
/** Display and iteration order of the traits. */
export const TRAIT_KEYS = ['discipline', 'resilience', 'riskTaking', 'imagination'] as const satisfies readonly TraitKey[];

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
/** D69: smoking and drinking. Events start and end an addiction; nobody picks it. */
export const ADDICTION_LEVELS = ['none', 'addicted'] as const;
export type AddictionLevel = (typeof ADDICTION_LEVELS)[number];

export interface Habits {
  exercise: (typeof EXERCISE_LEVELS)[number];
  sleep: (typeof SLEEP_LEVELS)[number];
  overtime: (typeof OVERTIME_LEVELS)[number];
  smoking: AddictionLevel;
  drinking: AddictionLevel;
}
export type HabitKey = keyof Habits;

/** Every level of every habit, in order from worst to best where that applies. */
export const HABIT_LEVELS: { readonly [K in HabitKey]: readonly Habits[K][] } = {
  exercise: EXERCISE_LEVELS,
  sleep: SLEEP_LEVELS,
  overtime: OVERTIME_LEVELS,
  smoking: ADDICTION_LEVELS,
  drinking: ADDICTION_LEVELS,
};

/** D69: the habits that are an addiction (shown only while addicted). */
export const ADDICTION_HABITS = ['smoking', 'drinking'] as const satisfies readonly HabitKey[];

/**
 * D56: a lifestyle change that lasts a limited time. When the game month
 * reaches `untilMonth`, the habit goes back to `revertTo`.
 */
export type HabitTimers = { [K in HabitKey]?: { revertTo: Habits[K]; untilMonth: number } };

// ── Layer 4: Condition (0–100, stored as floats, rounded only for display) ──
export interface Condition {
  physicalHealth: number;
  mentalHealth: number;
}
export type ConditionKey = keyof Condition;

// ── Skills (D65): "knowledge" split in four, each sped up by one trait ──────
export const SKILL_KEYS = ['academic', 'creative', 'communication', 'practical'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export type Skills = Record<SkillKey, number>;

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
export type StatTarget = ConditionKey | SkillKey | 'looks';

// ── Regions (design doc section 12) ─────────────────────────────────────────
export const REGION_IDS = ['city', 'suburb', 'rural'] as const;
export type RegionId = (typeof REGION_IDS)[number];

/** Whose home the character lives in. Events change it (save version 7). */
export const HOME_IDS = ['parents', 'grandparents'] as const;
export type HomeId = (typeof HOME_IDS)[number];

/**
 * D66: the kind of school the child goes to from Grade 1. Stored as the flag
 * `school_<id>` (set by the school-start events), so events can test it
 * like any other flag; the engine reads it for the school's learning speed.
 * D70: 'top_public' (a selective public school) is only reached by passing
 * the entrance exam for Grade 7 (ม.1).
 * D74: 'vocational' is the vocational college (ปวช.); it counts as a school
 * so the school-age friend events still happen there.
 */
export const SCHOOL_IDS = ['international', 'private', 'top_public', 'scholarship', 'public', 'local', 'vocational'] as const;
export type SchoolId = (typeof SCHOOL_IDS)[number];
/** The flag of every school. A child is in one school at a time (the event validator enforces it). */
export const SCHOOL_FLAGS: readonly string[] = SCHOOL_IDS.map((id) => `school_${id}`);

/** Where the character lives NOW. The birth region is kept separately. */
export interface Residence {
  regionId: RegionId;
  homeId: HomeId;
}

// ── Log: "where did this change come from?" (design doc section 6) ─────────
/**
 * `source` is an i18n key suffix, e.g. 'habit.exercise.regular'.
 * Amounts for the current year are SUMMED per (target, source) as months
 * pass, so the log never grows beyond a few dozen numbers.
 */
export type YearLog = Partial<Record<StatTarget, Record<string, number>>>;

/**
 * Values at one moment of life (a birthday, or birth). Traits and environment
 * were added in save version 7, so years closed before that lack them.
 */
export interface LifeSnapshot extends Condition {
  looks: number;
  skills: Skills;
  traits?: Traits;
  environment?: Environment;
}

export interface YearSummary {
  /** Age in years when the summary was closed: a whole number on a birthday,
   *  a fraction for the final, partial year in which the character died. */
  age: number;
  changes: YearLog;
  /** Values at the end of the year (on the birthday), for the life summary chart and the year comparison. */
  snapshot: LifeSnapshot;
  /**
   * Habits in effect in each month of the year, in order (save version 4).
   * Missing for years played before version 4.
   */
  habits?: Habits[];
}

// ── Events ──────────────────────────────────────────────────────────────────
export interface EventRecord {
  id: string;
  /** Age when it happened. */
  ageInMonths: number;
  /** For events with choices: the choice the player made (D39). */
  choiceId?: string;
  /**
   * What the event REALLY did to traits, after the age factor and clamping.
   * Stored here because traits have no yearly log (the stat log covers
   * condition and looks only). Absent when no trait changed.
   */
  traitChanges?: Partial<Record<TraitKey, number>>;
  /** What the event REALLY did to the family environment (after clamping). */
  environmentChanges?: Partial<Record<EnvironmentKey, number>>;
  /** Habits the event switched to. Absent when no habit changed. */
  habitChanges?: Partial<Habits>;
  /** For temporary changes (D56): how many months each one lasts. */
  habitMonths?: Partial<Record<HabitKey, number>>;
  /** Where the character lived before and after, when the event moved them. */
  residenceChange?: { from: Residence; to: Residence };
  /** D72: who the event was about (save version 11). */
  person?: PersonRef;
}

/**
 * An event with choices that happened and waits for the player (D39).
 * While any is waiting, the month is paused right after its event step:
 * the death check and the birthday run only after the last choice.
 */
export interface PendingChoice {
  eventId: string;
  ageInMonths: number;
  /**
   * D72: who the event is about, chosen when it happened (the choice popup
   * already shows the name). A person met in this event is not in `people`
   * yet: they are kept only if the choice befriends them.
   */
  person?: Person;
}

// ── Death ───────────────────────────────────────────────────────────────────
export const DEATH_CAUSES = ['illness', 'oldAge', 'accident'] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

export interface Death {
  cause: DeathCause;
  ageInMonths: number;
}

// ── Sex (D71) ───────────────────────────────────────────────────────────────
/** Drawn at birth, 50:50. Picks which nickname list the name comes from. */
export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

// ── People (D72, phase 1: friends) ──────────────────────────────────────────
/**
 * What someone is to the character during one period. Phase 1 has friends
 * only; phase 2 adds partner and spouse to this list (18+).
 */
export const RELATIONS = ['friend', 'best_friend'] as const;
export type Relation = (typeof RELATIONS)[number];

/** Why a relationship ended. Phase 2 adds broke_up, divorced, died. */
export const END_REASONS = ['moved_away', 'changed_school', 'drifted_apart', 'fell_out', 'stepped_away', 'graduated', 'left_school'] as const;
export type EndReason = (typeof END_REASONS)[number];

/** From `from` (inclusive) until `to`, both in months of the character's age. `to` absent = still going. */
export interface RelationPeriod {
  relation: Relation;
  from: number;
  to?: number;
}

/**
 * Someone in the character's life (save version 11). Only facts are stored
 * (when they met, what they were to each other and when, why it ended); the
 * friends card and the life summary compute everything else from these.
 * Nobody is ever removed: a friendship that ended still counts as one the
 * character had.
 */
export interface Person {
  /** 1, 2, 3… unique within one life, never reused. */
  id: number;
  /** From the nickname lists; never the same as another person's or the character's. */
  nickname: string;
  sex: Sex;
  /** Their age minus the character's, in months (classmates: −11 to +11). */
  ageGapMonths: number;
  /** The event they met in, e.g. 'social_new_best_friend'. */
  metVia: string;
  /** Like flags, but about this person, e.g. 'far_away' (no longer in the same place). */
  tags: string[];
  /** In order, back to back, never overlapping. The last one has `to` once the relationship ended. */
  periods: RelationPeriod[];
  /** Set when the relationship ended. */
  endReason?: EndReason;
}

/** Who an event is about, as stored on records and waiting choices: the name stays even if the person was not kept. */
export interface PersonRef {
  nickname: string;
  /** The person's id in `people`; absent for someone the character did not befriend. */
  id?: number;
}

// ── Whole game state ────────────────────────────────────────────────────────
// ── Education (D74) ─────────────────────────────────────────────────────────
/** Programs in src/data/programs.json (ids from the design sheet's Education tab). */
export const PROGRAM_IDS = [
  'primary',
  'lower_secondary',
  'upper_secondary_science',
  'upper_secondary_arts_math',
  'upper_secondary_arts_lang',
  'vocational_electrical',
  'vocational_mechanical',
  'vocational_computer',
  'vocational_business',
  'non_formal',
] as const;
export type ProgramId = (typeof PROGRAM_IDS)[number];

/** How a program ended: finished it, moved to another program, or left before the end. */
export const ENROLLMENT_RESULTS = ['graduated', 'switched', 'left'] as const;
export type EnrollmentResult = (typeof ENROLLMENT_RESULTS)[number];

/** One program the character studied: from `from` until `to` (months of age); `to` absent = studying now. */
export interface Enrollment {
  program: ProgramId;
  from: number;
  /** Months carried over from the program of the same level it replaced (a switch of plan). */
  credit?: number;
  to?: number;
  result?: EnrollmentResult;
}

export interface Education {
  /** In order; at most the last one is still going on. */
  history: Enrollment[];
  /** Chosen and waiting: starts the month the current program ends (e.g. the Grade 10 plan chosen in Grade 9). */
  next?: ProgramId;
}

export interface GameState {
  /** The seed the life started from (shown to the player, used to replay). */
  seed: number;
  /** Current RNG state; advanced every time the engine draws a random number. */
  rngState: number;

  /** D71: drawn at birth (save version 10). */
  sex: Sex;
  /** D71: a Thai nickname only, from the list for the sex; no first or last name. */
  nickname: string;
  ageInMonths: number;
  /** Calendar month of birth, 1–12. Used later for seasonal events. */
  birthMonth: number;
  /** Region of the family home at birth. Never changes (save version 7). */
  birthRegionId: RegionId;
  /** Where the character lives now; events can move them (save version 7). */
  residence: Residence;
  /** Values at birth, for the year comparison. Missing in lives started before save version 7. */
  birthSnapshot?: LifeSnapshot;

  traits: Traits;
  environment: Environment;
  /** Changed only by events (D50); the player never picks them. */
  habits: Habits;
  /** Temporary lifestyle changes still running (save version 6). */
  habitTimers: HabitTimers;
  condition: Condition;
  /** D65: four skills instead of one knowledge value (save version 8). */
  skills: Skills;
  outcome: Outcome;
  /** Values the engine uses but the player never sees as numbers. */
  hidden: HiddenState;

  /** Things that have happened, e.g. 'graduated_high_school'. */
  flags: string[];
  /**
   * Every event that happened, in order (added in save version 3).
   * The single source for "once" checks, the yearly summary's
   * "what happened" list, and later the life summary.
   */
  eventHistory: EventRecord[];
  /**
   * Events with choices waiting for the player, oldest first (save version 5).
   * Empty almost always; non-empty only while the choice popup is open.
   */
  pendingChoices: PendingChoice[];

  /** Running totals for the current (unfinished) year. */
  yearLog: YearLog;
  /** Habits in effect in each month of the current year so far (save version 4). */
  yearHabits: Habits[];
  /** One entry per completed year of life. */
  history: YearSummary[];

  /** D72: everyone the character has had as a friend, including friendships that ended (save version 11). */
  people: Person[];

  /** D74: what the character studied and studies now (save version 12). */
  education: Education;

  death: Death | null;
}

/**
 * Why the engine stopped advancing and handed control back to the player.
 * 'choice': an event with choices happened; the month finishes after the player chooses.
 */
export type StopReason = 'yearEnd' | 'death' | 'choice';
