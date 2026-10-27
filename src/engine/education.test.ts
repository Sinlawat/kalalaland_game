import { describe, expect, it } from 'vitest';
import { EVENTS, findEvent, isEligible, parseEvents, applyChoice, type EventDef } from './events';
import {
  advanceEducation,
  applyEducationEffect,
  currentEnrollment,
  enroll,
  meetsEducationConditions,
  monthsInProgram,
  parsePrograms,
  PROGRAMS,
} from './education';
import { simulateWholeLife, type Chooser } from './game';
import { createNewLife } from './newLife';
import { createRng } from './rng';
import { makeState } from './testUtils';
import { lockReasons } from './events';
import { PROGRAM_IDS, SCHOOL_FLAGS, type GameState, type ProgramId } from './types';

/** Runs the education step month by month, like the game loop does. */
function age(state: GameState, months: number): GameState {
  for (let i = 0; i < months; i++) {
    state.ageInMonths += 1;
    advanceEducation(state);
  }
  return state;
}
const programs = (state: GameState) => state.education.history.map((e) => `${e.program}:${e.result ?? 'now'}`);

describe('programs.json (D74)', () => {
  it('has every program once, with a length', () => {
    expect(PROGRAMS.map((p) => p.id).sort()).toEqual([...PROGRAM_IDS].sort());
  });

  it('rejects bad data, listing every problem', () => {
    expect(() => parsePrograms([{ id: 'primary', level: 'primary', months: 0, then: 'college' }])).toThrow(/months[\s\S]*then[\s\S]*missing/);
  });
});

describe('education history (D74)', () => {
  const start = 6 * 12 + 4;
  const atSchoolStart = () => {
    const state = makeState({ ageInMonths: start });
    enroll(state, 'primary', start);
    return state;
  };

  it('Grade 1–6 runs 72 months, then Grade 7–9 starts the same month (compulsory)', () => {
    const state = age(atSchoolStart(), 71);
    expect(programs(state)).toEqual(['primary:now']);
    age(state, 1);
    expect(programs(state)).toEqual(['primary:graduated', 'lower_secondary:now']);
    expect(currentEnrollment(state)).toEqual({ program: 'lower_secondary', from: start + 72 });
  });

  it('after Grade 9 the chosen program starts; with none chosen, education ends', () => {
    const chosen = age(atSchoolStart(), 72 + 35);
    applyEducationEffect(chosen, { next: 'vocational_computer' }, chosen.ageInMonths);
    age(chosen, 1);
    expect(programs(chosen)).toEqual(['primary:graduated', 'lower_secondary:graduated', 'vocational_computer:now']);
    expect(chosen.education.next).toBeUndefined();

    const none = age(atSchoolStart(), 72 + 36);
    expect(programs(none)).toEqual(['primary:graduated', 'lower_secondary:graduated']);
    expect(currentEnrollment(none)).toBeUndefined();
    expect(monthsInProgram(none)).toBeUndefined();
  });

  it('switching plan in the same level keeps the months studied; the class still finishes together', () => {
    const state = makeState({ ageInMonths: 15 * 12, education: { history: [{ program: 'upper_secondary_science', from: 15 * 12 - 5 }] } });
    applyEducationEffect(state, { enroll: 'upper_secondary_arts_math' }, state.ageInMonths);
    expect(monthsInProgram(state)).toBe(5);
    expect(programs(state)).toEqual(['upper_secondary_science:switched', 'upper_secondary_arts_math:now']);
    age(state, 30);
    expect(programs(state).at(-1)).toBe('upper_secondary_arts_math:now');
    age(state, 1);
    expect(programs(state).at(-1)).toBe('upper_secondary_arts_math:graduated');
  });

  it('a program of another level starts from zero', () => {
    const state = makeState({ ageInMonths: 20 * 12, education: { history: [{ program: 'lower_secondary', from: 12 * 12, to: 15 * 12, result: 'graduated' }] } });
    applyEducationEffect(state, { enroll: 'non_formal' }, state.ageInMonths);
    expect(monthsInProgram(state)).toBe(0);
  });

  it('leaving ends the program as "left" and forgets the program chosen to follow', () => {
    const state = makeState({ ageInMonths: 16 * 12, education: { history: [{ program: 'vocational_mechanical', from: 15 * 12 }], next: 'non_formal' } });
    applyEducationEffect(state, { leave: true }, state.ageInMonths);
    expect(programs(state)).toEqual(['vocational_mechanical:left']);
    expect(state.education.next).toBeUndefined();
    age(state, 60);
    expect(currentEnrollment(state)).toBeUndefined();
  });

  it('conditions: enrolled, current, months in, finished or not', () => {
    const state = makeState({
      ageInMonths: 16 * 12,
      education: {
        history: [
          { program: 'lower_secondary', from: 12 * 12, to: 15 * 12, result: 'graduated' },
          { program: 'upper_secondary_science', from: 15 * 12 },
        ],
      },
    });
    const meets = (c: Parameters<typeof meetsEducationConditions>[1]) => meetsEducationConditions(state, c);
    expect(meets({ enrolled: true, current: ['upper_secondary_science'], monthsIn: { min: 12, max: 12 } })).toBe(true);
    expect(meets({ monthsIn: { min: 13 } })).toBe(false);
    expect(meets({ monthsIn: { max: 11 } })).toBe(false);
    expect(meets({ enrolled: false })).toBe(false);
    expect(meets({ current: ['vocational_computer'] })).toBe(false);
    expect(meets({ completed: ['lower_secondary'], notCompleted: ['upper_secondary_science'] })).toBe(true);
    expect(meets({ completed: ['primary'] })).toBe(false);
    const out = makeState({ ageInMonths: 16 * 12 });
    expect(meetsEducationConditions(out, { monthsIn: { min: 0 } })).toBe(false);
    expect(meetsEducationConditions(out, { enrolled: false })).toBe(true);
  });
});

describe('education in events.json (validation)', () => {
  const base = { id: 'x', frequency: 'normal', once: true, conditions: { ageMin: 10, ageMax: 20 }, effects: {} };
  it.each([
    ['an unknown program to start', { effects: { education: { enroll: 'university' } } }, /effects.education.enroll/],
    ['leave that is not true', { effects: { education: { leave: false } } }, /leave must be true/],
    ['an empty education effect', { effects: { education: {} } }, /at least one of enroll/],
    ['an unknown program to be in', { conditions: { ageMin: 10, ageMax: 20, education: { current: ['college'] } } }, /education.current/],
    ['months in with no program', { conditions: { ageMin: 10, ageMax: 20, education: { enrolled: false, monthsIn: { min: 1 } } } }, /cannot go with enrolled: false/],
    ['a range upside down', { conditions: { ageMin: 10, ageMax: 20, education: { monthsIn: { min: 5, max: 2 } } } }, /min is above max/],
  ])('rejects %s', (_label, change, message) => {
    expect(() => parseEvents([{ ...base, ...change }])).toThrow(message);
  });

  it('a repeatable guaranteed event needs a cooldown (otherwise it would happen every month)', () => {
    expect(() => parseEvents([{ ...base, frequency: 'guaranteed', once: false }])).toThrow(/guaranteed event must be once, or repeatable with cooldownMonths/);
    expect(() => parseEvents([{ ...base, frequency: 'guaranteed', once: false, cooldownMonths: 12 }])).not.toThrow();
  });
});

describe('real lives: paths after Grade 9 (D74)', () => {
  const rng = createRng(4242);
  const randomChoice: Chooser = (state, event) => {
    const open = event.choices!.filter((c) => lockReasons(c, state).length === 0);
    return open[rng.int(0, open.length - 1)]!.id;
  };
  const first = Array.from({ length: 200 }, (_, seed) => simulateWholeLife(createNewLife(seed)));
  const random = Array.from({ length: 400 }, (_, seed) => simulateWholeLife(createNewLife(50_000 + seed), { chooser: randomChoice }));
  const grown = (lives: GameState[]) => lives.filter((end) => end.ageInMonths >= 19 * 12);
  const path = (end: GameState) => end.eventHistory.find((r) => r.id === 'edu_m3_path')?.choiceId;
  const has = (end: GameState, program: ProgramId, result?: string) =>
    end.education.history.some((e) => e.program === program && (result === undefined || e.result === result));

  it('everyone who reaches 19 finished Grades 1–9, and chose a path once, in February of Grade 9', () => {
    for (const end of grown([...first, ...random])) {
      expect(has(end, 'primary', 'graduated') && has(end, 'lower_secondary', 'graduated')).toBe(true);
      const records = end.eventHistory.filter((r) => r.id === 'edu_m3_path');
      expect(records).toHaveLength(1);
      const lower = end.education.history.find((e) => e.program === 'lower_secondary')!;
      expect(records[0]!.ageInMonths - lower.from).toBe(33);
    }
  });

  it('the plan or major chosen in Grade 9 is what the character studies from Grade 10', () => {
    for (const end of grown(random)) {
      const plan = end.eventHistory.find((r) => r.id === 'edu_m4_plan' || r.id === 'edu_vocational_major');
      const lower = end.education.history.findIndex((e) => e.program === 'lower_secondary');
      const after = end.education.history[lower + 1];
      if (plan === undefined) {
        // No plan: out of school after Grade 9 (a worker may go back to non-formal classes later).
        if (after !== undefined) expect(after.program).toBe('non_formal');
        continue;
      }
      const expected = plan.id === 'edu_m4_plan' ? `upper_secondary_${plan.choiceId}` : `vocational_${plan.choiceId}`;
      expect(after?.program).toBe(expected);
    }
  });

  it('all three paths happen; a worker leaves school (no school flag), a college student is in the college', () => {
    const counts = { upper: 0, vocational: 0, work: 0 };
    for (const end of grown(random)) {
      const chosen = path(end)!;
      counts[chosen as keyof typeof counts] += 1;
      const schools = end.flags.filter((flag) => SCHOOL_FLAGS.includes(flag));
      if (end.flags.includes('working')) expect(schools).toEqual([]);
      if (end.eventHistory.some((r) => r.id === 'edu_vocational_first_day') && !end.flags.includes('working')) {
        expect(schools).toEqual(['school_vocational']);
      }
    }
    expect(counts.upper).toBeGreaterThan(0);
    expect(counts.vocational).toBeGreaterThan(0);
    expect(counts.work).toBeGreaterThan(0);
  });

  it('leaving Grade 9 to work, or quitting college, leads to a first job; nobody else gets one', () => {
    for (const end of grown(random)) {
      const job = end.eventHistory.some((r) => r.id === 'work_teen_first_job');
      const quit = end.eventHistory.some((r) => r.id === 'edu_wrong_track_vocational' && r.choiceId === 'quit');
      expect(job).toBe(end.flags.includes('plan_work') || quit);
    }
  });

  it('the class parts ways in March of the final year, both at school and at college', () => {
    const graduations = grown([...first, ...random]).flatMap((end) =>
      end.eventHistory.filter((r) => r.id === 'social_graduation' || r.id === 'social_graduation_best_friend').map((r) => ({ end, r })),
    );
    expect(graduations.length).toBeGreaterThan(0);
    const levels = new Set<string>();
    for (const { end, r } of graduations) {
      const enrollment = end.education.history.find((e) => e.from <= r.ageInMonths && (e.to === undefined || e.to > r.ageInMonths))!;
      expect(r.ageInMonths - enrollment.from + (enrollment.credit ?? 0)).toBe(34);
      levels.add(enrollment.program.split('_')[0]!);
    }
    expect([...levels].sort()).toEqual(['upper', 'vocational']);
  });

  it('the first chooser goes to Grade 10 in the science plan when the grades allow it, otherwise arts-math', () => {
    for (const end of grown(first)) {
      expect(path(end)).toBe('upper');
      const plan = end.eventHistory.find((r) => r.id === 'edu_m4_plan')!;
      expect(['science', 'arts_math']).toContain(plan.choiceId);
    }
  });
});

describe('the end of a try at a new habit (D74 lifestyle events)', () => {
  const kept = findEvent('life_resolution_exercise_kept')!;
  const dropped = findEvent('life_resolution_exercise_dropped')!;
  const trying = (discipline: number, monthsAgo: number) =>
    makeState({
      ageInMonths: 30 * 12,
      traits: { discipline },
      flags: ['trying_exercise'],
      eventHistory: [{ id: 'life_resolution_exercise', ageInMonths: 30 * 12 - monthsAgo, choiceId: 'start' }],
    });

  it('three months later, discipline decides: kept at 53 or more, dropped below', () => {
    expect(isEligible(kept, trying(53, 3))).toBe(true);
    expect(isEligible(dropped, trying(53, 3))).toBe(false);
    expect(isEligible(dropped, trying(52.9, 3))).toBe(true);
    expect(isEligible(kept, trying(53, 2))).toBe(false);
  });

  it('starting a try gives three months of regular exercise; every failure adds a little discipline', () => {
    const state = makeState({ ageInMonths: 30 * 12, habits: { exercise: 'light' } });
    applyChoice(state, findEvent('life_resolution_exercise')! as EventDef, 'start', state.ageInMonths);
    expect(state.habits.exercise).toBe('regular');
    expect(state.habitTimers.exercise).toEqual({ revertTo: 'light', untilMonth: 30 * 12 + 3 });
    expect(dropped.effects?.traits?.discipline).toBe(1);
  });

  it('every lifestyle try ends in exactly one of its two endings', () => {
    for (const end of EVENTS.filter((e) => e.id.startsWith('life_resolution_') && e.choices)) {
      expect(findEvent(`${end.id}_kept`)).toBeDefined();
      expect(findEvent(`${end.id}_dropped`)).toBeDefined();
    }
  });
});

