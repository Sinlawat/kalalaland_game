import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import { startJob, stopWork } from '../engine/work';
import { formatMoney, formatMoneyChange } from './format';
import { buildTimeline } from './timeline';
import { lifeMoney, overtimeLabels, showsFamilyMoneyStress, workChangeText, workLine, workRows } from './work';

describe('work and money on screen (D77)', () => {
  it('money: whole baht with thousands separators, changes with a real minus sign', () => {
    expect(formatMoney(12400)).toBe('12,400');
    expect(formatMoney(0)).toBe('0');
    expect(formatMoneyChange(500)).toBe('+500');
    expect(formatMoneyChange(-3000)).toBe('−3,000');
  });

  it('the header names the job now, and nothing without one', () => {
    const state = makeState({ ageInMonths: 16 * 12 });
    expect(workLine(state)).toBeUndefined();
    startJob(state, 'restaurant', 'daily');
    expect(workLine(state)).toBe('ทำงาน part-time ทุกวัน · ร้านอาหาร');
    startJob(state, 'convenience_store', 'full_time');
    expect(workLine(state)).toBe('ทำงานเต็มเวลา · ร้านสะดวกซื้อ');
  });

  it('the life summary lists each job with ages and how it ended', () => {
    const state = makeState({ ageInMonths: 15 * 12 + 2 });
    startJob(state, 'cafe', 'weekend');
    state.ageInMonths = 17 * 12;
    stopWork(state);
    expect(workRows(state, 60 * 12)).toEqual([{ job: 'ร้านกาแฟ', level: 'part-time เสาร์-อาทิตย์', fromAge: 15, toAge: 17, result: 'quit' }]);
  });

  it('life totals add every year and the running one', () => {
    const state = makeState({ ageInMonths: 18 * 12 });
    state.history = [
      { age: 16, changes: {}, snapshot: {} as never, money: { earned: 10000, given: 3000, cash: 7000 } },
      { age: 17, changes: {}, snapshot: {} as never },
    ];
    state.money.year = { earned: 2400, given: 0 };
    state.money.cash = 9400;
    expect(lifeMoney(state)).toEqual({ earned: 12400, given: 3000, cash: 9400 });
  });

  it('a job change reads as a start, a change of hours, or an end', () => {
    expect(workChangeText({ to: { job: 'cafe', level: 'weekend' } })).toBe('เริ่มทำงาน: part-time เสาร์-อาทิตย์ · ร้านกาแฟ');
    expect(workChangeText({ from: { job: 'cafe', level: 'daily' }, to: { job: 'cafe', level: 'weekend' } })).toBe('เปลี่ยนเป็น: part-time เสาร์-อาทิตย์');
    expect(workChangeText({ from: { job: 'cafe', level: 'daily' } })).toBe('เลิกทำงาน: part-time ทุกวัน · ร้านกาแฟ');
  });

  it('a student working part-time sees "extra work", not "overtime"', () => {
    expect(overtimeLabels('daily').name).toBe('ทำงานพิเศษ');
    expect(overtimeLabels('daily').levelKey('heavy')).toBe('habit.overtime.partTime.heavy');
    expect(overtimeLabels('full_time').name).toBe('ทำงานล่วงเวลา');
    expect(overtimeLabels(undefined).levelKey('some')).toBe('habit.overtime.some');
  });

  it('the family money stress is shown until 22', () => {
    expect(showsFamilyMoneyStress({ ageInMonths: 22 * 12 - 1 })).toBe(true);
    expect(showsFamilyMoneyStress({ ageInMonths: 22 * 12 })).toBe(false);
  });

  it('the timeline shows what an event did to the savings, the job it changed, and the wages of the year', () => {
    const state = makeState({ ageInMonths: 16 * 12 + 5 });
    state.history = [];
    state.eventHistory = [
      { id: 'work_parttime_offer', ageInMonths: 16 * 12 + 1, choiceId: 'daily', workChange: { to: { job: 'restaurant', level: 'daily' } } },
      { id: 'work_first_paycheck', ageInMonths: 16 * 12 + 2, choiceId: 'treat', moneyChange: -500 },
    ];
    state.money.year = { earned: 15000, given: 0 };
    const [year] = buildTimeline(state);
    expect(year!.money).toEqual({ earned: 15000, given: 0 });
    expect(year!.entries.map((e) => [e.id, e.moneyChange, e.workChange?.to?.job])).toEqual([
      ['work_first_paycheck', -500, undefined],
      ['work_parttime_offer', undefined, 'restaurant'],
    ]);
  });
});
