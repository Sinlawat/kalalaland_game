import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { advanceEducation, enroll } from './education';
import { applyChoice, applyEvent, findEvent, isEligible, lockReasons } from './events';
import { computePassiveContributions } from './passive';
import { allowanceShare, currentStudy, dormFor, loanRepaymentEstimate, monthlyAllowance, parentsStudySupport, programFor, tuitionPerTerm } from './study';
import { makeState } from './testUtils';
import type { GameState } from './types';
import { advanceWork, familyMoneyStressParts, monthlySpending, startJob } from './work';

/** A character in their last year of Grade 12 (science plan), born in May: month 0 of a year is May. */
function grade12(overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ birthMonth: 5, ageInMonths: 15 * 12, ...overrides });
  enroll(state, 'upper_secondary_science', state.ageInMonths);
  state.ageInMonths += 31; // December of the last year
  return state;
}

/** A student in the first month of a bachelor's degree at a place. */
function student(place: string, overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ birthMonth: 5, ageInMonths: 18 * 12, flags: [`study_${place}`, 'faculty_business'], ...overrides });
  enroll(state, 'bachelor_business', state.ageInMonths);
  return state;
}

/** Runs the money step month by month, like the game loop does. */
function months(state: GameState, count: number): GameState {
  for (let i = 0; i < count; i++) {
    state.ageInMonths += 1;
    advanceEducation(state);
    advanceWork(state);
  }
  return state;
}

const choose = (state: GameState, eventId: string, choiceId: string) => applyChoice(state, findEvent(eventId)!, choiceId, state.ageInMonths);

describe('D82: where a student lives', () => {
  it('a city place means a dorm in the city unless home is in the city; a regional one only from the countryside; the open university and the college from home', () => {
    const home = (regionId: 'city' | 'suburb' | 'rural') => ({ regionId, homeId: 'parents' as const });
    expect(dormFor('top_public', home('rural'))).toEqual({ regionId: 'city', homeId: 'dorm' });
    expect(dormFor('private', home('suburb'))).toEqual({ regionId: 'city', homeId: 'dorm' });
    expect(dormFor('top_public', home('city'))).toBeUndefined();
    expect(dormFor('regional', home('rural'))).toEqual({ regionId: 'rural', homeId: 'dorm' });
    expect(dormFor('regional', home('suburb'))).toBeUndefined();
    expect(dormFor('open', home('rural'))).toBeUndefined();
    expect(dormFor('vocational_college', home('rural'))).toBeUndefined();
  });

  it('moves into the dorm when the studies start and back home when they end; the way they were paid ends too', () => {
    const state = student('top_public', { residence: { regionId: 'rural', homeId: 'grandparents' } });
    state.money.study = { tuition: 'parents', livingLoan: false };
    months(state, 1);
    expect(state.residence).toEqual({ regionId: 'city', homeId: 'dorm' });
    months(state, 47);
    expect(currentStudy(state)).toBeUndefined();
    expect(state.education.history.at(-1)).toMatchObject({ program: 'bachelor_business', result: 'graduated' });
    months(state, 1);
    expect(state.residence).toEqual({ regionId: 'rural', homeId: 'grandparents' });
    expect(state.education.homeBeforeStudy).toBeUndefined();
    expect(state.money.study).toBeUndefined();
  });
});

describe('D82: what studying costs', () => {
  it('tuition per term by place, more for medicine, health and engineering', () => {
    expect(tuitionPerTerm('bachelor_business', 'top_public')).toBe(18000);
    expect(tuitionPerTerm('bachelor_medicine', 'top_public')).toBe(28800);
    expect(tuitionPerTerm('bachelor_business', 'private')).toBe(45000);
    expect(tuitionPerTerm('higher_vocational', 'vocational_college')).toBe(3000);
  });

  it('a dorm student pays the room and their own living; the parents send a share of it by Family wealth', () => {
    const state = student('top_public', { residence: { regionId: 'city', homeId: 'dorm' }, environment: { familyWealth: 50 } });
    const city = BALANCE.work.regionCostFactor.city;
    expect(monthlySpending(state)).toMatchObject({ dorm: Math.round(3500 * city), food: Math.round(4000 * city) });
    expect([allowanceShare(70), allowanceShare(50), allowanceShare(20)]).toEqual([1, 0.7, 0.4]);
    const living = Object.values(monthlySpending(state)).reduce((a, b) => a + b, 0);
    expect(monthlyAllowance(state)).toBe(Math.round(living * 0.7));
  });

  it('parents pay: no money of the character; the family feels it, unless the family is well off', () => {
    const state = student('top_public', { residence: { regionId: 'city', homeId: 'dorm' }, environment: { familyWealth: 50 } });
    state.money.study = { tuition: 'parents', livingLoan: false };
    const support = parentsStudySupport(state);
    expect(support).toBe(monthlyAllowance(state) + 18000 / 6);
    expect(familyMoneyStressParts(state).study).toBeCloseTo((support / 1000) * 5);
    state.environment.familyWealth = 65;
    expect(familyMoneyStressParts(state).study).toBe(0);
  });

  it('a student loan pays the tuition at the start of each term and 3,000 a month of living in a dorm; all of it is debt', () => {
    const state = student('regional', { residence: { regionId: 'rural', homeId: 'dorm' }, environment: { familyWealth: 30 } });
    state.money.study = { tuition: 'loan', livingLoan: true };
    state.ageInMonths -= 1; // the step below is the first month of the program
    months(state, 1);
    expect(state.money.studentLoan).toBe(10000 + 3000);
    months(state, 5);
    expect(state.money.studentLoan).toBe(10000 + 6 * 3000);
    months(state, 1);
    expect(state.money.studentLoan).toBe(2 * 10000 + 7 * 3000);
    expect(state.money.year.income['loan.living']).toBe(7 * 3000);
  });

  it('paying the tuition themselves: from the savings at the start of each term; what is missing is a shortfall', () => {
    const state = student('open', { environment: { familyWealth: 30 } });
    state.money.study = { tuition: 'self', livingLoan: false };
    state.money.cash = 1000;
    state.ageInMonths -= 1;
    months(state, 1);
    expect(state.money.cash).toBe(0);
    expect(state.money.shortfall).toBe(500);
    expect(state.money.year.spent['study.tuition']).toBe(1000);
    months(state, 1); // not a term start: nothing due
    expect(state.money.shortfall).toBe(0);
  });

  it('a student who lives at home with no job pays nothing themselves (the parents do)', () => {
    const state = student('regional', { residence: { regionId: 'suburb', homeId: 'parents' } });
    state.money.study = { tuition: 'parents', livingLoan: false };
    months(state, 3);
    expect(state.money.year.spent).toEqual({});
    startJob(state, 'cafe', 'weekend');
    expect(currentStudy(state)).toBeDefined(); // a part-time job goes on while studying
  });
});

describe('D82: from Grade 12 to a university place', () => {
  it('university → top public → engineering → passed → the parents pay → the program starts when Grade 12 ends', () => {
    const state = grade12({ skills: { academic: 44 }, environment: { familyWealth: 50 } });
    expect(isEligible(findEvent('edu_after_secondary')!, state)).toBe(true);
    choose(state, 'edu_after_secondary', 'university');
    choose(state, 'edu_choose_university', 'top_public');
    state.ageInMonths += 1; // January
    expect(isEligible(findEvent('edu_choose_faculty_science')!, state)).toBe(true);
    expect(isEligible(findEvent('edu_choose_faculty')!, state)).toBe(false);
    choose(state, 'edu_choose_faculty_science', 'engineering');
    state.ageInMonths += 2; // March: the results
    expect(isEligible(findEvent('edu_uni_top_public_pass')!, state)).toBe(true);
    applyEvent(state, findEvent('edu_uni_top_public_pass')!);
    state.ageInMonths += 1;
    expect(isEligible(findEvent('edu_uni_top_public_fail')!, state)).toBe(false);
    expect(isEligible(findEvent('edu_study_funding')!, state)).toBe(true);
    choose(state, 'edu_study_funding', 'parents');
    expect(state.education.next).toBe('bachelor_engineering');
    expect(state.money.study).toEqual({ tuition: 'parents', livingLoan: false });
    months(state, 1); // May: Grade 12 ends, the degree starts
    expect(currentStudy(state)).toEqual({ program: 'bachelor_engineering', place: 'top_public' });
  });

  it('the exam: academic 42.5 for a top public university, 3 less with admission prep; a fail in April offers the other ways', () => {
    const at = (academic: number, flags: string[] = []) => {
      const state = grade12({ skills: { academic }, flags: ['study_top_public', 'uni_applying', 'faculty_chosen', ...flags] });
      state.ageInMonths += 3;
      return state;
    };
    const pass = findEvent('edu_uni_top_public_pass')!;
    const passPrep = findEvent('edu_uni_top_public_pass_prep')!;
    expect([isEligible(pass, at(42.4)), isEligible(pass, at(42.5))]).toEqual([false, true]);
    expect([isEligible(passPrep, at(39.4, ['admission_prep'])), isEligible(passPrep, at(39.5, ['admission_prep']))]).toEqual([false, true]);
    const failed = at(30);
    failed.ageInMonths += 1;
    expect(isEligible(findEvent('edu_uni_top_public_fail')!, failed)).toBe(true);
    choose(failed, 'edu_uni_top_public_fail', 'gap_year');
    expect(failed.flags).toContain('gap_year');
    expect(failed.flags).not.toContain('faculty_chosen');
  });

  it('who can pay: the parents from wealth 40 (private 50), a student loan below 50, the savings with one term; declining is always possible', () => {
    const event = findEvent('edu_study_funding')!;
    const locked = (wealth: number, cash = 0) => {
      const state = makeState({ environment: { familyWealth: wealth } });
      state.money.cash = cash;
      return event.choices!.map((c) => lockReasons(c, state).length > 0);
    };
    expect(locked(39)).toEqual([true, false, true, false]);
    expect(locked(45)).toEqual([false, false, true, false]);
    expect(locked(50, 10000)).toEqual([false, true, false, false]);
    const priv = findEvent('edu_study_funding_private')!;
    const rich = makeState({ environment: { familyWealth: 49 } });
    expect(lockReasons(priv.choices![0]!, rich)).toHaveLength(1);
  });

  it('after a gap year a place won starts at the start of the school year', () => {
    const state = makeState({ birthMonth: 5, ageInMonths: 19 * 12 - 3, flags: ['study_regional', 'faculty_arts'] });
    state.education.next = programFor(state)!;
    advanceEducation(state); // February: waits
    expect(currentStudy(state)).toBeUndefined();
    state.ageInMonths += 3; // May
    advanceEducation(state);
    expect(currentStudy(state)).toEqual({ program: 'bachelor_arts', place: 'regional' });
  });

  it('after ปวช. the vocational college offers ปวส. without an exam', () => {
    const state = makeState({ birthMonth: 5, ageInMonths: 15 * 12 });
    enroll(state, 'vocational_mechanical', state.ageInMonths);
    state.ageInMonths += 31;
    choose(state, 'edu_after_vocational', 'higher_vocational');
    expect(isEligible(findEvent('edu_study_funding_cheap')!, state)).toBe(true);
    choose(state, 'edu_study_funding_cheap', 'parents');
    expect(state.education.next).toBe('higher_vocational');
  });

  it('a faculty teaches its skills, faster at a top university', () => {
    const state = student('top_public');
    const lines = computePassiveContributions(state).filter((c) => c.source.startsWith('study'));
    expect(lines.map((c) => c.source)).toEqual(['study.bachelor_business', 'studyPlace.top_public.learning', 'study.bachelor_business']);
  });
});

describe('D85: the student loan repayment estimate', () => {
  it('pays the debt back in 15 equal years at 1% (paying it year by year leaves nothing, give or take the rounding)', () => {
    const debt = 288_000;
    const { yearly, years } = loanRepaymentEstimate(debt)!;
    let left = debt;
    for (let year = 0; year < years; year++) left = left * 1.01 - yearly;
    expect(left).toBeLessThanOrEqual(0);
    expect(left).toBeGreaterThan(-years * 2);
  });

  it('no debt, no estimate', () => {
    expect(loanRepaymentEstimate(0)).toBeUndefined();
  });
});

