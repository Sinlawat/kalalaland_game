import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import { startJob, stopWork } from '../engine/work';
import { formatMoney, formatMoneyChange } from './format';
import { buildTimeline } from './timeline';
import { jobIncomes, spendingLines, lifeMoney, lifeTotals, overtimeLabels, showsFamilyMoneyStress, sourceLabel, stressLines, workChangeText, workLine, workRows, yearLines } from './work';

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
    state.money.year = { earned: 2400, given: 0, income: {}, spent: {} };
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
    state.money.year = { earned: 15000, given: 0, income: {}, spent: {} };
    const [year] = buildTimeline(state);
    expect(year!.money).toEqual({ earned: 15000, given: 0 });
    expect(year!.entries.map((e) => [e.id, e.moneyChange, e.workChange?.to?.job])).toEqual([
      ['work_first_paycheck', -500, undefined],
      ['work_parttime_offer', undefined, 'restaurant'],
    ]);
  });
});

describe('the finance dialog (D79)', () => {
  it('lists the job now with its monthly and yearly wage and how it is split', () => {
    const state = makeState({ ageInMonths: 16 * 12, residence: { regionId: 'city', homeId: 'parents' } });
    expect(jobIncomes(state)).toEqual([]);
    startJob(state, 'cafe', 'weekend');
    state.money.familySharePercent = 30;
    expect(jobIncomes(state)).toEqual([{ job: 'ร้านกาแฟ', level: 'part-time เสาร์-อาทิตย์', monthly: 2400, yearly: 28800, sharePercent: 30, given: 720, spending: 1500, saved: 180 }]);
  });

  it("names this year's money by source, largest first", () => {
    const state = makeState({ ageInMonths: 16 * 12 });
    state.money.year = { earned: 4800, given: 720, income: { 'event.life_birthday_money': 500, 'job.cafe': 4800 }, spent: { 'event.work_first_paycheck': 500 } };
    expect(sourceLabel('job.cafe')).toBe('ค่าจ้าง · ร้านกาแฟ');
    expect(yearLines(state)).toEqual({
      income: [
        { source: 'job.cafe', label: 'ค่าจ้าง · ร้านกาแฟ', amount: 4800 },
        { source: 'event.life_birthday_money', label: 'เงินวันเกิด', amount: 500 },
      ],
      spent: [{ source: 'event.work_first_paycheck', label: 'เงินค่าจ้างก้อนแรก', amount: 500 }],
      given: 720,
    });
  });

  it('adds up the whole life: wages, other money, given, spent (years before D79 count their wages)', () => {
    const state = makeState({ ageInMonths: 17 * 12 });
    state.history = [
      { age: 16, changes: {}, snapshot: {} as never, money: { earned: 10000, given: 1000, cash: 9000 } },
      { age: 17, changes: {}, snapshot: {} as never, money: { earned: 2000, given: 0, cash: 11500, income: { 'job.cafe': 2000, 'event.life_birthday_money': 500 }, spent: {} } },
    ];
    state.money.year = { earned: 0, given: 0, income: {}, spent: { 'event.work_first_paycheck': 500 } };
    expect(lifeTotals(state)).toEqual({ wages: 12000, other: 500, given: 1000, spent: 500 });
  });

  it('shows the family money stress part by part, without the zero parts', () => {
    const state = makeState({ ageInMonths: 12 * 12, environment: { familyWealth: 50 }, flags: ['parent_lost_job'] });
    expect(stressLines(state)).toEqual({ total: 45, parts: [{ key: 'wealth', amount: 15 }, { key: 'parentOutOfWork', amount: 30 }] });
  });
});

describe('the spending section (D80)', () => {
  it('lists own spending by category with its total, or nothing without an income', () => {
    const state = makeState({ ageInMonths: 16 * 12, residence: { regionId: 'suburb', homeId: 'parents' } });
    expect(spendingLines(state)).toEqual({ lines: [], total: 0 });
    startJob(state, 'cafe', 'weekend');
    expect(spendingLines(state)).toEqual({
      lines: [
        { source: 'living.food', label: 'อาหาร (กินนอกบ้าน ขนม)', amount: 600 },
        { source: 'living.transport', label: 'ค่าเดินทาง', amount: 200 },
        { source: 'living.phone', label: 'ค่าโทรศัพท์และเน็ต', amount: 200 },
        { source: 'living.leisure', label: 'เที่ยวกับเพื่อน', amount: 200 },
      ],
      total: 1200,
    });
    expect(sourceLabel('living.food')).toBe('อาหาร (กินนอกบ้าน ขนม)');
  });
});
