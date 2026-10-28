/**
 * Balance values: every tuning number of the passive simulation lives here,
 * not inside engine logic. The engine reads them; tests and the Monte Carlo
 * simulation tell us whether they produce believable lives.
 *
 * All "per year" values are converted to per month by the engine (÷ 12),
 * because designers think in years but the engine ticks monthly.
 *
 * These are FIRST-GUESS values (design doc section 18: balance is tuned
 * during testing). Change numbers here, then run `npm test` to see the effect.
 */

import type { Habits, RegionId, SchoolId, SkillKey, Skills, TraitKey } from '../engine/types';

export const BALANCE = {
  birth: {
    /** Traits/environment start as the average of two uniform draws in this
     *  range → most people near the middle, few at the extremes. */
    attributeMin: 10,
    attributeMax: 90,
    physicalHealth: { min: 70, max: 95 },
    mentalHealth: { min: 60, max: 90 },
    looks: { min: 10, max: 90 },
    habits: { exercise: 'light', sleep: 'enough', overtime: 'none', smoking: 'none', drinking: 'none' } satisfies Habits,
    /**
     * D76: where the family lives depends on how well off it is. The first
     * band whose `wealthBelow` is above the family wealth applies; the last
     * band has no upper limit. Weights are percentages (each band sums to 100).
     */
    birthRegionByWealth: [
      { wealthBelow: 35, weights: { city: 20, suburb: 30, rural: 50 } },
      { wealthBelow: 65, weights: { city: 30, suburb: 40, rural: 30 } },
      { wealthBelow: Infinity, weights: { city: 55, suburb: 35, rural: 10 } },
    ] satisfies readonly { wealthBelow: number; weights: Record<RegionId, number> }[],
  },

  earlyChildhood: {
    /**
     * Design decisions (D35, D50, D51):
     * - At Grade 1 (ป.1, age 6) the child gets a lifestyle of their own and
     *   gets to know their own traits. The player never picks the lifestyle:
     *   it starts from the family (below) and changes only through events.
     * - Before that, the family decides:
     *   - movement: none for babies; from `playFromAge`, normal play ('light' exercise values)
     *   - sleep: depends on the family environment (Family warmth), from birth
     */
    ownLifestyleFromAge: 6,
    playFromAge: 2,
    /**
     * Sleep effect = interpolate from the 'short' to the 'enough' sleep values.
     * Family warmth 0 → 'short'; at or above this value → 'enough'.
     * An average family (50) is assumed to look after a young child's sleep well.
     */
    familyWarmthForEnoughSleep: 50,
    /**
     * D51: the lifestyle the child starts with at `ownLifestyleFromAge`.
     * Sleep continues the rule above: 'enough' from `familyWarmthForEnoughSleep`,
     * otherwise 'short'.
     */
    startingExercise: 'light',
    startingOvertime: 'none',
  },

  physicalHealth: {
    /**
     * Two forces (design decision D36):
     * 1. Drift: every year the body is pulled toward a "set point"
     *    (short-term recovery). Set point = value for the age − accumulated wear.
     * 2. Wear: unhealthy years add long-lasting wear that lowers the set
     *    point (long-term damage). See `wear` below.
     * Habits also act directly every month (the immediate effect).
     */
    setPointYoung: 85,
    setPointDeclineStartAge: 25,
    setPointDeclinePerYear: 0.6,
    setPointMin: 20,
    /** Fraction of the gap to the set point closed per year, while young… */
    driftRateYoung: 0.25,
    /** …then recovery slows down a little every year after this age… */
    driftSlowdownStartAge: 30,
    driftSlowdownPerYear: 0.002,
    /** …but never below this rate. */
    driftRateMin: 0.2,
    habitsPerYear: {
      exercise: { none: -1, light: 1, regular: 2.5 },
      sleep: { short: -2, enough: 0.5 },
      overtime: { none: 0, some: -1, heavy: -3 },
      /** D69: an addiction hurts like heavy overtime (smoking) and adds wear like any unhealthy habit. */
      smoking: { none: 0, addicted: -3 },
      drinking: { none: 0, addicted: -2 },
    },
    /** At stress 100 the yearly effect is this value; scales linearly. */
    workStressAt100PerYear: -2,
    financialStressAt100PerYear: -1.5,
  },

  wear: {
    /**
     * Accumulated physical wear, 0–100 (hidden: the player sees its effect
     * as a line in the yearly summary, not the number itself).
     * Yearly gain = (sum of NEGATIVE physical habit/stress effects) × gainFactor.
     * Yearly heal = (sum of POSITIVE physical habit effects) × healFactor.
     * Healing is much slower than gaining: years of damage take decades to undo.
     */
    gainFactor: 0.13,
    healFactor: 0.05,
    max: 100,
  },

  mentalHealth: {
    setPoint: 70,
    driftRatePerYear: 0.25,
    habitsPerYear: {
      exercise: { none: 0, light: 0.5, regular: 1 },
      sleep: { short: -2, enough: 1 },
      overtime: { none: 0, some: -1, heavy: -2 },
      smoking: { none: 0, addicted: 0 },
      drinking: { none: 0, addicted: -2 },
    },
    /** Family warmth 100 → +value, 0 → −value, 50 → 0. */
    familyWarmthMaxPerYear: 3,
    /** Adults are less affected by the family they grew up in. */
    familyWarmthAdultWeight: 0.5,
    workStressAt100PerYear: -4,
    financialStressAt100PerYear: -4,
  },

  skills: {
    /** Basic learning while growing up; the school multiplies it (schoolLearning). */
    childhoodStartAge: 4,
    childhoodEndAge: 18,
    /** Per year, before the trait factor (D65). Academic grows fastest: school is mostly that. */
    childhoodPerYear: { academic: 2, creative: 1, communication: 1, practical: 1 } satisfies Skills,
    /** Life experience for adults, every skill; careers will add more later. */
    adultPerYear: 0.2,
    agingStartAge: 65,
    /** Every skill, not scaled by traits. */
    agingPerYear: -0.3,
    /** The trait that speeds up learning each skill (D65). */
    learningTrait: {
      academic: 'discipline',
      creative: 'imagination',
      communication: 'riskTaking',
      practical: 'resilience',
    } satisfies Record<SkillKey, TraitKey>,
    /**
     * D66: the school speeds up (or slows down) learning while growing up,
     * on top of the trait. Skills not listed learn at the normal speed (×1).
     * Ages 6–17 in practice: the school flag is set at Grade 1.
     * D70: top_public only from Grade 7 (ม.1), after passing its entrance exam.
     */
    schoolLearning: {
      international: { academic: 1.3, communication: 1.2 },
      private: { academic: 1.15 },
      top_public: { academic: 1.25 },
      scholarship: { academic: 1.15 },
      public: {},
      local: { academic: 0.9 },
      // D74: vocational college (ปวช.): hands-on work every day.
      vocational: { practical: 1.3 },
    } satisfies Record<SchoolId, Partial<Skills>>,
  },

  looks: {
    agingStartAge: 35,
    agingPerYear: -0.4,
    regularExercisePerYear: 0.3,
  },

  traits: {
    /** Resilience 100 cancels this fraction of NEGATIVE mental-health effects. */
    resilienceMaxReduction: 0.5,
    /** Each skill's trait scales its learning: factor = min + (max − min) × trait/100 (D65). */
    learningMin: 0.6,
    learningMax: 1.4,
    /** Risk-taking scales accident chance the same way. */
    riskAccidentMin: 0.7,
    riskAccidentMax: 1.3,
  },

  events: {
    /**
     * D67: how often an event happens, by its frequency word: the chance PER
     * YEAR while its conditions are met. Each event rolls on its own, so
     * writing more events never changes how often the others happen (this
     * replaces D53's shared pool). An event limited to some calendar months
     * gets the same yearly chance, spread over those months.
     * Not here: 'guaranteed' (the first month its conditions are met) and
     * 'window' (once, in a random month of its age range).
     */
    chancePerYear: {
      common: 0.5,
      normal: 0.2,
      uncommon: 0.05,
      rare: 0.01,
    },
    /** D67: at most this many chance events start in one month (guaranteed and window events don't count). */
    maxChanceEventsPerMonth: 1,
    /**
     * D68: a value can make an event more or less likely ("chanceBy").
     * At 50 the chance is unchanged; at 100 in the named direction it is
     * multiplied by this, at 0 divided by it (×3^((value − 50) / 50)).
     */
    chanceByMaxFactor: 3,
    /** D68: however strong the factors, a yearly chance never goes above this. */
    maxYearlyChance: 0.95,
    /**
     * D41: traits set early in life; from this age an event's effect on a
     * trait is multiplied by `traitFactorLater` (habits are hard to change
     * after lower secondary school).
     */
    traitEffectsReducedFromAge: 15,
    traitFactorLater: 0.5,
  },

  mortality: {
    /** Yearly death chance in the first year of life (infant mortality). */
    infantYearly: 0.007,
    /** Gompertz law: yearly hazard = a × e^(b × age). Fits adult mortality. */
    gompertzA: 0.00007,
    gompertzB: 0.085,
    /** Health multiplier: hazard × 2^((reference − health) / doubling points). */
    healthReference: 70,
    healthDoublingPoints: 28,
    /** Physical health at or below this value means immediate death. */
    deathAtHealth: 0,
    accidentYearly: 0.0004,
    /** A natural death counts as "old age" only from this age AND with
     *  physical health at or above `illnessBelowHealth`; otherwise "illness". */
    oldAgeFromAge: 60,
    illnessBelowHealth: 40,
  },

  /** D72: people the character meets. */
  people: {
    /** Share of new friends who are the same sex as the character (D72: 70%). */
    sameSexShare: 0.7,
    /** Classmates are up to this many months older or younger than the character. */
    classmateAgeGapMonths: 11,
  },
} as const;
