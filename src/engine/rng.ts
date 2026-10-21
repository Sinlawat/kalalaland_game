/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * Why not Math.random()?
 * - Math.random() cannot be seeded, so a life could never be replayed.
 * - With a seed, the same seed + the same player choices = the same life.
 *   That makes bugs reproducible and tests deterministic.
 *
 * The whole generator state is ONE 32-bit integer. We store it inside the
 * game state (`rngState`), so a saved game continues with exactly the same
 * random sequence after loading.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with the given probability (0..1). */
  chance(probability: number): boolean;
  /** One random element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Current internal state; write it back into the game state after use. */
  readonly state: number;
}

/** Turns any number (e.g. Date.now()) into a valid 32-bit unsigned seed. */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error(`Seed must be a finite number, got ${seed}`);
  }
  return Math.trunc(seed) >>> 0;
}

export function createRng(initialState: number): Rng {
  let state = normalizeSeed(initialState);

  const next = (): number => {
    // mulberry32: small, fast, good enough statistical quality for a game.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new Error(`Invalid int range [${min}, ${max}]`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(probability) {
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return next() < probability;
    },
    pick(items) {
      if (items.length === 0) {
        throw new Error('Cannot pick from an empty array');
      }
      // Index is always in range, so the non-null assertion is safe here.
      return items[Math.floor(next() * items.length)]!;
    },
    get state() {
      return state;
    },
  };
}
