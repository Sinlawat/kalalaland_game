/**
 * The monthly game loop (design doc section 3).
 *
 * Public functions here never modify the state they receive. They copy it
 * once with structuredClone, run the month(s) on the copy, and return the
 * copy. React relies on this: it only re-renders when it gets a NEW object.
 *
 * Why not copy inside every helper ("fully immutable" style)?
 * A life is ~900 months and the Monte Carlo test runs thousands of lives.
 * One copy per call + in-place updates on that private copy is fast and
 * still safe, because nobody outside can see the copy until we return it.
 */

import { applyEvent, rollEvents } from './events';
import { rollDeath } from './mortality';
import { computePassiveContributions } from './passive';
import { createRng } from './rng';
import { applyContributions } from './stats';
import type { GameState, StopReason } from './types';
import { applyMonthlyWear, yearlyWearChange } from './wear';

const MONTHS_PER_YEAR = 12;

export interface AdvanceResult {
  state: GameState;
  /** Why the engine stopped. */
  stop: StopReason;
  /** How many months were simulated in this call. */
  monthsAdvanced: number;
}

/** Moves the running year log into history. Called on each birthday. */
function closeYear(state: GameState): void {
  state.history.push({
    age: state.ageInMonths / MONTHS_PER_YEAR,
    changes: state.yearLog,
    snapshot: { ...state.condition, looks: state.outcome.looks },
  });
  state.yearLog = {};
}

/**
 * Simulates ONE month on a state the caller owns (mutates it).
 * Returns a stop reason if the player must look at something now.
 *
 * Order follows the design doc. Steps for finance and NPCs will be
 * inserted here in later increments.
 */
function simulateMonthInPlace(state: GameState): StopReason | null {
  const rng = createRng(state.rngState);

  // 1. Age +1 month
  state.ageInMonths += 1;

  // 2. Passive effects: Environment / Habits / Traits → Condition, plus wear.
  //    Both are calculated from the SAME start-of-month state before either
  //    is applied, so the order of the two apply calls cannot change results.
  const contributions = computePassiveContributions(state);
  const wearChange = yearlyWearChange(state);
  applyContributions(state, contributions);
  applyMonthlyWear(state, wearChange);

  // 3. Finance            — later increment

  // 4. Events (no-choice events only for now: they are applied and appear
  //    in the yearly summary; the game does not pause for them).
  for (const event of rollEvents(state, rng)) applyEvent(state, event);

  // 5. Death check
  const cause = rollDeath(state, rng);
  state.rngState = rng.state;
  if (cause !== null) {
    state.death = { cause, ageInMonths: state.ageInMonths };
    closeYear(state); // keep the partial last year in the life summary
    return 'death';
  }

  // 6. Year end (birthday): close the year log → yearly summary
  if (state.ageInMonths % MONTHS_PER_YEAR === 0) {
    closeYear(state);
    return 'yearEnd';
  }
  return null;
}

/**
 * Runs months until the next stop point (design: the UI pauses only when
 * there is something to decide or read). Every birthday is a stop, so this
 * runs at most 12 months.
 */
export function advanceUntilStop(state: GameState): AdvanceResult {
  if (state.death !== null) {
    throw new Error('Cannot advance: this character has already died');
  }
  const next = structuredClone(state);
  let monthsAdvanced = 0;
  // Guard against an endless loop if a future change removes the birthday stop.
  while (monthsAdvanced < MONTHS_PER_YEAR) {
    monthsAdvanced += 1;
    const stop = simulateMonthInPlace(next);
    if (stop !== null) return { state: next, stop, monthsAdvanced };
  }
  throw new Error(`No stop point within ${MONTHS_PER_YEAR} months — the loop is broken`);
}

/**
 * Runs a whole life with fixed habits, for tests and balance simulation.
 * Not used by the UI.
 */
export function simulateWholeLife(state: GameState): GameState {
  const next = structuredClone(state);
  while (next.death === null) {
    simulateMonthInPlace(next);
  }
  return next;
}
