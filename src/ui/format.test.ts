import { describe, expect, it } from 'vitest';
import { changeClass, formatAge, formatChange, formatDelta, formatStat, traitBand } from './format';

describe('formatChange / changeClass', () => {
  it.each([
    [1.24, '+1.2', 'up'],
    [-0.36, '−0.4', 'down'],
    [0, '0', 'neutral'],
    [-0.04, '0', 'neutral'], // shown as 0 → must not be red
    [0.04, '0', 'neutral'],
    [0.05, '+0.1', 'up'],
  ] as const)('%d → "%s" (%s)', (value, text, cls) => {
    expect(formatChange(value)).toBe(text);
    expect(changeClass(value)).toBe(cls);
  });
});

describe('formatDelta', () => {
  it.each([
    [4.24, '▲4.2'],
    [-0.36, '▼0.4'],
    [0, ''],
    [-0.04, ''], // rounds to 0 → no indicator at all
    [0.05, '▲0.1'],
  ])('%d → "%s"', (value, text) => {
    expect(formatDelta(value)).toBe(text);
  });
});

describe('formatStat', () => {
  it('rounds floats for display', () => {
    expect(formatStat(70.49)).toBe('70');
    expect(formatStat(70.5)).toBe('71');
  });
});

describe('formatAge', () => {
  it('splits months into years and months', () => {
    expect(formatAge(0)).toBe('อายุ 0 ปี 0 เดือน');
    expect(formatAge(14)).toBe('อายุ 1 ปี 2 เดือน');
  });
});

describe('traitBand', () => {
  it.each([
    [0, 'low'],
    [34.9, 'low'],
    [35, 'mid'],
    [65, 'mid'],
    [65.1, 'high'],
    [100, 'high'],
  ] as const)('%d → %s', (value, band) => {
    expect(traitBand(value)).toBe(band);
  });
});
