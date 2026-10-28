/**
 * D77: what the screen says about work and money, computed from the facts in
 * `state.work` and `state.money`. Pure functions, unit-tested directly.
 */

import { BALANCE } from '../data/balance';
import { currentJob, familyMoneyStressParts, isPartTime, monthlyWage } from '../engine/work';
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

// ── D79: the finance dialog ─────────────────────────────────────────────────

/** One line of money by source: "ค่าจ้าง · ร้านกาแฟ 4,800". */
export interface SourceLine {
  source: string;
  label: string;
  amount: number;
}

/** "job.cafe" → "ค่าจ้าง · ร้านกาแฟ"; "event.<id>" → the event's title. */
export function sourceLabel(source: string): string {
  const [kind, ...rest] = source.split('.');
  const id = rest.join('.');
  if (kind === 'job') return t('finance.source.job', { job: t(`job.${id}`) });
  if (kind === 'event') return t(`event.${id}.title`);
  return source;
}

/** Largest first, so the main source of money reads first. */
function lines(totals: Record<string, number>): SourceLine[] {
  return Object.entries(totals)
    .filter(([, amount]) => amount !== 0)
    .map(([source, amount]) => ({ source, label: sourceLabel(source), amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** A job now and what it pays: a list, ready for a main job and a side job together (career system). */
export interface JobIncome {
  job: string;
  level: string;
  monthly: number;
  yearly: number;
  sharePercent: number;
  /** Given to the family each month. */
  given: number;
  /** Into the savings each month. */
  saved: number;
}

export function jobIncomes(state: Pick<GameState, 'work' | 'money' | 'residence'>): JobIncome[] {
  const job = currentJob(state);
  if (job === undefined) return [];
  const monthly = monthlyWage(job.job, job.level, state.residence.regionId);
  const given = Math.round((monthly * state.money.familySharePercent) / 100);
  return [
    {
      job: t(`job.${job.job}`),
      level: t(`work.level.${job.level}`),
      monthly,
      yearly: monthly * 12,
      sharePercent: state.money.familySharePercent,
      given,
      saved: monthly - given,
    },
  ];
}

/** This year's money (since the last birthday) by source. */
export function yearLines(state: Pick<GameState, 'money'>): { income: SourceLine[]; spent: SourceLine[]; given: number } {
  return { income: lines(state.money.year.income), spent: lines(state.money.year.spent), given: state.money.year.given };
}

/** The whole life so far: wages, money from anywhere else, given to the family, spent. */
export function lifeTotals(state: Pick<GameState, 'history' | 'money'>): { wages: number; other: number; given: number; spent: number } {
  const totals = { wages: 0, other: 0, given: 0, spent: 0 };
  const add = (year: { earned: number; given: number; income?: Record<string, number>; spent?: Record<string, number> }) => {
    totals.wages += year.earned;
    totals.given += year.given;
    for (const [source, amount] of Object.entries(year.income ?? {})) if (!source.startsWith('job.')) totals.other += amount;
    for (const amount of Object.values(year.spent ?? {})) totals.spent += amount;
  };
  for (const year of state.history) if (year.money) add(year.money);
  add(state.money.year);
  return totals;
}

/** The family's money stress, part by part, without the parts that are 0. */
export function stressLines(state: Pick<GameState, 'environment' | 'flags' | 'money' | 'ageInMonths'>): { total: number; parts: { key: string; amount: number }[] } {
  const parts = familyMoneyStressParts(state);
  const keys = ['wealth', 'parentOutOfWork', 'recovering', 'giving', 'gift'] as const;
  return {
    total: parts.total,
    parts: keys.map((key) => ({ key, amount: Math.round(parts[key]) })).filter((part) => part.amount !== 0),
  };
}
