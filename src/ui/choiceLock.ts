/**
 * Why a choice is locked, in words (D39: a locked choice is shown disabled,
 * with the reason). Pure functions, so they can be tested without React.
 *
 * Whose words are used, first match wins:
 * 1. `event.<id>.choice.<choice>.locked`: the writer explains the whole lock
 *    in one sentence (required for flag conditions, which cannot explain
 *    themselves; optional otherwise, e.g. house rules).
 * 2. `event.<id>.choice.<choice>.locked.<stat>`: the writer explains one stat
 *    condition (D73, e.g. mental health too low to apologise first). Used when
 *    a choice has several conditions and each needs its own reason: a single
 *    sentence would give the wrong reason when another condition is the one
 *    that is not met.
 * 3. Otherwise the game writes the condition out ("needs X at least 50").
 * Several unmet conditions are joined with " · ".
 */

import type { EventChoice, LockReason } from '../engine/events';
import { knowsOwnTraits } from '../engine/passive';
import { TRAIT_KEYS, type GameState } from '../engine/types';
import { hasMessage, t } from '../i18n/i18n';
import { formatStat } from './format';

type Params = Record<string, string>;

/** Text the game writes itself for one unmet condition. */
function automaticReason(game: GameState, reason: LockReason): string {
  switch (reason.kind) {
    case 'flag':
      return t('choice.locked.generic');
    case 'habit':
      return t('choice.locked.habit', { habit: t(`habit.${reason.habit}`), level: t(`habit.${reason.habit}.${reason.level}`) });
    case 'stat':
      // Before Grade 1 the child does not know their traits (D35): don't spell them out.
      if ((TRAIT_KEYS as readonly string[]).includes(reason.stat) && !knowsOwnTraits(game)) return t('choice.locked.generic');
      return t(reason.op === '>=' ? 'choice.locked.atLeast' : 'choice.locked.below', {
        stat: t(`stat.${reason.stat}`),
        value: reason.value,
        current: formatStat(reason.current),
      });
  }
}

/** The key for the writer's own words about one stat condition of a choice. */
export function statLockKey(eventId: string, choiceId: string, stat: string): string {
  return `event.${eventId}.choice.${choiceId}.locked.${stat}`;
}

/** The writer's words for one unmet condition when there are some, otherwise the game's. */
function reasonText(game: GameState, eventId: string, choiceId: string, reason: LockReason, params: Params): string {
  if (reason.kind === 'stat') {
    const key = statLockKey(eventId, choiceId, reason.stat);
    if (hasMessage(key)) return t(key, params);
  }
  return automaticReason(game, reason);
}

/** Text shown under a locked choice. `reasons` = what `lockReasons` returned (not empty). */
export function lockedText(game: GameState, eventId: string, choice: EventChoice, reasons: LockReason[], params: Params): string {
  const key = `event.${eventId}.choice.${choice.id}.locked`;
  if (hasMessage(key)) return t(key, params);
  return reasons.map((reason) => reasonText(game, eventId, choice.id, reason, params)).join(' · ');
}
