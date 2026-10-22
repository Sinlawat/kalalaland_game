/**
 * "What did the event that JUST happened do to me?" — the short "+3.0" that
 * pops up beside a stat bar the moment an event changes it.
 *
 * Why this exists: the "▲/▼" beside each bar is the change over the last
 * COMPLETED year of age, so an event in month 3 only shows there at the next
 * birthday. The stat itself changes at once, but a +3 on a 0–100 bar is hard
 * to notice. The flash shows the event's own effect, immediately.
 *
 * Only EVENT effects flash. Lifestyle and ageing change stats a little every
 * month; flashing those would make the bars blink all the time.
 *
 * Pure function (no React), so it is unit-tested directly; the timing lives
 * in useEventFlash.
 */

import type { EventRecord, GameState } from '../engine/types';
import { chipsOfRecord, type EffectChip } from './timeline';

export type FlashTarget = EffectChip['target'];
export type FlashChanges = Partial<Record<FlashTarget, number>>;

/** Same threshold as the timeline: a change that rounds to "0.0" is not shown. */
const MIN_VISIBLE = 0.05;

type FlashSource = Pick<GameState, 'seed' | 'eventHistory' | 'history' | 'yearLog'>;

/**
 * Is `next` the same life as `previous`, only further on? A new character,
 * or a save loaded over the running game, is a different life: its events
 * did not "just happen", so nothing must flash.
 */
function continuesLife(previous: FlashSource, next: FlashSource): boolean {
  if (previous.seed !== next.seed) return false;
  if (next.eventHistory.length < previous.eventHistory.length) return false;
  // Same seed, but a different (replayed) life: its earlier events differ.
  return previous.eventHistory.every((record, index) => sameRecord(record, next.eventHistory[index]));
}

function sameRecord(a: EventRecord, b: EventRecord | undefined): boolean {
  return b !== undefined && a.id === b.id && a.ageInMonths === b.ageInMonths && a.choiceId === b.choiceId;
}

/**
 * Total REAL change (after clamping to 0–100) per stat, trait and family
 * value, of the events recorded between `previous` and `next`.
 *
 * Events are recorded when they are applied: an event without choices in
 * the month it happens, an event with choices when the player answers.
 * Several months can pass between two renders (fast speeds, "skip"), so
 * all new records are summed.
 */
export function newEventChanges(previous: FlashSource | undefined, next: FlashSource): FlashChanges {
  if (previous === undefined || !continuesLife(previous, next)) return {};

  const totals: FlashChanges = {};
  for (const record of next.eventHistory.slice(previous.eventHistory.length)) {
    for (const chip of chipsOfRecord(next, record)) {
      totals[chip.target] = (totals[chip.target] ?? 0) + chip.amount;
    }
  }
  for (const target of Object.keys(totals) as FlashTarget[]) {
    if (Math.abs(totals[target]!) < MIN_VISIBLE) delete totals[target];
  }
  return totals;
}
