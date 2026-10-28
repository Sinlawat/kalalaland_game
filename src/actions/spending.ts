/**
 * D80: the player sets how freely the character spends their own money
 * (design doc section 9, player action "change the spending level"). It is
 * not a habit: habits change only through events (D50), but money is the
 * player's to manage.
 */

import type { GameState, SpendingLevel } from '../engine/types';

/** Returns a NEW state with the spending level set (the same state when it is already that level). */
export function setSpendingLevel(state: GameState, level: SpendingLevel): GameState {
  if (state.money.spendingLevel === level) return state;
  return { ...state, money: { ...state.money, spendingLevel: level } };
}
