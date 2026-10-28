import { describe, expect, it } from 'vitest';
import names from '../data/names.json';
import { birthRegionFor, createNewLife } from './newLife';
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

  describe('D76: birth region by family wealth', () => {
    const bandOf = (wealth: number) => (wealth < 35 ? 'poor' : wealth < 65 ? 'middle' : 'rich');

    it('maps the roll onto the weights of the wealth band, in city → suburb → rural order', () => {
      // Rich band 55 / 35 / 10.
      expect(birthRegionFor(80, 0)).toBe('city');
      expect(birthRegionFor(80, 0.5499)).toBe('city');
      expect(birthRegionFor(80, 0.55)).toBe('suburb');
      expect(birthRegionFor(80, 0.8999)).toBe('suburb');
      expect(birthRegionFor(80, 0.9)).toBe('rural');
      expect(birthRegionFor(80, 0.999999)).toBe('rural');
      // Poor band 20 / 30 / 50: the same roll lands somewhere else.
      expect(birthRegionFor(20, 0.3)).toBe('suburb');
      expect(birthRegionFor(20, 0.5)).toBe('rural');
    });

    it('switches band exactly at 35 and 65 (each limit belongs to the band above)', () => {
      // A roll of 0.25 is city in the middle band (30) but suburb in the poor band (20).
      expect(birthRegionFor(34, 0.25)).toBe('suburb');
      expect(birthRegionFor(35, 0.25)).toBe('city');
      // A roll of 0.8 is rural in the middle band (from 0.7) but suburb in the rich band (0.55–0.9).
      expect(birthRegionFor(64, 0.8)).toBe('rural');
      expect(birthRegionFor(65, 0.8)).toBe('suburb');
    });

    it('gives each wealth band its share of regions over many lives', () => {
      const counts = { poor: { city: 0, suburb: 0, rural: 0, n: 0 }, middle: { city: 0, suburb: 0, rural: 0, n: 0 }, rich: { city: 0, suburb: 0, rural: 0, n: 0 } };
      for (let seed = 0; seed < 20000; seed++) {
        const life = createNewLife(seed);
        const band = counts[bandOf(life.environment.familyWealth)];
        band[life.birthRegionId]++;
        band.n++;
      }
      // Target ± 5 points: wide enough never to flake (each band has 3000+ lives), narrow enough to catch a wrong table.
      const share = (band: keyof typeof counts, region: 'city' | 'suburb' | 'rural') => counts[band][region] / counts[band].n;
      expect(share('rich', 'city')).toBeCloseTo(0.55, 1);
      expect(share('rich', 'rural')).toBeLessThan(0.15);
      expect(share('poor', 'rural')).toBeGreaterThan(0.45);
      expect(share('poor', 'city')).toBeLessThan(0.25);
      expect(share('middle', 'suburb')).toBeGreaterThan(0.35);
      expect(share('middle', 'suburb')).toBeLessThan(0.45);
    });

    it('draws the region roll where the region used to be picked, so nothing else of a seed changes', () => {
      for (const seed of [0, 1, 42, 123456, 4294967295]) {
        const rng = createRng(normalizeSeed(seed));
        rng.next(); // sex
        rng.next(); // nickname
        rng.int(1, 12); // birth month
        const roll = rng.next();
        const discipline = Math.round(((10 + rng.next() * 80) + (10 + rng.next() * 80)) / 2);
        const life = createNewLife(seed);
        expect(life.traits.discipline).toBe(discipline);
        expect(life.birthRegionId).toBe(birthRegionFor(life.environment.familyWealth, roll));
      }
    });
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
