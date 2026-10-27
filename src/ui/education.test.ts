import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import type { Education } from '../engine/types';
import { educationLine, educationRows } from './education';

const at = (ageInMonths: number, education: Education, flags: string[] = []) => makeState({ ageInMonths, education, flags });

describe('educationLine (D74)', () => {
  it('says nothing before Grade 1', () => {
    expect(educationLine(at(5 * 12, { history: [] }))).toBeUndefined();
  });

  it('gives the class and the school: Grade 3 in a private school', () => {
    expect(educationLine(at(8 * 12 + 6, { history: [{ program: 'primary', from: 6 * 12 + 4 }] }, ['school_private']))).toBe(
      'กำลังเรียน ป.3 · โรงเรียนเอกชน',
    );
  });

  it('counts Grades 10–12 on from Grade 9 and names the plan', () => {
    expect(educationLine(at(16 * 12, { history: [{ program: 'upper_secondary_science', from: 15 * 12 - 1 }] }, ['school_top_public']))).toBe(
      'กำลังเรียน ม.5 แผนวิทย์-คณิต · โรงเรียนรัฐชื่อดัง',
    );
  });

  it('counts the months carried over from a switch of plan', () => {
    expect(educationLine(at(16 * 12, { history: [{ program: 'upper_secondary_arts_math', from: 16 * 12 - 2, credit: 12 }] }, ['school_public']))).toBe(
      'กำลังเรียน ม.5 แผนศิลป์-คำนวณ · โรงเรียนรัฐ',
    );
  });

  it('names the college year and major', () => {
    expect(educationLine(at(15 * 12 + 2, { history: [{ program: 'vocational_computer', from: 15 * 12 }] }, ['school_vocational']))).toBe(
      'กำลังเรียน ปวช. ปี 1 คอมพิวเตอร์ · วิทยาลัยอาชีวะ',
    );
  });

  it('after school: how it ended, and work', () => {
    const lower = { program: 'lower_secondary' as const, from: 12 * 12, to: 15 * 12, result: 'graduated' as const };
    expect(educationLine(at(16 * 12, { history: [lower] }, ['working']))).toBe('เรียนจบ มัธยมต้น (ม.1–ม.3) · ทำงานอยู่');
    expect(educationLine(at(16 * 12, { history: [lower, { program: 'vocational_mechanical', from: 15 * 12, to: 15 * 12 + 6, result: 'left' }] }))).toBe(
      'ออกกลางคันจาก ปวช. ช่างกล',
    );
  });
});

describe('educationRows', () => {
  it('lists every program with ages and result; the one still going counts to the end', () => {
    const rows = educationRows(
      { education: { history: [{ program: 'primary', from: 76, to: 148, result: 'graduated' }, { program: 'lower_secondary', from: 148 }] } },
      160,
    );
    expect(rows).toEqual([
      { program: 'ประถมศึกษา (ป.1–ป.6)', fromAge: 6, toAge: 12, result: 'graduated' },
      { program: 'มัธยมต้น (ม.1–ม.3)', fromAge: 12, toAge: 13 },
    ]);
  });
});
