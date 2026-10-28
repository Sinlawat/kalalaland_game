/**
 * Creating a new life. Design decision: everything at birth is random
 * (traits, family, region, looks), driven only by the seed.
 */

import { BALANCE } from '../data/balance';
import names from '../data/names.json';
import { createRng, normalizeSeed, type Rng } from './rng';
import { snapshotOf } from './snapshot';
import { REGION_IDS, SEXES, type GameState, type RegionId } from './types';

/**
 * Average of two uniform draws → a triangular distribution: values near
 * the middle are common, extremes are rare. Most people are "average",
 * which feels more natural than every value being equally likely.
 */
function centeredRandom(rng: Rng, min: number, max: number): number {
  const a = min + rng.next() * (max - min);
  const b = min + rng.next() * (max - min);
  return Math.round((a + b) / 2);
}

function uniformRandom(rng: Rng, min: number, max: number): number {
  return Math.round(min + rng.next() * (max - min));
}

export function createNewLife(seed: number): GameState {
  const normalizedSeed = normalizeSeed(seed);
  const rng = createRng(normalizedSeed);
  const b = BALANCE.birth;
  const attribute = (): number => centeredRandom(rng, b.attributeMin, b.attributeMax);

  // The ORDER of random draws below is part of the save format in a sense:
  // reordering lines changes which life a given seed produces.
  // D71: sex, then a nickname from that sex's list. Still two draws, as the
  // old first and last name were, so every value drawn after them (and so
  // every life a seed gives) stays what it was.
  const sex = rng.pick(SEXES);
  const nickname = rng.pick(names[sex]);
  const birthMonth = rng.int(1, 12);
  // D76: the region's random number is drawn here, where the region used to
  // be picked, but read only after the family wealth is known (below). One
  // draw at the same place keeps every other value of a seed's life as it was.
  const birthRegionRoll = rng.next();

  const state: GameState = {
    seed: normalizedSeed,
    rngState: 0, // filled in at the end, after all draws
    sex,
    nickname,
    ageInMonths: 0,
    birthMonth,
    birthRegionId: 'city', // set below, once the family wealth is drawn
    residence: { regionId: 'city', homeId: 'parents' },
    traits: {
      discipline: attribute(),
      resilience: attribute(),
      riskTaking: attribute(),
      imagination: attribute(),
    },
    environment: {
      familyWealth: attribute(),
      familyWarmth: attribute(),
      workStress: 0,
      financialStress: 0,
    },
    habits: { ...b.habits },
    condition: {
      physicalHealth: uniformRandom(rng, b.physicalHealth.min, b.physicalHealth.max),
      mentalHealth: uniformRandom(rng, b.mentalHealth.min, b.mentalHealth.max),
    },
    // D65: every skill starts at 0; they grow with age, traits and events.
    skills: { academic: 0, creative: 0, communication: 0, practical: 0 },
    outcome: {
      looks: centeredRandom(rng, b.looks.min, b.looks.max),
      fame: 0,
    },
    hidden: { physicalWear: 0 },
    flags: [],
    eventHistory: [],
    pendingChoices: [],
    habitTimers: {},
    yearLog: {},
    yearHabits: [],
    history: [],
    people: [],
    education: { history: [] },
    death: null,
  };

  const birthRegionId = birthRegionFor(state.environment.familyWealth, birthRegionRoll);
  state.birthRegionId = birthRegionId;
  state.residence = { regionId: birthRegionId, homeId: 'parents' };

  state.rngState = rng.state;
  state.birthSnapshot = snapshotOf(state);
  return state;
}

/**
 * D76: the birth region for a family wealth and a random number in [0, 1).
 * The wealth picks the band in BALANCE.birth.birthRegionByWealth; the roll
 * walks its weights in REGION_IDS order (city, suburb, rural).
 */
export function birthRegionFor(familyWealth: number, roll: number): RegionId {
  const bands = BALANCE.birth.birthRegionByWealth;
  const band = bands.find((b) => familyWealth < b.wealthBelow) ?? bands[bands.length - 1]!;
  const total = REGION_IDS.reduce((sum, id) => sum + band.weights[id], 0);
  let threshold = roll * total;
  for (const id of REGION_IDS) {
    threshold -= band.weights[id];
    if (threshold < 0) return id;
  }
  // Only reached through floating-point rounding at roll ≈ 1.
  return REGION_IDS[REGION_IDS.length - 1]!;
}

/** A fresh random seed for a new game (UI only — the engine never calls this). */
export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0]!;
}
