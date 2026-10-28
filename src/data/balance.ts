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

import type { AddictionHabit, Habits, JobId, LivingSpendingCategory, ProgramId, RegionId, SchoolId, SkillKey, Skills, SpendingLevel, StudyPlace, TraitKey, WorkLevel } from '../engine/types';

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

  /**
   * D77: work and money while living with the parents (finance phase 1).
   * Sources: design doc "Real price data" (minimum wage by area) and the
   * student part-time scheme (40 baht an hour; up to 4 hours on school days,
   * 7 hours a day and 36 a week in the school break).
   */
  work: {
    /** Part-time pay for students, in baht per hour (city rate). */
    partTimeHourly: 40,
    /** Hours a month: weekends 2 × 7 h × 4.3 weeks; daily adds 5 × 3 h; the school break is 36 h × 4.3. */
    hoursPerMonth: { weekend: 60, daily: 125, school_break: 155 },
    /** Part-time pay by where the character lives: the ratio of the areas' minimum daily wages (400 / 372 / 350). */
    regionWageFactor: { city: 1, suburb: 0.93, rural: 0.875 } satisfies Record<RegionId, number>,
    /** Full-time pay: the minimum daily wage of the area × working days in a month. */
    fullTimeDailyWage: { city: 400, suburb: 372, rural: 350 } satisfies Record<RegionId, number>,
    fullTimeDaysPerMonth: 26,
    /** Hours of a full-time month, to scale what part-time work teaches (8 h × 26 days). */
    fullTimeHoursPerMonth: 208,
    /** Jobs that pay less than the going rate (the family shop pays its own child half). */
    jobPayFactor: { family_shop: 0.5 } satisfies Partial<Record<JobId, number>>,
    /** How long the school break job lasts. */
    schoolBreakMonths: 2,
    /** The overtime habit while working at each level. Under 18 nobody may work overtime, so full time is 'none'. */
    overtime: { weekend: 'some', daily: 'heavy', school_break: 'none', full_time: 'none' } satisfies Record<WorkLevel, Habits['overtime']>,
    /** Daily part-time work leaves less time to study: the school's academic learning × this. */
    dailyAcademicLearning: 0.7,
    /**
     * D80: what the character pays for themselves each month while they have
     * an income and live with the parents (suburb, "normal" level). Housing,
     * utilities and health stay with the parents. From the design doc's real
     * price data, scaled down for someone living at home.
     */
    personalSpending: {
      weekend: { food: 600, transport: 200, phone: 200, leisure: 200 },
      daily: { food: 800, transport: 300, phone: 200, leisure: 200 },
      school_break: { food: 800, transport: 300, phone: 200, leisure: 200 },
      full_time: { food: 3000, transport: 1200, phone: 400, leisure: 1000 },
    } satisfies Record<WorkLevel, Record<LivingSpendingCategory, number>>,
    /**
     * D81: the monthly cost of an addiction, paid from the character's own
     * income (without one the parents pay, like the rest of their spending).
     * Smoking: a pack a day of the cheapest Thai brands, 60 baht a pack (2023
     * price list) × 30. Drinking: beer or spirits most evenings, an estimate
     * (no per-drinker figure found).
     */
    addictionSpending: { smoking: 1800, drinking: 2000 } satisfies Record<AddictionHabit, number>,
    /** D80: cost of living by area (real price data: suburb = 1). */
    regionCostFactor: { city: 1.25, suburb: 1, rural: 0.58 } satisfies Record<RegionId, number>,
    /** D80: each spending level: how much of the "normal" amounts, and its yearly effect on mental health. */
    spendingLevels: {
      frugal: { factor: 0.6, mentalHealthPerYear: -1 },
      normal: { factor: 1, mentalHealthPerYear: 0 },
      comfortable: { factor: 1.6, mentalHealthPerYear: 1 },
    } satisfies Record<SpendingLevel, { factor: number; mentalHealthPerYear: number }>,
    /** What a job teaches per year at full-time hours (scaled by the hours worked). */
    skillsPerYear: {
      convenience_store: { communication: 1.5 },
      cafe: { communication: 1, creative: 0.5 },
      restaurant: { practical: 1.5 },
      family_shop: { communication: 0.75, practical: 0.75 },
      local_shop: { communication: 0.75, practical: 0.75 },
    } satisfies Record<JobId, Partial<Skills>>,
  },

  /**
   * D77: the family's money stress while the character lives with the parents
   * (stored as financialStress, 0–100). Parents' money is not simulated: Family
   * wealth stands for it (design decision "A").
   */
  familyMoneyStress: {
    /** (wealthAtZero − Family wealth) × perWealthPoint, never below 0: wealth 10 → 75, 30 → 45, 50 → 15, 60+ → 0. */
    wealthAtZero: 60,
    perWealthPoint: 1.5,
    /** Added while a parent is out of work (flag parent_lost_job). */
    parentLostJob: 30,
    /** D79: after the parent finds work again, that part fades to 0 over these months. */
    jobLossRecoveryMonths: 6,
    /**
     * Only while growing up and starting out ("from birth to working age"):
     * from this age the character's own finances (finance phase 2) take
     * over, so until then it is 0.
     */
    untilAge: 22,
    /** Every 1,000 baht a month the character gives lowers it by this much... */
    reliefPer1000Given: 10,
    /** ...but by no more than this. */
    maxReliefFromGiving: 40,
    /**
     * D82: what the parents pay for the studies after Grade 12 (the monthly
     * allowance, and the tuition when they pay it, as a monthly average)
     * raises it by this much per 1,000 baht a month...
     */
    perStudySupport1000: 5,
    /** ...except in a family this well off (it pays without strain). */
    studySupportFreeFromWealth: 65,
  },

  /**
   * D82: studying after Grade 12 / ปวช. (design doc, real price data section 7).
   * Amounts in baht; proposed values from the real data, to adjust from play.
   */
  study: {
    /** Tuition per term (two terms a year, paid at the start of each), by where. */
    tuitionPerTerm: { top_public: 18000, regional: 10000, private: 45000, open: 1500, vocational_college: 3000 } satisfies Record<StudyPlace, number>,
    /** Some faculties cost more (Thammasat 2569: medicine 28,500, nursing 26,500, engineering 19,700 vs 14,000–18,000). */
    tuitionFactor: { bachelor_medicine: 1.6, bachelor_health: 1.4, bachelor_engineering: 1.1 } satisfies Partial<Record<ProgramId, number>>,
    termMonths: 6,
    /**
     * Living away from home in a dorm, per month in the suburb at the "normal"
     * spending level; the area's cost factor applies to all, the spending
     * level to all but the room. City ≈ 11,600, suburb 9,300, rural ≈ 5,400.
     */
    dormLiving: { dorm: 3500, food: 4000, transport: 1000, phone: 300, leisure: 500 },
    /** Share of the dorm living the parents send each month, by Family wealth (the first band it is at least). */
    allowanceShare: [
      { wealthFrom: 65, share: 1 },
      // D83: from 0.6 / 0.2 (students in a dorm were short of money 36% of the months).
      { wealthFrom: 40, share: 0.7 },
      { wealthFrom: 0, share: 0.4 },
    ],
    /** The parents can pay the tuition from this Family wealth (by where). */
    parentsPayFromWealth: { top_public: 40, regional: 40, private: 50, open: 0, vocational_college: 0 } satisfies Record<StudyPlace, number>,
    /** A student loan (กยศ.) only below this Family wealth (stands for a family income up to 360,000 a year). */
    loanBelowWealth: 50,
    /** กยศ. living allowance, per month, for a student living in a dorm. */
    loanLivingPerMonth: 3000,
    /** Where each place is: in the city, or in the home area (a rural home still means a dorm). */
    inCity: ['top_public', 'private'] as readonly StudyPlace[],
    /** Places studied from home (no dorm). */
    fromHome: ['open', 'vocational_college'] as readonly StudyPlace[],
    /** A waiting program with no current one (a gap year) starts in these calendar months (the start of the school year). */
    startMonths: [5, 6, 7, 8],
    /**
     * What each program teaches per year (before the trait factor), on top of
     * life experience. The place multiplies it (placeLearning).
     */
    learningPerYear: {
      higher_vocational: { practical: 2, academic: 0.5 },
      bachelor_medicine: { academic: 3, communication: 1 },
      bachelor_health: { academic: 2.5, communication: 1, practical: 0.5 },
      bachelor_engineering: { academic: 2.5, practical: 1 },
      bachelor_business: { academic: 1.5, communication: 1.5 },
      bachelor_education: { academic: 1.5, communication: 1.5 },
      bachelor_humanities: { academic: 1.5, communication: 1, creative: 0.5 },
      bachelor_arts: { creative: 2.5, academic: 0.5 },
    } satisfies Partial<Record<ProgramId, Partial<Skills>>>,
    placeLearning: {
      top_public: { academic: 1.25 },
      regional: {},
      private: { academic: 1.1 },
      // Studying alone from books, with few classes.
      open: { academic: 0.8, communication: 0.8 },
      vocational_college: { practical: 1.3 },
    } satisfies Record<StudyPlace, Partial<Skills>>,
  },

  /**
   * D83: hours in a week (design doc D83). Sources: AASM sleep (teens 8–10 h,
   * adults 7+), WHO activity (adults 150–300 min a week), the lower
   * secondary curriculum (at least 1,200 class hours a year).
   */
  time: {
    hoursPerWeek: 168,
    /** Free time a week below which the week counts as full. */
    minFree: 14,
    /** Eating, washing, errands: 3 hours a day. */
    essentials: 21,
    /** School / ปวช. / ปวส. (8 hours a day on site); university classes; กศน. and the open university. */
    study: { school: 40, university: 25, distance: 6 },
    /** Getting to school, university or a full-time job; a home far from school adds more. */
    commute: 5,
    longCommute: 5,
    work: { weekend: 14, daily: 29, school_break: 48, full_time: 48 } satisfies Record<WorkLevel, number>,
    /** "Enough" is 9 hours a night before 18, 8 hours from 18; "short" is 6. */
    sleep: { enoughChild: 63, enoughAdult: 56, short: 42 },
    sleepAdultFromAge: 18,
    exercise: { none: 0, light: 2, regular: 5 } satisfies Record<Habits['exercise'], number>,
  },

  /** D72: people the character meets. */
  people: {
    /** Share of new friends who are the same sex as the character (D72: 70%). */
    sameSexShare: 0.7,
    /** Classmates are up to this many months older or younger than the character. */
    classmateAgeGapMonths: 11,
  },
} as const;
