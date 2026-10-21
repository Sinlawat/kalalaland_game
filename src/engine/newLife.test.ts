import { describe, expect, it } from 'vitest';
import { createNewLife } from './newLife';
import { REGION_IDS } from './types';

describe('createNewLife', () => {
  it('creates the same person from the same seed', () => {
    expect(createNewLife(2024)).toEqual(createNewLife(2024));
  });

  it('creates different people from different seeds', () => {
    expect(createNewLife(1)).not.toEqual(createNewLife(2));
  });

  it('starts at age 0, alive, with empty logs and flags', () => {
    const life = createNewLife(5);
    expect(life.ageInMonths).toBe(0);
    expect(life.death).toBeNull();
    expect(life.flags).toEqual([]);
    expect(life.yearLog).toEqual({});
    expect(life.history).toEqual([]);
  });

  it('keeps every random attribute inside its allowed range over many seeds', () => {
    for (let seed = 0; seed < 500; seed++) {
      const life = createNewLife(seed);
      const values = [
        ...Object.values(life.traits),
        life.environment.familyWealth,
        life.environment.familyWarmth,
        ...Object.values(life.condition),
        life.outcome.looks,
      ];
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(life.birthMonth).toBeGreaterThanOrEqual(1);
      expect(life.birthMonth).toBeLessThanOrEqual(12);
      expect(REGION_IDS).toContain(life.regionId);
      expect(life.name.first.length).toBeGreaterThan(0);
    }
  });

  it('stores an RNG state different from the seed (draws were consumed)', () => {
    const life = createNewLife(10);
    expect(life.seed).toBe(10);
    expect(life.rngState).not.toBe(10);
  });

  it('produces every region over enough seeds', () => {
    const regions = new Set(Array.from({ length: 200 }, (_, seed) => createNewLife(seed).regionId));
    expect(regions).toEqual(new Set(REGION_IDS));
  });
});
