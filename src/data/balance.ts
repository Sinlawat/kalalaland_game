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

import type { Habits } from '../engine/types';

export const BALANCE = {
  birth: {
    /** Traits/environment start as the average of two uniform draws in this
     *  range → most people near the middle, few at the extremes. */
    attributeMin: 10,
    attributeMax: 90,
    physicalHealth: { min: 70, max: 95 },
    mentalHealth: { min: 60, max: 90 },
    knowledge: 0,
    looks: { min: 10, max: 90 },
    habits: { exercise: 'light', sleep: 'enough', overtime: 'none' } satisfies Habits,
  },

  earlyChildhood: {
    /**
     * Design decisions (D34, D35):
     * - At Grade 1 (ป.1, age 6) the player starts choosing habits and gets
     *   to know their own traits.
     * - Before that, habits are not the child's choice:
     *   - movement: none for babies; from `playFromAge`, normal play ('light' exercise values)
     *   - sleep: depends on the family environment (Family warmth), from birth
     */
    playerChoosesHabitsFromAge: 6,
    playFromAge: 2,
    /**
     * Sleep effect = interpolate from the 'short' to the 'enough' sleep values.
     * Family warmth 0 → 'short'; at or above this value → 'enough'.
     * An average family (50) is assumed to look after a young child's sleep well.
     */
    familyWarmthForEnoughSleep: 50,
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
    },
    /** Family warmth 100 → +value, 0 → −value, 50 → 0. */
    familyWarmthMaxPerYear: 3,
    /** Adults are less affected by the family they grew up in. */
    familyWarmthAdultWeight: 0.5,
    workStressAt100PerYear: -4,
    financialStressAt100PerYear: -4,
  },

  knowledge: {
    /** Basic learning while growing up (schooling comes with events later). */
    childhoodStartAge: 4,
    childhoodEndAge: 18,
    childhoodPerYear: 4,
    adultPerYear: 0.5,
    agingStartAge: 65,
    agingPerYear: -0.3,
  },

  looks: {
    agingStartAge: 35,
    agingPerYear: -0.4,
    regularExercisePerYear: 0.3,
  },

  traits: {
    /** Resilience 100 cancels this fraction of NEGATIVE mental-health effects. */
    resilienceMaxReduction: 0.5,
    /** Discipline scales learning: factor = min + (max − min) × discipline/100. */
    disciplineLearningMin: 0.6,
    disciplineLearningMax: 1.4,
    /** Risk-taking scales accident chance the same way. */
    riskAccidentMin: 0.7,
    riskAccidentMax: 1.3,
  },

  events: {
    /**
     * How often an event happens while its conditions are met, as a YEARLY
     * chance. Event data uses the words (what the writer chose in the
     * template); only these numbers decide what the words mean.
     * 'guaranteed' is special: it happens in the first month the conditions
     * are met, so it must also be "once" (checked when the data loads).
     */
    yearlyChance: {
      rare: 0.05,
      uncommon: 0.15,
      normal: 0.35,
      common: 0.7,
    },
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
} as const;
