/**
 * "Compare years": every value now, next to its value on an earlier
 * birthday (or at birth). Pure functions; no React.
 *
 * Numbers are compared AFTER rounding, the way the player sees them on the
 * bars, so "then 27, now 30, +3" always adds up on screen. The ▲/▼ beside
 * the bars keeps the exact change (one decimal) and the reasons.
 */

import { knowsOwnTraits } from '../engine/passive';
import { SKILL_KEYS, TRAIT_KEYS, type EnvironmentKey, type GameState, type LifeSnapshot } from '../engine/types';
import { t } from '../i18n/i18n';

export interface ComparePoint {
  /** 'birth' or 'age-9'. */
  id: string;
  /** For the year picker: "วันเกิดอายุ 9 ปี". */
  label: string;
  /** For the table header: "อายุ 9 ปี". */
  shortLabel: string;
  snapshot: LifeSnapshot;
}

export interface CompareRow {
  key: string;
  label: string;
  /** Missing for values not recorded back then (traits and environment before save version 7). */
  then?: number;
  now: number;
  diff?: number;
}

export interface CompareGroup {
  key: string;
  title: string;
  rows: CompareRow[];
}

type CompareSource = Pick<
  GameState,
  'history' | 'birthSnapshot' | 'condition' | 'skills' | 'outcome' | 'traits' | 'environment' | 'ageInMonths' | 'flags'
>;

/** Points to compare with: birthdays newest first, then birth (when the save has it). */
export function comparePoints(state: CompareSource): ComparePoint[] {
  const birthdays = state.history
    // The final, partial year of a life that ended has a fractional age: not a birthday.
    .filter((summary) => Number.isInteger(summary.age))
    .map((summary) => ({
      id: `age-${summary.age}`,
      label: t('compare.point.birthday', { age: summary.age }),
      shortLabel: t('compare.column.birthday', { age: summary.age }),
      snapshot: summary.snapshot,
    }))
    .reverse();
  const birth = state.birthSnapshot
    ? [{ id: 'birth', label: t('compare.point.birth'), shortLabel: t('compare.point.birth'), snapshot: state.birthSnapshot }]
    : [];
  return [...birthdays, ...birth];
}

function row(key: string, now: number, then: number | undefined): CompareRow {
  const shownNow = Math.round(now);
  if (then === undefined) return { key, label: t(`stat.${key}`), now: shownNow };
  const shownThen = Math.round(then);
  return { key, label: t(`stat.${key}`), then: shownThen, now: shownNow, diff: shownNow - shownThen };
}

// Work and financial stress stay hidden until their systems exist (same as the cards).
const ENVIRONMENT_KEYS: EnvironmentKey[] = ['familyWealth', 'familyWarmth'];

/** The table, grouped like the cards on the play screen: condition, skills, looks, traits (once the child knows them, D35), family. */
export function compareGroups(state: CompareSource, then: LifeSnapshot): CompareGroup[] {
  const groups: CompareGroup[] = [
    {
      key: 'condition',
      title: t('layer.condition'),
      rows: (['physicalHealth', 'mentalHealth'] as const).map((key) => row(key, state.condition[key], then[key])),
    },
    {
      key: 'skills',
      title: t('layer.skills'),
      rows: SKILL_KEYS.map((key) => row(key, state.skills[key], then.skills[key])),
    },
    { key: 'outcome', title: t('layer.outcome'), rows: [row('looks', state.outcome.looks, then.looks)] },
  ];
  if (knowsOwnTraits(state)) {
    groups.push({
      key: 'traits',
      title: t('layer.traits'),
      rows: TRAIT_KEYS.map((key) => row(key, state.traits[key], then.traits?.[key])),
    });
  }
  groups.push({
    key: 'environment',
    title: t('layer.environment'),
    rows: ENVIRONMENT_KEYS.map((key) => row(key, state.environment[key], then.environment?.[key])),
  });
  return groups;
}

/** "+3", "−2" (real minus sign), "0". */
export function formatDiff(diff: number): string {
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `−${Math.abs(diff)}`;
  return '0';
}
