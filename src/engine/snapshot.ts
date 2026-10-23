import type { GameState, LifeSnapshot } from './types';

/** The values to keep for one moment of life (copies, never shared objects). */
export function snapshotOf(state: Pick<GameState, 'condition' | 'outcome' | 'traits' | 'environment'>): LifeSnapshot {
  return {
    ...state.condition,
    looks: state.outcome.looks,
    traits: { ...state.traits },
    environment: { ...state.environment },
  };
}
