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

import { applyChoice, applyEvent, EVENTS, findEvent, hasChoices, lockReasons, personFor, rollEvents, type EventDef } from './events';
import { applyStartingLifestyle, expireHabitTimers, OWN_LIFESTYLE_FROM_MONTH } from './lifestyle';
import { rollDeath } from './mortality';
import { computePassiveContributions } from './passive';
import { createRng } from './rng';
import { snapshotOf } from './snapshot';
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

export interface MonthResult {
  state: GameState;
  /** 'yearEnd' on a birthday, 'death' when the character died, otherwise null. */
  stop: StopReason | null;
}

/** Moves the running year log (and the year's habits) into history. Called on each birthday. */
function closeYear(state: GameState): void {
  state.history.push({
    age: state.ageInMonths / MONTHS_PER_YEAR,
    changes: state.yearLog,
    snapshot: snapshotOf(state),
    habits: state.yearHabits,
  });
  state.yearLog = {};
  state.yearHabits = [];
}

/**
 * Simulates ONE month on a state the caller owns (mutates it).
 * Returns 'yearEnd' on a birthday, 'death' on death, 'choice' when the
 * month is paused for the player, otherwise null.
 *
 * Order follows the design doc. Steps for finance and NPCs will be
 * inserted here in later increments.
 */
function simulateMonthInPlace(state: GameState, events: readonly EventDef[] = EVENTS): StopReason | null {
  const rng = createRng(state.rngState);

  // 0. Lifestyle for this month (D50, D51, D56): at Grade 1 the family's
  //    lifestyle becomes the child's; temporary changes that ran out go back.
  //    Done BEFORE recording, so the month strip shows what really applied.
  if (state.ageInMonths + 1 === OWN_LIFESTYLE_FROM_MONTH) applyStartingLifestyle(state);
  expireHabitTimers(state);
  //    Remember which habits were in effect this month (events can change
  //    them mid-year, so a year may mix several levels).
  state.yearHabits.push({ ...state.habits });

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

  // 4. Events. Without choices: applied now. With choices (D39): queued in
  //    the order they were rolled, and the month pauses here.
  //    D72: who each event is about is settled as it happens (someone new
  //    draws from the RNG here), so the choice popup can show their name.
  for (const event of rollEvents(state, rng, events)) {
    const person = personFor(event, state, rng);
    // The best friend can be gone by now (an earlier event this month ended it): then the event has nobody to be about.
    if (event.about !== undefined && person === undefined) continue;
    if (hasChoices(event)) {
      state.pendingChoices.push({ eventId: event.id, ageInMonths: state.ageInMonths, ...(person !== undefined ? { person } : {}) });
    } else applyEvent(state, event, person);
  }
  state.rngState = rng.state;
  if (state.pendingChoices.length > 0) return 'choice';

  return finishMonthInPlace(state);
}

/**
 * Steps 5–6 of a month: the death check and the birthday. Runs right after
 * the events, or — when the month paused for choices — after the last choice.
 * That way a choice made in a birthday month is logged in the year it
 * belongs to, and its effects count in this month's death check.
 *
 * The RNG continues from `rngState`, which gives exactly the same numbers as
 * one unbroken generator (its whole state is that one integer), so lives
 * without choice events are identical to before choices existed.
 */
function finishMonthInPlace(state: GameState): StopReason | null {
  const rng = createRng(state.rngState);

  // 5. Death check
  const cause = rollDeath(state, rng);
  state.rngState = rng.state;
  if (cause !== null) {
    state.death = { cause, ageInMonths: state.ageInMonths };
    closeYear(state); // keep the partial last year in the life summary
    return 'death';
  }

  // 6. Year end (birthday): close the year log
  if (state.ageInMonths % MONTHS_PER_YEAR === 0) {
    closeYear(state);
    return 'yearEnd';
  }
  return null;
}

function assertCanAdvance(state: GameState): void {
  if (state.death !== null) {
    throw new Error('Cannot advance: this character has already died');
  }
  if (state.pendingChoices.length > 0) {
    throw new Error('Cannot advance: an event is waiting for the player to choose');
  }
}

/**
 * Advances exactly one month. Used by the real-time runner (D38: the UI
 * calls this once per tick, about every 1.25 s at normal speed).
 * `events` is for tests that need a month without random events.
 */
export function advanceOneMonth(state: GameState, events: readonly EventDef[] = EVENTS): MonthResult {
  assertCanAdvance(state);
  const next = structuredClone(state);
  const stop = simulateMonthInPlace(next, events);
  return { state: next, stop };
}

/** Applies one choice to the oldest waiting event; finishes the month after the last one. Mutates. */
function resolveChoiceInPlace(state: GameState, choiceId: string, events: readonly EventDef[] = EVENTS): StopReason | null {
  const pending = state.pendingChoices[0];
  if (!pending) throw new Error('No event is waiting for a choice');
  const event = findEvent(pending.eventId, events);
  if (!event) throw new Error(`Unknown event "${pending.eventId}"`);
  applyChoice(state, event, choiceId, pending.ageInMonths, pending.person);
  state.pendingChoices.shift();
  return state.pendingChoices.length > 0 ? 'choice' : finishMonthInPlace(state);
}

/**
 * The player's answer to the choice popup (D39). Never modifies its input.
 * stop: 'choice' when another event is still waiting, otherwise what the
 * rest of the month produced ('yearEnd', 'death' or null).
 */
export function resolveChoice(state: GameState, choiceId: string): MonthResult {
  if (state.death !== null) throw new Error('Cannot choose: this character has already died');
  const next = structuredClone(state);
  const stop = resolveChoiceInPlace(next, choiceId);
  return { state: next, stop };
}

/**
 * After loading a save: drops waiting events that no longer exist in the
 * game data (removed or renamed by an update), and finishes the month if
 * none is left. Returns the input unchanged when there is nothing to do.
 */
export function settlePendingChoices(state: GameState): MonthResult {
  const known = state.pendingChoices.filter((pending) => findEvent(pending.eventId) !== undefined);
  if (known.length === state.pendingChoices.length) {
    return { state, stop: state.pendingChoices.length > 0 ? 'choice' : null };
  }
  const next = structuredClone(state);
  next.pendingChoices = known;
  const stop = known.length > 0 ? 'choice' : finishMonthInPlace(next);
  return { state: next, stop };
}

/** Picks a choice on the player's behalf, for tests and simulations. */
export type Chooser = (state: GameState, event: EventDef) => string;

/** Default for simulations: the first choice that is available. */
export const firstAvailableChoice: Chooser = (state, event) => {
  const choice = event.choices?.find((c) => lockReasons(c, state).length === 0);
  if (!choice) throw new Error(`Event "${event.id}" has no available choice`);
  return choice.id;
};

/**
 * Options for the simulation helpers below (tests and tools only).
 * - chooser: answers events with choices (default: first available choice)
 * - events: the event list to use (default: the game's). The balance test
 *   passes [] to measure lifestyle effects without content events mixed in.
 */
export interface SimulationOptions {
  chooser?: Chooser;
  events?: readonly EventDef[];
}

/** Runs one month and answers its choices. Mutates. */
function simulateMonthWithChooser(state: GameState, options: SimulationOptions): StopReason | null {
  const { chooser = firstAvailableChoice, events = EVENTS } = options;
  let stop = simulateMonthInPlace(state, events);
  while (stop === 'choice') {
    const event = findEvent(state.pendingChoices[0]!.eventId, events)!;
    stop = resolveChoiceInPlace(state, chooser(state, event), events);
  }
  return stop;
}

/**
 * Runs months until the next birthday or death (at most 12 months).
 * For tests and tools that want a whole year in one call: choices are
 * answered by the chooser (the UI never uses this; the player chooses there).
 */
export function advanceUntilStop(state: GameState, options: SimulationOptions = {}): AdvanceResult {
  assertCanAdvance(state);
  const next = structuredClone(state);
  let monthsAdvanced = 0;
  // Guard against an endless loop if a future change removes the birthday stop.
  while (monthsAdvanced < MONTHS_PER_YEAR) {
    monthsAdvanced += 1;
    const stop = simulateMonthWithChooser(next, options);
    if (stop !== null) return { state: next, stop, monthsAdvanced };
  }
  throw new Error(`No stop point within ${MONTHS_PER_YEAR} months — the loop is broken`);
}

/** Runs a whole life, for tests and balance simulation. Not used by the UI. */
export function simulateWholeLife(state: GameState, options: SimulationOptions = {}): GameState {
  const next = structuredClone(state);
  while (next.death === null) {
    simulateMonthWithChooser(next, options);
  }
  return next;
}
