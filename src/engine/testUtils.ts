/**
 * Helpers shared by tests only. Builds a predictable state so a test can
 * change exactly the fields it cares about.
 */

import { createNewLife } from './newLife';
import type { GameState } from './types';

type StateOverrides = Partial<
  Omit<GameState, 'traits' | 'environment' | 'habits' | 'condition' | 'skills' | 'outcome' | 'hidden'>
> & {
  hidden?: Partial<GameState['hidden']>;
  traits?: Partial<GameState['traits']>;
  environment?: Partial<GameState['environment']>;
  habits?: Partial<GameState['habits']>;
  condition?: Partial<GameState['condition']>;
  skills?: Partial<GameState['skills']>;
  outcome?: Partial<GameState['outcome']>;
};

/** A state with every attribute at a neutral, known value. */
export function makeState(overrides: StateOverrides = {}): GameState {
  const base = createNewLife(1);
  const { traits, environment, habits, condition, skills, outcome, hidden, ...rest } = overrides;
  return {
    ...base,
    ageInMonths: 30 * 12,
    traits: { discipline: 50, resilience: 0, riskTaking: 50, imagination: 50, ...traits },
    environment: { familyWealth: 50, familyWarmth: 50, workStress: 0, financialStress: 0, ...environment },
    habits: { exercise: 'light', sleep: 'enough', overtime: 'none', smoking: 'none', drinking: 'none', ...habits },
    condition: { physicalHealth: 70, mentalHealth: 70, ...condition },
    skills: { academic: 50, creative: 50, communication: 50, practical: 50, ...skills },
    outcome: { looks: 50, fame: 0, ...outcome },
    hidden: { physicalWear: 0, ...hidden },
    ...rest,
  };
}
