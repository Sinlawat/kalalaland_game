/**
 * Money is stored as an INTEGER number of satang (1 baht = 100 satang).
 *
 * Why integers?
 *   0.1 + 0.2 === 0.30000000000000004 in floating point. Over 960 simulated
 *   months these tiny errors add up, and balances stop matching. Integers
 *   never drift, so every calculation that produces a fraction must round
 *   exactly once, with ONE rule: `roundMoney` below.
 *
 * Why a "branded" type?
 *   `Money` is a number at runtime, but TypeScript treats it as a separate
 *   type. You cannot accidentally pass a health value (number) where money
 *   is expected; you must go through `baht()` or `roundMoney()`.
 */

export type Money = number & { readonly __brand: 'Money' };

export const SATANG_PER_BAHT = 100;
export const ZERO: Money = 0 as Money;

/** Fixed display rate decided in the design doc (D-currency): 34 THB = 1 USD. */
export const THB_PER_USD = 34;

function assertSafe(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Money out of safe integer range or not an integer: ${value}`);
  }
}

/**
 * The single rounding rule of the game: round half away from zero.
 * 2.5 -> 3, -2.5 -> -3. (Math.round(-2.5) would give -2, which is biased.)
 */
export function roundMoney(satang: number): Money {
  if (!Number.isFinite(satang)) {
    throw new Error(`Cannot round a non-finite amount: ${satang}`);
  }
  const rounded = Math.sign(satang) * Math.round(Math.abs(satang));
  // `+ 0` turns -0 into 0 so equality checks and JSON stay clean.
  const result = rounded + 0;
  assertSafe(result);
  return result as Money;
}

/** Builds Money from a baht amount, e.g. baht(9700) or baht(12.5). */
export function baht(amount: number): Money {
  return roundMoney(amount * SATANG_PER_BAHT);
}

export function addMoney(...amounts: Money[]): Money {
  let total = 0;
  for (const amount of amounts) total += amount;
  assertSafe(total);
  return total as Money;
}

export function subtractMoney(a: Money, b: Money): Money {
  const result = a - b;
  assertSafe(result);
  return result as Money;
}

/** Multiplies by any factor (rate, multiplier) and rounds once. */
export function multiplyMoney(amount: Money, factor: number): Money {
  return roundMoney(amount * factor);
}

export type DisplayLocale = 'th' | 'en';

/**
 * Formats Money for the player. One economy (baht) internally; English
 * players see USD converted at the fixed rate. No decimals for baht amounts
 * because in-game prices are whole baht.
 */
export function formatMoney(amount: Money, locale: DisplayLocale): string {
  const bahtValue = amount / SATANG_PER_BAHT;
  if (locale === 'th') {
    return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(bahtValue)} บาท`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(bahtValue / THB_PER_USD);
}
