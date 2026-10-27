/**
 * D75: the small emoji + number boxes drawn over the scene frame. Pure
 * functions (no React), unit-tested directly; StatHud renders them.
 *
 * The boxes show the same values as the stat cards, rounded, without bars
 * or ▲▼: they are for a glance. The cards below keep the detail.
 */

import { knowsOwnTraits } from '../engine/passive';
import { SKILL_KEYS, TRAIT_KEYS, type GameState } from '../engine/types';
import type { FlashTarget } from './eventFlash';
import { formatStat } from './format';

/** One emoji per stat the screen shows. */
export const STAT_EMOJI = {
  physicalHealth: '💪',
  mentalHealth: '🧘',
  academic: '📚',
  creative: '🎨',
  communication: '💬',
  practical: '🛠️',
  looks: '✨',
  discipline: '⏰',
  resilience: '🌱',
  riskTaking: '🎲',
  imagination: '💭',
  familyWealth: '💰',
  familyWarmth: '🏡',
} as const satisfies Partial<Record<FlashTarget, string>>;

export type HudStat = keyof typeof STAT_EMOJI;

export interface HudItem {
  key: HudStat;
  emoji: string;
  /** Rounded like the cards; undefined while the value is hidden (traits before Grade 1). */
  value?: string;
}

export interface HudGroup {
  /** i18n key of the group title (the same titles as the stat cards). */
  titleKey: string;
  items: HudItem[];
}

/** Left box and right box, in the cards' order. */
export interface Hud {
  left: HudGroup[];
  right: HudGroup[];
}

type HudSource = Pick<GameState, 'condition' | 'skills' | 'outcome' | 'traits' | 'environment' | 'ageInMonths'>;

function item(key: HudStat, value: number | undefined): HudItem {
  return value === undefined ? { key, emoji: STAT_EMOJI[key] } : { key, emoji: STAT_EMOJI[key], value: formatStat(value) };
}

export function hudGroups(game: HudSource): Hud {
  // D35: traits stay hidden until Grade 1, here as on the cards.
  const traitsKnown = knowsOwnTraits(game);
  return {
    left: [
      { titleKey: 'layer.condition', items: [item('physicalHealth', game.condition.physicalHealth), item('mentalHealth', game.condition.mentalHealth)] },
      { titleKey: 'layer.skills', items: SKILL_KEYS.map((key) => item(key, game.skills[key])) },
      { titleKey: 'layer.outcome', items: [item('looks', game.outcome.looks)] },
    ],
    right: [
      { titleKey: 'layer.traits', items: TRAIT_KEYS.map((key) => item(key, traitsKnown ? game.traits[key] : undefined)) },
      // Work and financial stress stay hidden until the systems that set them exist (as on the cards).
      { titleKey: 'layer.environment', items: [item('familyWealth', game.environment.familyWealth), item('familyWarmth', game.environment.familyWarmth)] },
    ],
  };
}

/**
 * The "+2" that floats up beside a number after an event. Whole numbers, like
 * the numbers in the box; an effect smaller than 0.5 would round to 0 and
 * look like nothing happened, so it keeps one decimal.
 */
export function formatHudDelta(amount: number): string {
  const size = Math.abs(amount);
  const text = size >= 0.5 ? String(Math.round(size)) : size.toFixed(1);
  return amount > 0 ? `+${text}` : `−${text}`;
}
