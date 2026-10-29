/**
 * D86: running short of money. The question comes back every 6 months; a
 * choice that would change nothing is locked; there are real ways out
 * (more shifts, the student loan's living allowance); and the months short
 * cost a little health.
 */

import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { enroll } from './education';
import { applyChoice, findEvent, isEligible, lockReasons } from './events';
import { computePassiveContributions } from './passive';
import { canTakeLivingLoan, loanLiving, monthlyAllowance } from './study';
import { makeState } from './testUtils';
import type { GameState } from './types';
import { advanceWork, currentJob, startJob } from './work';

/** A second-year student in a city dorm (born in May), short of money last month. */
function shortStudent(wealth: number, overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ birthMonth: 5, ageInMonths: 20 * 12, flags: ['study_top_public', 'faculty_business'], residence: { regionId: 'city', homeId: 'dorm' }, environment: { familyWealth: wealth }, ...overrides });
  enroll(state, 'bachelor_business', 19 * 12);
  state.education.homeBeforeStudy = { regionId: 'rural', homeId: 'parents' };
  state.money.study = { tuition: 'self', livingLoan: false };
  state.money.shortfall = 1500;
  return state;
}

const open = (state: GameState, eventId: string) =>
  findEvent(eventId)!.choices!.filter((c) => lockReasons(c, state).length === 0).map((c) => c.id);

describe('D86: the choices that change nothing are locked', () => {
  it('already frugal and giving nothing to the family: those two are locked; enduring is always open', () => {
    const state = shortStudent(30);
    startJob(state, 'cafe', 'weekend');
    state.money.spendingLevel = 'frugal';
    state.money.familySharePercent = 0;
    expect(open(state, 'money_short')).toEqual(['more_shifts', 'living_loan', 'endure']);
    state.money.spendingLevel = 'normal';
    state.money.familySharePercent = 10;
    expect(open(state, 'money_short')).toEqual(['frugal', 'give_less', 'more_shifts', 'living_loan', 'endure']);
  });

  it('more shifts only for a weekend job; the living loan only below the wealth line, in a dorm, not taken yet', () => {
    const full = shortStudent(55);
    full.education = { history: [] };
    full.residence = { regionId: 'city', homeId: 'parents' };
    startJob(full, 'convenience_store', 'full_time');
    expect(open(full, 'money_short')).toEqual(['frugal', 'ask_parents', 'endure']);
    const rich = shortStudent(55);
    expect(canTakeLivingLoan(rich)).toBe(false);
    const loaned = shortStudent(30);
    loaned.money.study = { tuition: 'loan', livingLoan: true };
    expect(canTakeLivingLoan(loaned)).toBe(false);
  });
});

describe('D86: the ways out', () => {
  it('more shifts: the weekend job becomes every evening', () => {
    const state = shortStudent(30);
    startJob(state, 'cafe', 'weekend');
    applyChoice(state, findEvent('money_short')!, 'more_shifts', state.ageInMonths);
    expect(currentJob(state)).toMatchObject({ job: 'cafe', level: 'daily' });
  });

  it('the living loan: 3,000 a month from next month, added to the debt', () => {
    const state = shortStudent(30);
    applyChoice(state, findEvent('money_short_student')!, 'living_loan', state.ageInMonths);
    expect(loanLiving(state)).toBe(BALANCE.study.loanLivingPerMonth);
    const debt = state.money.studentLoan;
    state.ageInMonths += 1;
    advanceWork(state);
    expect(state.money.studentLoan).toBe(debt + BALANCE.study.loanLivingPerMonth);
  });

  it('parents who pay the tuition pay the living in full; a family on the loan sends its share', () => {
    const parents = shortStudent(45);
    parents.money.study = { tuition: 'parents', livingLoan: false };
    const loan = shortStudent(45);
    loan.money.study = { tuition: 'loan', livingLoan: true };
    expect(monthlyAllowance(parents)).toBe(11625);
    expect(monthlyAllowance(loan)).toBe(Math.round(11625 * 0.7));
  });
});

describe('D86: the question every 6 months, and what the months short cost', () => {
  it('comes back 6 months after it was asked, not 3', () => {
    const state = shortStudent(30);
    applyChoice(state, findEvent('money_short_student')!, 'endure', state.ageInMonths);
    state.ageInMonths += 5;
    expect(isEligible(findEvent('money_short_student')!, state)).toBe(false);
    state.ageInMonths += 1;
    expect(isEligible(findEvent('money_short_student')!, state)).toBe(true);
  });

  it('a month short lowers mental and physical health a little (named "money short" in the breakdown); a month paid does not', () => {
    const state = shortStudent(30);
    const short = computePassiveContributions(state).filter((c) => c.source === 'money.short');
    expect(short.map((c) => c.target).sort()).toEqual(['mentalHealth', 'physicalHealth']);
    expect(short.every((c) => c.amount < 0)).toBe(true);
    state.money.shortfall = 0;
    expect(computePassiveContributions(state).filter((c) => c.source === 'money.short')).toEqual([]);
  });
});
