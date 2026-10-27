import { describe, expect, it } from 'vitest';
import names from '../data/names.json';
import { createNewLife } from './newLife';
import { createRng, normalizeSeed } from './rng';
import { REGION_IDS, SEXES } from './types';

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
      expect(REGION_IDS).toContain(life.birthRegionId);
    }
  });

  it('stores an RNG state different from the seed (draws were consumed)', () => {
    const life = createNewLife(10);
    expect(life.seed).toBe(10);
    expect(life.rngState).not.toBe(10);
  });

  it('starts every skill at 0 and draws the imagination trait like the others (D65)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const life = createNewLife(seed);
      expect(life.skills).toEqual({ academic: 0, creative: 0, communication: 0, practical: 0 });
      expect(life.traits.imagination).toBeGreaterThanOrEqual(10);
      expect(life.traits.imagination).toBeLessThanOrEqual(90);
    }
  });

  it('starts at home with the parents, in the birth region', () => {
    const life = createNewLife(5);
    expect(life.residence).toEqual({ regionId: life.birthRegionId, homeId: 'parents' });
  });

  it('keeps the values at birth for the year comparison (copies, not shared objects)', () => {
    const life = createNewLife(5);
    expect(life.birthSnapshot).toEqual({
      ...life.condition,
      looks: life.outcome.looks,
      skills: life.skills,
      traits: life.traits,
      environment: life.environment,
    });
    expect(life.birthSnapshot!.traits).not.toBe(life.traits);
  });

  it('produces every region over enough seeds', () => {
    const regions = new Set(Array.from({ length: 200 }, (_, seed) => createNewLife(seed).birthRegionId));
    expect(regions).toEqual(new Set(REGION_IDS));
  });

  describe('D71: sex and nickname', () => {
    it('draws both sexes about equally', () => {
      let male = 0;
      const lives = 2000;
      for (let seed = 0; seed < lives; seed++) if (createNewLife(seed).sex === 'male') male++;
      // 50% ± 4 points: wide enough never to flake, narrow enough to catch a bias.
      expect(male / lives).toBeGreaterThan(0.46);
      expect(male / lives).toBeLessThan(0.54);
    });

    it('takes the nickname from the list for the sex', () => {
      for (let seed = 0; seed < 300; seed++) {
        const life = createNewLife(seed);
        expect(SEXES).toContain(life.sex);
        expect(names[life.sex]).toContain(life.nickname);
      }
    });

    it('uses every nickname of both lists over enough seeds', () => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 5000; seed++) {
        const life = createNewLife(seed);
        seen.add(`${life.sex}:${life.nickname}`);
      }
      expect(seen.size).toBe(names.male.length + names.female.length);
    });

    it('uses exactly two random draws, so every later value a seed gives is unchanged', () => {
      for (const seed of [0, 1, 42, 123456, 4294967295]) {
        const rng = createRng(normalizeSeed(seed));
        rng.next();
        rng.next();
        expect(createNewLife(seed).birthMonth).toBe(rng.int(1, 12));
      }
    });
  });
});
