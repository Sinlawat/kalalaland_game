/**
 * Studying after Grade 12 / ปวช. (D82): university and ปวส.
 *
 * Like school (D66, D74), the program is what the character studies and a
 * flag is where: `study_<place>` (top public university, regional or
 * Rajabhat university, private, open university, vocational college). The
 * faculty chosen is the flag `faculty_<id>`; once admitted and the tuition
 * is settled, the program for that faculty waits in `education.next`.
 *
 * Rules the engine keeps, whatever the content does:
 * - a place in the city (top public, private) means moving into a dorm for
 *   a character who does not live in the city; a regional university means
 *   a dorm only for a character from the countryside; the open university
 *   and the vocational college are studied from home. The character moves
 *   back home when those studies end;
 * - the tuition is due at the start of each term, paid by whoever was chosen
 *   (the parents, a student loan, or the character's savings);
 * - a student in a dorm pays the dorm and their own living; the parents send
 *   a share of it (by Family wealth), and a student loan adds a monthly
 *   living allowance.
 *
 * Functions that change the state MUTATE it (engine-private copy, like the
 * rest of the engine); the read helpers never do.
 */

import { BALANCE } from '../data/balance';
import { currentEnrollment, monthsInProgram, programDef } from './education';
import { STUDY_PLACES, type GameState, type ProgramId, type Residence, type SpendingLevel, type StudyFunding, type StudyPlace } from './types';

const S = BALANCE.study;

/** The faculties of a bachelor's degree, as `faculty_<id>` flags (program `bachelor_<id>`). */
export const FACULTIES = ['medicine', 'health', 'engineering', 'business', 'education', 'humanities', 'arts'] as const;
export type Faculty = (typeof FACULTIES)[number];

/** The categories of living in a dorm (BALANCE.study.dormLiving). */
export const DORM_CATEGORIES = ['dorm', 'food', 'transport', 'phone', 'leisure'] as const;
export type DormCategory = (typeof DORM_CATEGORIES)[number];

// ── Reading ─────────────────────────────────────────────────────────────────

/** Studies after Grade 12 / ปวช.: ปวส. or a bachelor's degree. */
export function isHigherEducation(program: ProgramId): boolean {
  const { level } = programDef(program);
  return level === 'higher_vocational' || level === 'bachelor';
}

/** Where the character studies (or applies to study) after Grade 12, from the `study_<place>` flag. */
export function studyPlace(state: Pick<GameState, 'flags'>): StudyPlace | undefined {
  return STUDY_PLACES.find((place) => state.flags.includes(`study_${place}`));
}

export interface CurrentStudy {
  program: ProgramId;
  place: StudyPlace;
}

/** What and where the character studies now after Grade 12; undefined when not. */
export function currentStudy(state: Pick<GameState, 'education' | 'flags'>): CurrentStudy | undefined {
  const current = currentEnrollment(state);
  if (current === undefined || !isHigherEducation(current.program)) return undefined;
  const place = studyPlace(state) ?? (current.program === 'higher_vocational' ? 'vocational_college' : 'regional');
  return { program: current.program, place };
}

/** Studying after Grade 12 and living in a dorm for it. */
export function livesInDorm(state: Pick<GameState, 'education' | 'flags' | 'residence'>): boolean {
  return state.residence.homeId === 'dorm' && currentStudy(state) !== undefined;
}

/** Where a student of this place lives: a dorm, or undefined for "stays at home". */
export function dormFor(place: StudyPlace, home: Residence): Residence | undefined {
  if (S.fromHome.includes(place)) return undefined;
  if (S.inCity.includes(place)) return home.regionId === 'city' ? undefined : { regionId: 'city', homeId: 'dorm' };
  return home.regionId === 'rural' ? { regionId: 'rural', homeId: 'dorm' } : undefined;
}

/** Tuition for one term of this program at this place. */
export function tuitionPerTerm(program: ProgramId, place: StudyPlace): number {
  const factor = (S.tuitionFactor as Partial<Record<ProgramId, number>>)[program] ?? 1;
  return Math.round(S.tuitionPerTerm[place] * factor);
}

/** The first month of a term: the tuition is due. */
export function isTermStart(state: Pick<GameState, 'education' | 'flags' | 'ageInMonths'>): boolean {
  return currentStudy(state) !== undefined && (monthsInProgram(state) ?? 0) % S.termMonths === 0;
}

/** Living in a dorm for a month, by category, in the area the dorm is in, at a spending level. */
export function dormLiving(state: Pick<GameState, 'residence'>, level: SpendingLevel): Record<DormCategory, number> {
  const area = BALANCE.work.regionCostFactor[state.residence.regionId];
  const spend = BALANCE.work.spendingLevels[level].factor;
  const result = {} as Record<DormCategory, number>;
  // The room costs what it costs; spending less is about food, travel and outings.
  for (const category of DORM_CATEGORIES) result[category] = Math.round(S.dormLiving[category] * area * (category === 'dorm' ? 1 : spend));
  return result;
}

function total(amounts: Record<string, number>): number {
  return Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
}

/** The share of dorm living the parents send, by Family wealth. */
export function allowanceShare(familyWealth: number): number {
  return S.allowanceShare.find((band) => familyWealth >= band.wealthFrom)?.share ?? 0;
}

/** What the parents send each month to a student in a dorm (a share of living at the normal level). */
export function monthlyAllowance(state: Pick<GameState, 'education' | 'flags' | 'residence' | 'environment'>): number {
  if (!livesInDorm(state)) return 0;
  return Math.round(total(dormLiving(state, 'normal')) * allowanceShare(state.environment.familyWealth));
}

/** The student loan's living allowance this month (a student in a dorm who took the loan). */
export function loanLiving(state: Pick<GameState, 'education' | 'flags' | 'residence' | 'money'>): number {
  return livesInDorm(state) && state.money.study?.livingLoan === true ? S.loanLivingPerMonth : 0;
}

/**
 * What the parents pay for the studies, as a monthly average: the allowance,
 * and the tuition spread over the term when they pay it (it weighs on the
 * family's money stress).
 */
export function parentsStudySupport(state: Pick<GameState, 'education' | 'flags' | 'residence' | 'environment' | 'money'>): number {
  const study = currentStudy(state);
  if (study === undefined) return 0;
  const tuition = state.money.study?.tuition === 'parents' ? tuitionPerTerm(study.program, study.place) / S.termMonths : 0;
  return monthlyAllowance(state) + tuition;
}

/** The program a place won leads to: ปวส. at the vocational college, otherwise the faculty chosen. */
export function programFor(state: Pick<GameState, 'flags'>): ProgramId | undefined {
  if (studyPlace(state) === 'vocational_college') return 'higher_vocational';
  const faculty = FACULTIES.find((id) => state.flags.includes(`faculty_${id}`));
  return faculty === undefined ? undefined : `bachelor_${faculty}`;
}

// ── Changing ────────────────────────────────────────────────────────────────

/**
 * events.json `effects.study`: the tuition is settled (who pays), and the
 * program for the place and faculty is set to start: when the current
 * program ends, or at the start of the school year when not studying.
 */
export function applyStudyFunding(state: GameState, funding: StudyFunding): void {
  state.money.study = { tuition: funding, livingLoan: funding === 'loan' };
  const program = programFor(state);
  if (program !== undefined) state.education.next = program;
}

/**
 * Monthly step (before the money): a student whose place is far away moves
 * into a dorm when the studies start, and back home when they end. Studies
 * that ended also end the way they were paid for.
 */
export function syncStudyHome(state: GameState): void {
  const study = currentStudy(state);
  const before = state.education.homeBeforeStudy;
  if (study !== undefined && before === undefined) {
    const dorm = dormFor(study.place, state.residence);
    if (dorm !== undefined) {
      state.education.homeBeforeStudy = { ...state.residence };
      state.residence = dorm;
    }
  } else if (study === undefined && before !== undefined) {
    state.residence = before;
    delete state.education.homeBeforeStudy;
  }
  const last = state.education.history.at(-1);
  if (study === undefined && state.money.study !== undefined && last !== undefined && last.to !== undefined && isHigherEducation(last.program)) {
    delete state.money.study;
  }
}
