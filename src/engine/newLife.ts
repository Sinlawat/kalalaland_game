/**
 * Creating a new life. Design decision: everything at birth is random
 * (traits, family, region, looks), driven only by the seed.
 */

import { BALANCE } from '../data/balance';
import names from '../data/names.json';
import { createRng, normalizeSeed, type Rng } from './rng';
import { REGION_IDS, type GameState } from './types';

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
  const state: GameState = {
    seed: normalizedSeed,
    rngState: 0, // filled in at the end, after all draws
    name: { first: rng.pick(names.first), last: rng.pick(names.last) },
    ageInMonths: 0,
    birthMonth: rng.int(1, 12),
    regionId: rng.pick(REGION_IDS),
    traits: {
      discipline: attribute(),
      resilience: attribute(),
      riskTaking: attribute(),
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
      knowledge: b.knowledge,
    },
    outcome: {
      looks: centeredRandom(rng, b.looks.min, b.looks.max),
      fame: 0,
    },
    hidden: { physicalWear: 0 },
    flags: [],
    yearLog: {},
    history: [],
    death: null,
  };

  state.rngState = rng.state;
  return state;
}

/** A fresh random seed for a new game (UI only — the engine never calls this). */
export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0]!;
}
