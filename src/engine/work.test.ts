import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { setSpendingLevel } from '../actions/spending';
import { enroll } from './education';
import { applyChoice, applyEvent, calendarMonth, EVENTS, findEvent, isEligible, lockReasons, monthlyChance, parseEvents, yearlyChance, type EventDef } from './events';
import { advanceOneMonth, simulateWholeLife, type Chooser } from './game';
import { createNewLife } from './newLife';
import { computePassiveContributions, isWorking } from './passive';
import { makeState } from './testUtils';
import type { GameState, Job } from './types';
import {
  advanceWork,
  applyWorkEffect,
  changeMoney,
  currentJob,
  familyMoneyStress,
  familyMoneyStressParts,
  meetsWorkConditions,
  monthlySpending,
  monthlyWage,
  startJob,
  stopWork,
  totalSpending,
} from './work';

/** A student in Grade 10 (ม.4) at 15, with a known lifestyle. */
function student(overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ ageInMonths: 15 * 12, habits: { exercise: 'regular' }, ...overrides });
  enroll(state, 'upper_secondary_arts_math', state.ageInMonths);
  return state;
}

/** Runs the money step month by month, like the game loop does. */
function months(state: GameState, count: number): GameState {
  for (let i = 0; i < count; i++) {
    state.ageInMonths += 1;
    advanceWork(state);
  }
  return state;
}

const jobs = (state: GameState) => state.work.history.map((j: Job) => `${j.job}:${j.level}:${j.result ?? 'now'}`);

describe('wages (D77)', () => {
  it('part-time pays 40 baht an hour in the city, scaled by the area', () => {
    expect(monthlyWage('convenience_store', 'weekend', 'city')).toBe(2400);
    expect(monthlyWage('convenience_store', 'weekend', 'suburb')).toBe(2232);
    expect(monthlyWage('convenience_store', 'weekend', 'rural')).toBe(2100);
    expect(monthlyWage('restaurant', 'daily', 'city')).toBe(5000);
    expect(monthlyWage('local_shop', 'school_break', 'city')).toBe(6200);
  });

  it('full time pays the minimum daily wage of the area × 26 days; the family shop pays half', () => {
    expect(monthlyWage('convenience_store', 'full_time', 'city')).toBe(10400);
    expect(monthlyWage('restaurant', 'full_time', 'rural')).toBe(9100);
    expect(monthlyWage('family_shop', 'full_time', 'rural')).toBe(4550);
  });
});

describe('jobs and the lifestyle they bring (D77)', () => {
  it('a weekend job: overtime "some", regular exercise drops to light; quitting gives it back', () => {
    const state = student();
    expect(startJob(state, 'cafe', 'weekend')).toEqual({ overtime: 'some', exercise: 'light' });
    expect(isWorking(state)).toBe(true);
    expect(stopWork(state)).toEqual({ overtime: 'none', exercise: 'regular' });
    expect(jobs(state)).toEqual(['cafe:weekend:quit']);
    expect(isWorking(state)).toBe(false);
  });

  it('a daily job leaves no time for exercise; cutting down to weekends gives back light exercise', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    expect(state.habits).toMatchObject({ overtime: 'heavy', exercise: 'none' });
    const { habits, change } = applyWorkEffect(state, { level: 'weekend' });
    expect(habits).toEqual({ overtime: 'some', exercise: 'light' });
    expect(change).toEqual({ from: { job: 'restaurant', level: 'daily' }, to: { job: 'restaurant', level: 'weekend' } });
    expect(jobs(state)).toEqual(['restaurant:daily:changed', 'restaurant:weekend:now']);
    stopWork(state);
    expect(state.habits.exercise).toBe('regular');
  });

  it('exercise someone took up during the job is not taken away when it ends', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    state.habits.exercise = 'regular'; // e.g. a new-year resolution kept
    stopWork(state);
    expect(state.habits.exercise).toBe('regular');
  });

  it('less exercise only goes down, never up: someone who did none still does none', () => {
    const state = student({ habits: { exercise: 'none' } });
    expect(startJob(state, 'cafe', 'weekend')).toEqual({ overtime: 'some' });
    expect(stopWork(state)).toEqual({ overtime: 'none' });
  });

  it('a full-time teen job: no overtime (not allowed under 18), exercise untouched', () => {
    const state = makeState({ ageInMonths: 15 * 12 + 3, habits: { exercise: 'regular' } });
    expect(startJob(state, 'convenience_store', 'full_time')).toEqual({});
    expect(state.habits).toMatchObject({ overtime: 'none', exercise: 'regular' });
  });

  it('conditions: employed, level, months at the job', () => {
    const state = student();
    expect(meetsWorkConditions(state, { employed: false })).toBe(true);
    startJob(state, 'cafe', 'weekend');
    months(state, 4);
    expect(meetsWorkConditions(state, { employed: true, levels: ['weekend'], monthsIn: { min: 4 } })).toBe(true);
    expect(meetsWorkConditions(state, { levels: ['daily'] })).toBe(false);
    expect(meetsWorkConditions(state, { monthsIn: { max: 3 } })).toBe(false);
  });
});

describe('the monthly money step (D77)', () => {
  it('pays from the month after the job started, into the savings, minus the family share and their own spending (D80)', () => {
    const state = student({ residence: { regionId: 'city', homeId: 'parents' } });
    startJob(state, 'convenience_store', 'weekend');
    advanceWork(state); // same month: nothing yet
    expect(state.money.cash).toBe(0);
    months(state, 1);
    // City: wage 2,400; own spending 1,200 × 1.25 = 1,500.
    expect(state.money.cash).toBe(2400 - 1500);
    state.money.familySharePercent = 30;
    months(state, 1);
    expect(state.money.cash).toBe(900 + 1680 - 1500);
    expect(state.money.monthGiven).toBe(720);
    expect(state.money.year).toEqual({
      earned: 4800,
      given: 720,
      income: { 'job.convenience_store': 4800 },
      spent: { 'living.food': 1500, 'living.transport': 500, 'living.phone': 500, 'living.leisure': 500 },
    });
    expect(state.money.shortfall).toBe(0);
    expect(Number.isInteger(state.money.cash)).toBe(true);
  });

  it('D80: spending follows the job level, the area and the spending level; nothing without a job', () => {
    const state = student({ residence: { regionId: 'suburb', homeId: 'parents' } });
    expect(totalSpending(monthlySpending(state))).toBe(0);
    startJob(state, 'restaurant', 'full_time');
    expect(monthlySpending(state)).toEqual({ food: 3000, transport: 1200, phone: 400, leisure: 1000, smoking: 0, drinking: 0 });
    state.residence.regionId = 'rural';
    expect(totalSpending(monthlySpending(state))).toBe(Math.round(3000 * 0.58) + Math.round(1200 * 0.58) + Math.round(400 * 0.58) + Math.round(1000 * 0.58));
    state.residence.regionId = 'suburb';
    state.money.spendingLevel = 'frugal';
    expect(totalSpending(monthlySpending(state))).toBe(3360);
    state.money.spendingLevel = 'comfortable';
    expect(totalSpending(monthlySpending(state))).toBe(8960);
  });

  it('D80: what the savings cannot cover is not spent, and is remembered as a shortfall', () => {
    const state = makeState({ ageInMonths: 16 * 12, residence: { regionId: 'suburb', homeId: 'parents' } });
    startJob(state, 'restaurant', 'full_time');
    state.money.familySharePercent = 50;
    months(state, 1);
    // 9,672 wage − 4,836 to the family = 4,836 left for 5,600 of spending.
    expect(state.money.cash).toBe(0);
    expect(state.money.shortfall).toBe(5600 - 4836);
    expect(isEligible(findEvent('money_short')!, state)).toBe(true);
    applyChoice(state, findEvent('money_short')!, 'give_less', state.ageInMonths);
    months(state, 1);
    expect(state.money.shortfall).toBe(0);
    expect(state.money.cash).toBe(9672 - 5600);
  });

  it('D80: the spending level changes mental health a little, only while paying for oneself', () => {
    const state = student();
    state.money.spendingLevel = 'comfortable';
    const line = () => computePassiveContributions(state).find((c) => c.source.startsWith('money.spending.'));
    expect(line()).toBeUndefined();
    startJob(state, 'cafe', 'weekend');
    expect(line()).toMatchObject({ target: 'mentalHealth', source: 'money.spending.comfortable', amount: 1 / 12 });
  });

  it('the school break job pays two months, then ends by itself', () => {
    const state = student({ residence: { regionId: 'city', homeId: 'parents' } });
    startJob(state, 'local_shop', 'school_break');
    months(state, 2);
    // Two wages of 6,200, minus two months of own spending in the city (1,500 × 1.25).
    expect(state.money.cash).toBe(12400 - 2 * 1875);
    expect(jobs(state)).toEqual(['local_shop:school_break:ended']);
    months(state, 1);
    expect(state.money.cash).toBe(12400 - 2 * 1875);
  });

  it('part-time work ends when school ends; a full-time job does not', () => {
    const state = student();
    startJob(state, 'cafe', 'weekend');
    state.education.history.at(-1)!.to = state.ageInMonths + 1; // finished school
    months(state, 1);
    expect(currentJob(state)).toBeUndefined();
    expect(jobs(state)).toEqual(['cafe:weekend:ended']);
    expect(state.habits.exercise).toBe('regular');
    startJob(state, 'restaurant', 'full_time');
    months(state, 3);
    expect(currentJob(state)?.level).toBe('full_time');
  });

  it('savings never go below 0', () => {
    const state = student();
    state.money.cash = 300;
    expect(changeMoney(state, -500)).toBe(-300);
    expect(state.money.cash).toBe(0);
  });
});

describe("the family's money stress (D77, design A)", () => {
  const stress = (overrides: Parameters<typeof makeState>[0]) => familyMoneyStress(makeState({ ageInMonths: 10 * 12, ...overrides }));

  it('comes from Family wealth: 10 → 75, 30 → 45, 50 → 15, 60 and above → 0', () => {
    expect(stress({ environment: { familyWealth: 10 } })).toBe(75);
    expect(stress({ environment: { familyWealth: 30 } })).toBe(45);
    expect(stress({ environment: { familyWealth: 50 } })).toBe(15);
    expect(stress({ environment: { familyWealth: 60 } })).toBe(0);
    expect(stress({ environment: { familyWealth: 90 } })).toBe(0);
  });

  it('a parent out of work adds 30; never above 100', () => {
    expect(stress({ environment: { familyWealth: 30 }, flags: ['parent_lost_job'] })).toBe(75);
    expect(stress({ environment: { familyWealth: 0 }, flags: ['parent_lost_job'] })).toBe(100);
  });

  it('what the character gives eases it: 10 per 1,000 baht a month, at most 40', () => {
    const base = makeState({ ageInMonths: 16 * 12, environment: { familyWealth: 20 } });
    base.money.monthGiven = 1500;
    expect(familyMoneyStress(base)).toBe(60 - 15);
    base.money.monthGiven = 9000;
    expect(familyMoneyStress(base)).toBe(60 - 40);
  });

  it('a one-off gift eases it for its months only', () => {
    const state = makeState({ ageInMonths: 16 * 12, environment: { familyWealth: 20 } });
    state.money.familyRelief = { amount: 20, untilMonth: 16 * 12 + 3 };
    expect(familyMoneyStress(state)).toBe(40);
    state.ageInMonths += 4;
    expect(familyMoneyStress(state)).toBe(60);
  });

  it(`is the family's only until ${BALANCE.familyMoneyStress.untilAge}: then 0 (the character's own finances come later)`, () => {
    expect(stress({ ageInMonths: BALANCE.familyMoneyStress.untilAge * 12 - 1, environment: { familyWealth: 10 } })).toBe(75);
    expect(stress({ ageInMonths: BALANCE.familyMoneyStress.untilAge * 12, environment: { familyWealth: 10 } })).toBe(0);
  });

  it('is known from birth and lowers health through the existing balance values', () => {
    const poor = makeState({ ageInMonths: 10 * 12, environment: { familyWealth: 20, financialStress: 60 } });
    const line = computePassiveContributions(poor).find((c) => c.target === 'mentalHealth' && c.source === 'env.financialStress')!;
    expect(line.amount).toBeCloseTo((0.6 * BALANCE.mentalHealth.financialStressAt100PerYear) / 12);
    for (let seed = 0; seed < 50; seed++) {
      const life = createNewLife(seed);
      expect(life.environment.financialStress).toBe(familyMoneyStress(life));
    }
  });
});

describe('what work teaches, and what it costs at school (D77)', () => {
  const lines = (state: GameState, target: string) => computePassiveContributions(state).filter((c) => c.target === target && c.source.startsWith('work.'));

  it('a job teaches its skills, more with more hours', () => {
    const weekend = student();
    startJob(weekend, 'convenience_store', 'weekend');
    const daily = student();
    startJob(daily, 'convenience_store', 'daily');
    const perMonth = (state: GameState) => lines(state, 'communication')[0]!.amount;
    expect(perMonth(weekend)).toBeCloseTo((1.5 * 60) / 208 / 12);
    expect(perMonth(daily)).toBeGreaterThan(perMonth(weekend));
  });

  it('only daily work while studying slows academic learning (×0.7 of the school-age speed)', () => {
    const daily = student();
    startJob(daily, 'restaurant', 'daily');
    const study = lines(daily, 'academic').find((c) => c.source === 'work.daily.study')!;
    expect(study.amount).toBeLessThan(0);
    const weekend = student();
    startJob(weekend, 'restaurant', 'weekend');
    expect(lines(weekend, 'academic')).toEqual([]);
  });

  it('the overtime habit acts while working part-time (it used to need a full-time job)', () => {
    const state = student();
    startJob(state, 'restaurant', 'daily');
    const sources = computePassiveContributions(state).map((c) => c.source);
    expect(sources).toContain('habit.overtime.heavy');
  });
});

describe('work and money in events.json (D77)', () => {
  const base = { conditions: { ageMin: 15, ageMax: 17 }, frequency: 'normal', once: true };

  it('rejects bad work and money data', () => {
    const bad: unknown[] = [
      { ...base, id: 'a', effects: { work: { start: { job: 'bank', level: 'weekend' } } } },
      { ...base, id: 'b', effects: { work: { quit: true, level: 'daily' } } },
      { ...base, id: 'c', effects: { money: 0 } },
      { ...base, id: 'd', effects: { familyShare: 120 } },
      { ...base, id: 'e', conditions: { ...base.conditions, work: { employed: false, levels: ['daily'] } }, effects: {} },
      { ...base, id: 'f', conditions: { ...base.conditions, birthday: true, months: [3] }, effects: {} },
      { ...base, id: 'g', effects: { familyRelief: { amount: 20 } } },
    ];
    expect(() => parseEvents(bad)).toThrow(/"a"[\s\S]*"b"[\s\S]*"c"[\s\S]*"d"[\s\S]*"e"[\s\S]*"f"[\s\S]*"g"/);
  });

  it('a choice may need savings; the lock says how much is missing', () => {
    const event = findEvent('work_family_short_money')!;
    const lump = event.choices!.find((c) => c.id === 'lump')!;
    const state = student({ environment: { familyWealth: 20 } });
    state.money.cash = 1200;
    expect(lockReasons(lump, state)).toEqual([{ kind: 'money', min: 3000, current: 1200 }]);
    state.money.cash = 3000;
    expect(lockReasons(lump, state)).toEqual([]);
    applyChoice(state, event, 'lump', state.ageInMonths);
    expect(state.money.cash).toBe(0);
    expect(state.eventHistory.at(-1)!.moneyChange).toBe(-3000);
    expect(state.money.familyRelief).toEqual({ amount: 20, untilMonth: state.ageInMonths + 3 });
    expect(state.environment.financialStress).toBe(familyMoneyStress(state));
  });

  it('starting a job through an event records the job and the lifestyle it brings', () => {
    const state = student();
    applyChoice(state, findEvent('work_parttime_offer')!, 'daily', state.ageInMonths);
    const record = state.eventHistory.at(-1)!;
    expect(record.workChange).toEqual({ to: { job: 'restaurant', level: 'daily' } });
    expect(record.habitChanges).toEqual({ overtime: 'heavy', exercise: 'none' });
  });

  it('birthday events happen only in the birthday month, with their whole yearly chance there', () => {
    const event = findEvent('life_birthday_money')!;
    const state = makeState({ ageInMonths: 10 * 12, environment: { familyWealth: 40 } });
    expect(isEligible(event, state)).toBe(true);
    expect(monthlyChance(event, state)).toBeCloseTo(yearlyChance(event, state));
    state.ageInMonths += 1;
    expect(isEligible(event, state)).toBe(false);
    state.ageInMonths = 10 * 12;
    applyEvent(state, event);
    expect(state.money.cash).toBe(500);
  });

  it('the first job of life asks what to do with the first wage, one month in', () => {
    const event = findEvent('work_first_paycheck')!;
    const state = student();
    startJob(state, 'cafe', 'weekend');
    expect(isEligible(event, state)).toBe(false);
    months(state, 1);
    expect(isEligible(event, state)).toBe(true);
    applyChoice(state, event, 'share', state.ageInMonths);
    expect(state.money.familySharePercent).toBe(30);
  });
});

describe('an event about someone, made impossible earlier the same month, does not happen (D72/D77)', () => {
  const end: EventDef = { id: 'test_end', conditions: { ageMin: 0, ageMax: 99 }, frequency: 'guaranteed', once: true, effects: { setFlags: ['test_parted'] } };
  const meet = parseEvents([
    end,
    {
      id: 'test_meet', about: 'new_person', conditions: { ageMin: 0, ageMax: 99, flagsNone: ['test_parted'] }, frequency: 'guaranteed', once: true,
      effects: { person: { befriend: 'friend' } },
    },
    { id: 'test_other', conditions: { ageMin: 0, ageMax: 99, flagsNone: ['test_parted'] }, frequency: 'guaranteed', once: true, effects: {} },
  ]);

  it('the person event is dropped; other events that were eligible at the start of the month still happen (D67)', () => {
    const { state } = advanceOneMonth(makeState({ ageInMonths: 120 }), meet);
    expect(state.eventHistory.map((r) => r.id)).toEqual(['test_end', 'test_other']);
    expect(state.people).toEqual([]);
  });
});

describe('real lives (D77)', () => {
  /** Says yes to work: the first job offer, then keeps the job. */
  const worker: Chooser = (state, event) => {
    const open = event.choices!.filter((c) => lockReasons(c, state).length === 0);
    const pick = event.id === 'work_parttime_offer' ? open.find((c) => c.id === 'daily') : undefined;
    return (pick ?? open[0]!).id;
  };
  const lives = Array.from({ length: 300 }, (_, seed) => simulateWholeLife(createNewLife(seed), { chooser: worker }));

  it('nobody earns a wage before 15; savings are whole baht and never negative', () => {
    for (const end of lives) {
      for (const job of end.work.history) expect(job.from).toBeGreaterThanOrEqual(15 * 12);
      expect(Number.isInteger(end.money.cash)).toBe(true);
      expect(end.money.cash).toBeGreaterThanOrEqual(0);
      for (const year of end.history) if (year.age <= 15) expect(year.money?.earned ?? 0).toBe(0);
    }
  });

  it('many students who say yes work part-time; everyone who left school at 15 to work has a full-time job', () => {
    const partTime = lives.filter((end) => end.work.history.some((job) => job.level === 'daily'));
    expect(partTime.length).toBeGreaterThan(30);
    for (const end of lives) {
      if (end.eventHistory.some((r) => r.id === 'work_teen_first_job')) {
        expect(end.work.history.some((job) => job.level === 'full_time')).toBe(true);
      }
    }
  });

  it('jobs never overlap and every ended job has a reason', () => {
    for (const end of lives) {
      end.work.history.forEach((job, index) => {
        const next = end.work.history[index + 1];
        if (next !== undefined) {
          expect(job.to).toBeDefined();
          expect(job.to!).toBeLessThanOrEqual(next.from);
          expect(job.result).toBeDefined();
        }
      });
    }
  });

  it("the family money stress is 0 for adults (the character's own finances come later)", () => {
    const adults = lives.filter((end) => end.ageInMonths >= BALANCE.familyMoneyStress.untilAge * 12);
    expect(adults.length).toBeGreaterThan(250);
    for (const end of adults) expect(end.environment.financialStress).toBe(0);
    expect(EVENTS.some((e) => e.id === 'work_family_short_money')).toBe(true);
  });
});

describe('D79: stress after a job loss fades; money by source; the yearly question', () => {
  it('a parent back at work: the 30 of being out of work fades over 6 months instead of vanishing', () => {
    const state = makeState({ ageInMonths: 12 * 12, environment: { familyWealth: 70 }, flags: ['parent_lost_job'] });
    expect(familyMoneyStressParts(state)).toMatchObject({ wealth: 0, parentOutOfWork: 30, recovering: 0, total: 30 });
    applyEvent(state, findEvent('family_parent_new_job')!);
    expect(state.money.jobLossRecoveryUntil).toBe(12 * 12 + 6);
    expect(familyMoneyStressParts(state)).toMatchObject({ parentOutOfWork: 0, recovering: 30, total: 30 });
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      state.ageInMonths += 1;
      advanceWork(state);
      seen.push(state.environment.financialStress);
    }
    expect(seen).toEqual([25, 20, 15, 10, 5, 0, 0]);
    expect(state.money.jobLossRecoveryUntil).toBeUndefined();
  });

  it('the parts add up to the total, with help from the character as negative parts', () => {
    const state = makeState({ ageInMonths: 16 * 12, environment: { familyWealth: 40 } });
    state.money.monthGiven = 1000;
    state.money.familyRelief = { amount: 5, untilMonth: 16 * 12 + 1 };
    expect(familyMoneyStressParts(state)).toEqual({ wealth: 30, parentOutOfWork: 0, recovering: 0, giving: -10, gift: -5, total: 15 });
  });

  it('counts money by source: wages by job, events in and out', () => {
    const state = student({ residence: { regionId: 'city', homeId: 'parents' } });
    startJob(state, 'cafe', 'weekend');
    months(state, 2);
    applyEvent(state, findEvent('life_birthday_money')!);
    applyChoice(state, findEvent('work_first_paycheck')!, 'treat', state.ageInMonths);
    expect(state.money.year.income).toEqual({ 'job.cafe': 4800, 'event.life_birthday_money': 500 });
    expect(state.money.year.spent).toMatchObject({ 'event.work_first_paycheck': 500, 'living.food': 1500 });
  });

  it('every May of school, a part-time worker is asked whether to go on; the level they already have is locked', () => {
    const event = findEvent('work_parttime_new_term')!;
    const state = student();
    startJob(state, 'cafe', 'weekend');
    const may = (s: GameState) => {
      while (calendarMonth(s) !== 5 || s.ageInMonths - currentJob(s)!.from < 3) s.ageInMonths += 1;
    };
    may(state);
    expect(isEligible(event, state)).toBe(true);
    const locked = (id: string) => lockReasons(event.choices!.find((c) => c.id === id)!, state).length > 0;
    expect([locked('keep'), locked('to_weekend'), locked('to_daily'), locked('quit')]).toEqual([false, true, false, false]);
    applyChoice(state, event, 'to_daily', state.ageInMonths);
    expect(currentJob(state)!.level).toBe('daily');
  });
});

describe('D80: the spending level (player action) and birthday money', () => {
  it('the player sets the spending level; the state is a new object only when it changes', () => {
    const state = makeState();
    expect(setSpendingLevel(state, 'normal')).toBe(state);
    const next = setSpendingLevel(state, 'frugal');
    expect(next.money.spendingLevel).toBe('frugal');
    expect(state.money.spendingLevel).toBe('normal');
  });

  it('no birthday money below family wealth 40; 500 from 40, 1,500 from 65, at a normal frequency', () => {
    const poor = findEvent('life_birthday_money')!;
    const rich = findEvent('life_birthday_money_rich')!;
    const at = (wealth: number) => makeState({ ageInMonths: 10 * 12, environment: { familyWealth: wealth } });
    expect([39.9, 40, 64.9, 65].map((w) => [isEligible(poor, at(w)), isEligible(rich, at(w))])).toEqual([
      [false, false],
      [true, false],
      [true, false],
      [false, true],
    ]);
    expect([poor.frequency, rich.frequency]).toEqual(['normal', 'normal']);
  });
});

describe('D81: money in events that already existed', () => {
  it('an addiction costs a fixed amount a month from the own income, whatever the area or spending level', () => {
    const state = student({ residence: { regionId: 'rural', homeId: 'parents' }, habits: { exercise: 'regular', smoking: 'addicted', drinking: 'addicted' } });
    expect(monthlySpending(state)).toMatchObject({ smoking: 0, drinking: 0 }); // no income: the parents pay
    startJob(state, 'cafe', 'weekend');
    state.money.spendingLevel = 'frugal';
    expect(monthlySpending(state)).toMatchObject({ smoking: BALANCE.work.addictionSpending.smoking, drinking: BALANCE.work.addictionSpending.drinking });
    state.habits.drinking = 'none';
    expect(monthlySpending(state).drinking).toBe(0);
  });

  it('living costs are paid before the addiction when the money runs short; the rest is the shortfall', () => {
    const state = student({ residence: { regionId: 'suburb', homeId: 'parents' }, habits: { exercise: 'regular', smoking: 'addicted' } });
    startJob(state, 'cafe', 'weekend');
    months(state, 1);
    // Suburb: wage 2,232; living 1,200, then cigarettes 1,800 of which 1,032 can be paid.
    const wage = monthlyWage('cafe', 'weekend', 'suburb');
    expect(state.money.year.spent).toEqual({ 'living.food': 600, 'living.transport': 200, 'living.phone': 200, 'living.leisure': 200, 'living.smoking': wage - 1200 });
    expect(state.money.shortfall).toBe(1200 + 1800 - wage);
    expect(state.money.cash).toBe(0);
  });

  it('a family trip in the school break needs family wealth 40', () => {
    const trip = findEvent('family_summer_trip')!;
    const at = (wealth: number) => makeState({ ageInMonths: 10 * 12, birthMonth: 4, environment: { familyWealth: wealth, familyWarmth: 60 } });
    expect([isEligible(trip, at(39.9)), isEligible(trip, at(40))]).toEqual([false, true]);
  });

  it('divorce and a new sibling lower the family wealth (and so raise the money stress)', () => {
    expect(findEvent('family_parents_divorce')!.effects!.environment).toMatchObject({ familyWealth: -8 });
    expect(findEvent('family_new_sibling')!.effects!.environment).toEqual({ familyWealth: -3 });
  });

  it('a seriously ill relative: a working teen may help with their savings; only one of the two versions ever happens', () => {
    const plain = findEvent('family_relative_seriously_ill')!;
    const working = findEvent('family_relative_seriously_ill_working')!;
    const state = student({ ageInMonths: 16 * 12 });
    expect([isEligible(plain, state), isEligible(working, state)]).toEqual([true, false]);
    startJob(state, 'cafe', 'weekend');
    expect([isEligible(plain, state), isEligible(working, state)]).toEqual([false, true]);
    const help = working.choices!.find((c) => c.id === 'help')!;
    expect(lockReasons(help, state)).toEqual([{ kind: 'money', min: 3000, current: 0 }]);
    state.money.cash = 5000;
    const wealth = state.environment.familyWealth;
    applyChoice(state, working, 'help', state.ageInMonths);
    expect(state.money.cash).toBe(2000);
    expect(state.environment.familyWealth).toBe(wealth - 3);
    expect(state.money.familyRelief).toMatchObject({ amount: 20 });
    expect(isEligible(plain, state)).toBe(false);
  });

  it('tutoring the family cannot pay for can be paid from the own savings', () => {
    const cases = [
      ['edu_wrong_track_science', 'tutor', 'tutor_self', 4000],
      ['edu_admission_prep', 'cram', 'cram_self', 8000],
    ] as const;
    for (const [eventId, parentsPay, selfPay, price] of cases) {
      const event = findEvent(eventId)!;
      const choice = (id: string) => event.choices!.find((c) => c.id === id)!;
      const poor = makeState({ ageInMonths: 16 * 12, environment: { familyWealth: 20 } });
      expect(lockReasons(choice(parentsPay), poor)).toHaveLength(1);
      expect(lockReasons(choice(selfPay), poor)).toEqual([{ kind: 'money', min: price, current: 0 }]);
      poor.money.cash = price;
      expect(lockReasons(choice(selfPay), poor)).toEqual([]);
      // Same effects as when the family pays, plus the price.
      const { money, ...rest } = choice(selfPay).effects;
      expect([money, rest]).toEqual([-price, choice(parentsPay).effects]);
    }
  });
});
