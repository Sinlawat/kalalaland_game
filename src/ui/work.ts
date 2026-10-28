/**
 * D77: what the screen says about work and money, computed from the facts in
 * `state.work` and `state.money`. Pure functions, unit-tested directly.
 */

import { BALANCE } from '../data/balance';
import { currentJob, isPartTime } from '../engine/work';
import type { GameState, WorkChange, WorkLevel, WorkResult, YearMoney } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatMoney } from './format';

/** "ทำงาน part-time ทุกวัน · ร้านอาหาร" for the top of the play screen; undefined without a job. */
export function workLine(state: Pick<GameState, 'work'>): string | undefined {
  const job = currentJob(state);
  if (job === undefined) return undefined;
  return t(`work.now.${job.level}`, { job: t(`job.${job.job}`) });
}

/** One row of the life summary's work list. */
export interface WorkRow {
  job: string;
  level: string;
  fromAge: number;
  toAge: number;
  /** undefined = still working there on the last day. */
  result?: WorkResult;
}

export function workRows(state: Pick<GameState, 'work'>, endAge: number): WorkRow[] {
  return state.work.history.map((job) => ({
    job: t(`job.${job.job}`),
    level: t(`work.level.${job.level}`),
    fromAge: Math.floor(job.from / 12),
    toAge: Math.floor((job.to ?? endAge) / 12),
    ...(job.result !== undefined ? { result: job.result } : {}),
  }));
}

/** Wages and money given to the family over the whole life, and the savings now. */
export function lifeMoney(state: Pick<GameState, 'history' | 'money'>): YearMoney {
  const totals = { earned: state.money.year.earned, given: state.money.year.given, cash: state.money.cash };
  for (const year of state.history) {
    totals.earned += year.money?.earned ?? 0;
    totals.given += year.money?.given ?? 0;
  }
  return totals;
}

/**
 * The line under an event that started, changed or ended a job:
 * "เริ่มทำงาน: part-time ทุกวัน · ร้านอาหาร", "เปลี่ยนเป็น: part-time เสาร์-อาทิตย์".
 */
export function workChangeText(change: WorkChange): string {
  const { from, to } = change;
  if (to !== undefined && from !== undefined && from.job === to.job) return t('timeline.workChange', { level: t(`work.level.${to.level}`) });
  if (to !== undefined) return t('timeline.workStart', { level: t(`work.level.${to.level}`), job: t(`job.${to.job}`) });
  return t('timeline.workStop', { level: t(`work.level.${from!.level}`), job: t(`job.${from!.job}`) });
}

/**
 * The overtime habit is about work hours. For a student working part-time it
 * reads as "extra work: weekends / every day" instead of "overtime: some / heavy".
 */
export function overtimeLabels(level: WorkLevel | undefined): { name: string; levelKey: (level: string) => string } {
  if (level !== undefined && isPartTime(level)) {
    return { name: t('habit.overtime.partTime'), levelKey: (l) => `habit.overtime.partTime.${l}` };
  }
  return { name: t('habit.overtime'), levelKey: (l) => `habit.overtime.${l}` };
}

/** The family's money stress is shown while it is the family's (until the age in the balance data). */
export function showsFamilyMoneyStress(state: Pick<GameState, 'ageInMonths'>): boolean {
  return state.ageInMonths < BALANCE.familyMoneyStress.untilAge * 12;
}

/** "12,400 บาท". */
export function moneyText(amount: number): string {
  return t('money.amount', { amount: formatMoney(amount) });
}
