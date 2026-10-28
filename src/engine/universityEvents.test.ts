/**
 * D82 phase 2a: life at university, as events. The rules the data must keep
 * whatever the numbers are tuned to: who can get each event, and the pairs
 * and series of events that must never overlap or leave a gap.
 */

import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { advanceEducation, enroll } from './education';
import { applyChoice, applyEvent, findEvent, isEligible, lifetimeRoll, lockReasons } from './events';
import { computePassiveContributions } from './passive';
import { makeState } from './testUtils';
import type { GameState } from './types';
import { advanceWork, currentJob, monthlyWage, startJob } from './work';

/** A student `monthsIn` months into a bachelor's degree at a place (born in May). */
function student(place: string, monthsIn = 0, overrides: Parameters<typeof makeState>[0] = {}): GameState {
  const state = makeState({ birthMonth: 5, ageInMonths: 18 * 12, flags: [`study_${place}`, 'faculty_business'], ...overrides });
  enroll(state, 'bachelor_business', state.ageInMonths);
  state.ageInMonths += monthsIn;
  return state;
}

const eligible = (state: GameState, id: string) => isEligible(findEvent(id)!, state);
const choose = (state: GameState, eventId: string, choiceId: string) => applyChoice(state, findEvent(eventId)!, choiceId, state.ageInMonths);

describe('D82 phase 2a: on campus', () => {
  it('events of campus life need a campus: a student of the open university, at home, never gets them', () => {
    const campus = student('regional', 6);
    const open = student('open', 6);
    expect(eligible(campus, 'social_uni_new_best_friend')).toBe(true);
    expect(eligible(open, 'social_uni_new_best_friend')).toBe(false);
    expect(eligible(open, 'edu_uni_found_passion')).toBe(false);
  });

  it('the first month in a dorm is an event (the move used to happen without a word); living at home it is not', () => {
    const dorm = student('top_public', 0, { residence: { regionId: 'city', homeId: 'dorm' } });
    const home = student('top_public', 0, { residence: { regionId: 'city', homeId: 'parents' } });
    expect(eligible(dorm, 'life_move_into_dorm')).toBe(true);
    expect(eligible(home, 'life_move_into_dorm')).toBe(false);
    dorm.ageInMonths += 2;
    expect(eligible(dorm, 'life_move_into_dorm')).toBe(false);
  });

  it('friends made at university are tagged "uni"; a fight with the best friend from university needs that tag', () => {
    const state = student('regional', 6);
    const person = { id: 7, nickname: 'n7', sex: 'male' as const, ageGapMonths: 0, metVia: 'social_uni_new_best_friend', tags: [], periods: [] };
    applyChoice(state, findEvent('social_uni_new_best_friend')!, 'best', state.ageInMonths, person);
    expect(state.people.at(-1)!.tags).toEqual(['uni']);
    expect(eligible(state, 'social_uni_fell_out')).toBe(true);
    state.people.at(-1)!.tags = [];
    expect(eligible(state, 'social_uni_fell_out')).toBe(false);
  });
});

describe('D82 phase 2a: money short (no overlap, no gap)', () => {
  /** Every month the savings fell short gets exactly one of the two events: with a job or without. */
  it.each([
    ['a student in a dorm without a job', 'top_public', false, 'money_short_student'],
    ['a student in a dorm with a job', 'top_public', true, 'money_short'],
    ['a student at home paying their own tuition, without a job', 'open', false, 'money_short_student'],
  ])('%s gets %s', (_, place, employed, expected) => {
    const state = student(place, 6);
    if (employed) startJob(state, 'cafe', 'weekend');
    state.money.shortfall = 800;
    const both = ['money_short', 'money_short_student'].filter((id) => eligible(state, id));
    expect(both).toEqual([expected === 'money_short' ? 'money_short' : 'money_short_student']);
    state.money.shortfall = 0;
    expect(['money_short', 'money_short_student'].filter((id) => eligible(state, id))).toEqual([]);
  });

  it('a student with no job and no money in a dorm runs short, and the event offers work', () => {
    const state = student('top_public', 0, { residence: { regionId: 'rural', homeId: 'parents' }, environment: { familyWealth: 20 } });
    state.money.study = { tuition: 'parents', livingLoan: false };
    state.money.cash = 0;
    for (let i = 0; i < 2; i++) {
      state.ageInMonths += 1;
      advanceEducation(state);
      advanceWork(state);
    }
    expect(state.residence.homeId).toBe('dorm');
    expect(state.money.shortfall).toBeGreaterThan(0);
    expect(eligible(state, 'money_short_student')).toBe(true);
    choose(state, 'money_short_student', 'weekend');
    expect(currentJob(state)).toMatchObject({ job: 'cafe', level: 'weekend' });
  });
});

describe('D82 phase 2a: the competition has exactly one result', () => {
  const RESULTS = ['edu_uni_competition_win', 'edu_uni_competition_win_underdog', 'edu_uni_competition_lose'];

  /** A student who joined the competition at month 24 of their studies; `academic` at the time of the result. */
  function joined(seed: number, academic: number): GameState {
    const state = student('regional', 24, { seed, skills: { academic } });
    choose(state, 'edu_uni_competition', 'join');
    return state;
  }

  /** Runs months 1–5 after joining; applies each result the month it can happen. Returns the results that happened. */
  function play(state: GameState, academicLater?: number): string[] {
    const happened: string[] = [];
    for (let month = 1; month <= 5; month++) {
      state.ageInMonths += 1;
      if (month === 3 && academicLater !== undefined) state.skills.academic = academicLater;
      const now = RESULTS.filter((id) => eligible(state, id));
      expect(now.length, `month ${month}`).toBeLessThanOrEqual(1);
      for (const id of now) {
        applyEvent(state, findEvent(id)!);
        happened.push(id);
      }
    }
    return happened;
  }

  it.each([
    ['a strong student', 60],
    ['a weaker student', 30],
  ])('%s: one result for every life, never two (200 lives)', (_, academic) => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = joined(seed, academic);
      expect(play(state)).toHaveLength(1);
      expect(state.flags).not.toContain('in_competition');
    }
  });

  it('wins 70% of the lives with academic skill at the line (46) or above, 30% below it, decided once per life', () => {
    const wins = (academic: number) => {
      let count = 0;
      for (let seed = 1; seed <= 2000; seed++) if (play(joined(seed, academic)).some((id) => id !== 'edu_uni_competition_lose')) count += 1;
      return count / 2000;
    };
    expect(wins(46)).toBeCloseTo(0.7, 1);
    expect(wins(45.9)).toBeCloseTo(0.3, 1);
    // The roll is the life's: the same seed always gives the same result.
    expect(lifetimeRoll(5, 'edu_uni_competition_win')).toBe(lifetimeRoll(5, 'edu_uni_competition_win'));
  });

  it('a win can only come 2 months after joining: a skill that rises later does not bring a second result', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const result = play(joined(seed, 30), 70);
      expect(result).toHaveLength(1);
    }
  });

  it('skipping the competition gives no result at all', () => {
    const state = student('regional', 24);
    choose(state, 'edu_uni_competition', 'skip');
    state.ageInMonths += 2;
    expect(RESULTS.filter((id) => eligible(state, id))).toEqual([]);
    state.ageInMonths += 1;
    expect(RESULTS.filter((id) => eligible(state, id))).toEqual([]);
  });
});

describe('D82 phase 2a: internship', () => {
  it('the famous company needs good grades and either 6,000 baht of savings or a family who can pay the room', () => {
    const offer = findEvent('edu_uni_internship_offer')!;
    const choice = (id: string) => offer.choices!.find((c) => c.id === id)!;
    const weak = student('regional', 24, { skills: { academic: 41 }, environment: { familyWealth: 80 } });
    weak.money.cash = 10_000;
    expect(lockReasons(choice('famous_self'), weak)).not.toEqual([]);
    expect(lockReasons(choice('famous_family'), weak)).not.toEqual([]);
    const poor = student('regional', 24, { skills: { academic: 50 }, environment: { familyWealth: 30 } });
    poor.money.cash = 1_000;
    expect(lockReasons(choice('famous_self'), poor)).not.toEqual([]);
    expect(lockReasons(choice('famous_family'), poor)).not.toEqual([]);
    expect(lockReasons(choice('local'), poor)).toEqual([]);
    poor.money.cash = 6_000;
    expect(lockReasons(choice('famous_self'), poor)).toEqual([]);
  });

  it('comes in month 24 of a bachelor\'s degree (not medicine) and its follow-up a month after the choice', () => {
    const state = student('regional', 24);
    expect(eligible(state, 'edu_uni_internship_offer')).toBe(true);
    choose(state, 'edu_uni_internship_offer', 'local');
    expect(eligible(state, 'edu_uni_internship_local')).toBe(false);
    state.ageInMonths += 1;
    expect(eligible(state, 'edu_uni_internship_local')).toBe(true);
    expect(eligible(state, 'edu_uni_internship_famous')).toBe(false);

    const medicine = makeState({ birthMonth: 5, ageInMonths: 18 * 12, flags: ['study_top_public', 'faculty_medicine'] });
    enroll(medicine, 'bachelor_medicine', medicine.ageInMonths);
    medicine.ageInMonths += 24;
    expect(eligible(medicine, 'edu_uni_internship_offer')).toBe(false);
  });
});

describe('D82 phase 2a: leaving and finishing', () => {
  it('quitting ends the studies, moves the student home from the dorm and starts the search for a first job', () => {
    const state = student('top_public', 12, { residence: { regionId: 'rural', homeId: 'parents' }, condition: { mentalHealth: 30 } });
    state.money.study = { tuition: 'parents', livingLoan: false };
    advanceWork(state);
    expect(state.residence.homeId).toBe('dorm');
    expect(eligible(state, 'edu_uni_dropout_thought')).toBe(true);
    choose(state, 'edu_uni_dropout_thought', 'quit');
    state.ageInMonths += 1;
    advanceEducation(state);
    advanceWork(state);
    expect(state.residence).toEqual({ regionId: 'rural', homeId: 'parents' });
    expect(eligible(state, 'work_first_job_after_school')).toBe(true);
  });

  it('the graduation ceremony follows a finished bachelor\'s degree, not one left unfinished', () => {
    const graduate = student('regional', 0);
    for (let i = 0; i < 48; i++) {
      graduate.ageInMonths += 1;
      advanceEducation(graduate);
    }
    expect(graduate.education.history.at(-1)).toMatchObject({ result: 'graduated' });
    expect(eligible(graduate, 'edu_graduation_ceremony')).toBe(true);

    const left = student('regional', 12, { condition: { mentalHealth: 30 } });
    choose(left, 'edu_uni_dropout_thought', 'quit');
    left.ageInMonths += 1;
    expect(eligible(left, 'edu_graduation_ceremony')).toBe(false);
  });
});

describe('D82 phase 2a: tutoring', () => {
  it('pays about 150 baht an hour on weekends (estimate), and teaches the academic and communication skills', () => {
    expect(monthlyWage('tutor', 'weekend', 'city')).toBe(Math.round(150 * BALANCE.work.hoursPerMonth.weekend));
    const state = student('regional', 6, { skills: { academic: 50 } });
    expect(eligible(state, 'work_tutor_offer')).toBe(true);
    choose(state, 'work_tutor_offer', 'tutor');
    expect(currentJob(state)).toMatchObject({ job: 'tutor', level: 'weekend' });
    const sources = computePassiveContributions(state).filter((c) => c.source === 'work.tutor').map((c) => c.target);
    expect(sources.sort()).toEqual(['academic', 'communication']);
  });

  it('is offered only to a student with good grades and no job yet', () => {
    expect(eligible(student('regional', 6, { skills: { academic: 44 } }), 'work_tutor_offer')).toBe(false);
    const working = student('regional', 6, { skills: { academic: 50 } });
    startJob(working, 'cafe', 'weekend');
    expect(eligible(working, 'work_tutor_offer')).toBe(false);
  });
});
