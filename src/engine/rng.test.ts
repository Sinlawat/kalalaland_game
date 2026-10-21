import { describe, expect, it } from 'vitest';
import { createRng, normalizeSeed } from './rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('continues the exact sequence when restored from its state (save/load)', () => {
    const original = createRng(123);
    original.next();
    original.next();
    const restored = createRng(original.state);
    expect(restored.next()).toBe(original.next());
  });

  it('next() always returns a value in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() stays inside inclusive bounds and hits both ends', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const value = rng.int(1, 3);
      expect([1, 2, 3]).toContain(value);
      seen.add(value);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it('int() works when min equals max', () => {
    expect(createRng(5).int(4, 4)).toBe(4);
  });

  it('int() rejects invalid ranges', () => {
    const rng = createRng(5);
    expect(() => rng.int(3, 1)).toThrow();
    expect(() => rng.int(1.5, 3)).toThrow();
  });

  it('chance() handles 0 and 1 exactly', () => {
    const rng = createRng(5);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('pick() throws on an empty array', () => {
    expect(() => createRng(5).pick([])).toThrow();
  });
});

describe('normalizeSeed', () => {
  it('maps any finite number to an unsigned 32-bit integer', () => {
    expect(normalizeSeed(-1)).toBe(4294967295);
    expect(normalizeSeed(3.9)).toBe(3);
    expect(normalizeSeed(2 ** 32 + 5)).toBe(5);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => normalizeSeed(Number.NaN)).toThrow();
    expect(() => normalizeSeed(Number.POSITIVE_INFINITY)).toThrow();
  });
});
