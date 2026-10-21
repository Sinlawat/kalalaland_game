/**
 * Trait reveal (design decision D35): traits exist from birth and already
 * act in the engine, but the player first sees them at Grade 1, in a
 * one-time popup. The flag records that the popup was acknowledged, so it is
 * shown once per life — also across save/load.
 */

import { knowsOwnTraits } from '../engine/passive';
import type { GameState } from '../engine/types';

export const TRAITS_REVEALED_FLAG = 'traits_revealed';

/** True when the one-time "who you are" popup should be shown now. */
export function shouldRevealTraits(state: GameState): boolean {
  return state.death === null && knowsOwnTraits(state) && !state.flags.includes(TRAITS_REVEALED_FLAG);
}

/** Returns a NEW state with the reveal marked as seen. Safe to call twice. */
export function acknowledgeTraitReveal(state: GameState): GameState {
  if (!knowsOwnTraits(state)) {
    throw new Error('Traits cannot be revealed before Grade 1');
  }
  if (state.flags.includes(TRAITS_REVEALED_FLAG)) return state;
  return { ...state, flags: [...state.flags, TRAITS_REVEALED_FLAG] };
}
