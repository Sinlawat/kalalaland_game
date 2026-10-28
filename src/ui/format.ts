import { t } from '../i18n/i18n';

export function formatAge(ageInMonths: number): string {
  return t('status.age', { years: Math.floor(ageInMonths / 12), months: ageInMonths % 12 });
}

/** D77: whole baht with thousands separators: "12,400". */
export function formatMoney(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

/** D77: a money change with its sign: "+500", "−3,000". */
export function formatMoneyChange(amount: number): string {
  const text = formatMoney(Math.abs(amount));
  return amount >= 0 ? `+${text}` : `−${text}`;
}

/** Stats are floats internally; the player only ever sees whole numbers. */
export function formatStat(value: number): string {
  return String(Math.round(value));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Signed change with one decimal, using a real minus sign: "+1.2", "−0.4". */
export function formatChange(value: number): string {
  const rounded = roundToTenth(value);
  if (rounded === 0) return '0';
  const text = Math.abs(rounded).toFixed(1);
  return rounded > 0 ? `+${text}` : `−${text}`;
}

/**
 * Compact change next to a stat bar: "▲4.2", "▼0.4", or "" when it rounds to 0.
 * Uses the REAL change (one decimal), the same number as the yearly summary,
 * not the difference between the two rounded values on screen.
 */
export function formatDelta(value: number): string {
  const rounded = roundToTenth(value);
  if (rounded === 0) return '';
  return `${rounded > 0 ? '▲' : '▼'}${Math.abs(rounded).toFixed(1)}`;
}

export type TraitBand = 'low' | 'mid' | 'high';

/** Words instead of numbers for a trait: below 35 low, above 65 high. */
export function traitBand(value: number): TraitBand {
  if (value < 35) return 'low';
  if (value > 65) return 'high';
  return 'mid';
}

/**
 * CSS class for a change. Decided on the ROUNDED value, so "−0.04" (shown
 * as "0") is neutral instead of red — color must agree with the text.
 */
export function changeClass(value: number): 'up' | 'down' | 'neutral' {
  const rounded = roundToTenth(value);
  if (rounded > 0) return 'up';
  if (rounded < 0) return 'down';
  return 'neutral';
}
