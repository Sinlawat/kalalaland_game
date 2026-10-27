/**
 * D74: what the screen says about the character's education, computed from
 * the facts in `state.education` (and the school flag for where). Pure
 * functions, unit-tested directly.
 */

import { currentEnrollment, monthsInProgram, programDef } from '../engine/education';
import { currentSchool } from '../engine/passive';
import type { EnrollmentResult, GameState } from '../engine/types';
import { t } from '../i18n/i18n';

type EducationSource = Pick<GameState, 'education' | 'ageInMonths' | 'flags'>;

/** "ป.3", "ม.5 แผนวิทย์-คณิต", "ปวช. ปี 2 ช่างไฟฟ้า", "กศน." — the class the character is in now. */
function currentClass(state: EducationSource): string | undefined {
  const current = currentEnrollment(state);
  if (current === undefined) return undefined;
  const year = Math.floor((monthsInProgram(state) ?? 0) / 12) + 1;
  const { level } = programDef(current.program);
  switch (level) {
    case 'primary':
      return t('education.grade.primary', { year });
    case 'lower_secondary':
      return t('education.grade.lower', { year });
    case 'upper_secondary':
      return t('education.grade.upper', { year: year + 3, plan: t(`education.short.${current.program}`) });
    case 'vocational':
      return t('education.grade.vocational', { year, major: t(`education.short.${current.program}`) });
    case 'non_formal':
      return t('education.grade.nonFormal');
  }
}

/**
 * One line for the top of the play screen: what the character studies now
 * and where ("กำลังเรียน ม.5 แผนวิทย์-คณิต · โรงเรียนเอกชน"), or how their
 * education ended. Undefined before Grade 1.
 */
export function educationLine(state: EducationSource): string | undefined {
  const now = currentClass(state);
  if (now !== undefined) {
    const school = currentSchool(state);
    const where = school !== undefined && programDef(currentEnrollment(state)!.program).level !== 'non_formal' ? ` · ${t(`school.${school}`)}` : '';
    return t('education.now', { what: now }) + where;
  }
  const last = state.education.history.at(-1);
  if (last === undefined) return undefined;
  const ended = t(last.result === 'left' ? 'education.left' : 'education.finished', { program: t(`program.${last.program}`) });
  return state.flags.includes('working') ? `${ended} · ${t('education.working')}` : ended;
}

/** One row of the life summary's education list. */
export interface EducationRow {
  program: string;
  fromAge: number;
  toAge: number;
  /** undefined = still studying on the last day. */
  result?: EnrollmentResult;
}

export function educationRows(state: Pick<GameState, 'education'>, endAge: number): EducationRow[] {
  return state.education.history.map((e) => ({
    program: t(`program.${e.program}`),
    fromAge: Math.floor(e.from / 12),
    toAge: Math.floor((e.to ?? endAge) / 12),
    ...(e.result !== undefined ? { result: e.result } : {}),
  }));
}
