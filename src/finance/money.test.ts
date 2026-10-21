import { describe, expect, it } from 'vitest';
import { addMoney, baht, formatMoney, multiplyMoney, roundMoney, subtractMoney, ZERO, type Money } from './money';

describe('roundMoney (the single rounding rule)', () => {
  it('rounds half away from zero for positive and negative values', () => {
    expect(roundMoney(2.5)).toBe(3);
    expect(roundMoney(-2.5)).toBe(-3);
    expect(roundMoney(2.4)).toBe(2);
    expect(roundMoney(-2.4)).toBe(-2);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundMoney(-0.4), 0)).toBe(true);
  });

  it('rejects non-finite and unsafe values', () => {
    expect(() => roundMoney(Number.NaN)).toThrow();
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => roundMoney(2 ** 60)).toThrow();
  });
});

describe('baht', () => {
  it('stores baht as integer satang', () => {
    expect(baht(9700)).toBe(970_000);
    expect(baht(12.5)).toBe(1250);
    expect(baht(-0.25)).toBe(-25);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and multiplies with exactly one rounding', () => {
    expect(addMoney(baht(1), baht(2), baht(3))).toBe(baht(6));
    expect(subtractMoney(baht(1), baht(3))).toBe(baht(-2));
    expect(multiplyMoney(baht(100), 0.333)).toBe(3330);
    expect(addMoney()).toBe(ZERO);
  });

  it('has no drift after 960 months of fractional-looking amounts', () => {
    // 0.1 + 0.2 style errors would break this with floats in baht.
    let balance: Money = ZERO;
    for (let month = 0; month < 960; month++) {
      balance = addMoney(balance, baht(0.1), baht(0.2));
    }
    expect(balance).toBe(baht(288));
    expect(Number.isInteger(balance)).toBe(true);
  });

  it('throws when the result leaves the safe integer range', () => {
    const huge = (Number.MAX_SAFE_INTEGER - 1) as Money;
    expect(() => addMoney(huge, huge)).toThrow();
  });
});

describe('formatMoney', () => {
  it('shows baht for Thai', () => {
    expect(formatMoney(baht(12345), 'th')).toBe('12,345 บาท');
  });

  it('converts to USD at the fixed rate for English', () => {
    expect(formatMoney(baht(3400), 'en')).toBe('$100');
  });
});
