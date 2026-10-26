import { describe, expect, it } from 'vitest';
import { simulateWholeLife } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import { DEATH_CAUSES, HABIT_LEVELS as HABIT_OPTIONS, REGION_IDS, SKILL_KEYS, TRAIT_KEYS, type HabitKey } from '../engine/types';
import { hasMessage, t } from './i18n';

describe('t', () => {
  it('replaces placeholders', () => {
    expect(t('status.age', { years: 3, months: 4 })).toBe('อายุ 3 ปี 4 เดือน');
  });

  it('leaves unknown placeholders visible', () => {
    expect(t('x', {}, { x: 'hello {who}' })).toBe('hello {who}');
  });

  it('returns the key itself when the message is missing', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
});

/**
 * Data validation: every key the engine or UI can produce must have Thai text.
 * Without this, a new habit level or log source would show up as a raw key.
 */
describe('th.json completeness', () => {
  it('has every region, death cause, stat, trait description and habit option', () => {
    const keys = [
      ...REGION_IDS.map((id) => `region.${id}`),
      ...DEATH_CAUSES.map((cause) => `death.cause.${cause}`),
      ...[...TRAIT_KEYS, ...SKILL_KEYS, 'familyWealth', 'familyWarmth', 'workStress',
        'financialStress', 'physicalHealth', 'mentalHealth', 'looks', 'fame'].map((s) => `stat.${s}`),
      // D65: each skill's trait explains its own learning line in the breakdown.
      ...TRAIT_KEYS.flatMap((trait) => [`source.trait.${trait}.learning`, `explain.trait.${trait}.learning`]),
      ...TRAIT_KEYS.flatMap((trait) =>
        ['low', 'mid', 'high', 'effect'].map((part) => `trait.${trait}.${part}`),
      ),
      ...(Object.keys(HABIT_OPTIONS) as HabitKey[]).flatMap((habit) => [
        `habit.${habit}`,
        ...HABIT_OPTIONS[habit].map((level) => `habit.${habit}.${level}`),
        ...HABIT_OPTIONS[habit].map((level) => `source.habit.${habit}.${level}`),
      ]),
    ];
    const missing = keys.filter((key) => !hasMessage(key));
    expect(missing).toEqual([]);
  });

  it('has text for every log source that real lives produce', () => {
    const sources = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      // Vary habits and work so that conditional sources appear too.
      const life = createNewLife(seed);
      life.flags = seed % 2 === 0 ? ['working'] : [];
      life.environment.workStress = 60;
      life.environment.financialStress = 40;
      life.habits = {
        exercise: HABIT_OPTIONS.exercise[seed % 3]!,
        sleep: HABIT_OPTIONS.sleep[seed % 2]!,
        overtime: HABIT_OPTIONS.overtime[seed % 3]!,
        // D69: addictions too, so their breakdown lines are checked for labels.
        smoking: HABIT_OPTIONS.smoking[seed % 2]!,
        drinking: HABIT_OPTIONS.drinking[(seed >> 1) % 2]!,
      };
      for (const year of simulateWholeLife(life).history) {
        for (const bySource of Object.values(year.changes)) {
          for (const source of Object.keys(bySource)) sources.add(source);
        }
      }
    }
    // Event sources ("event.<id>") are named by the event's own title; the rest by "source.<key>".
    const labelKey = (source: string) => (source.startsWith('event.') ? `${source}.title` : `source.${source}`);
    const missing = [...sources].filter((source) => !hasMessage(labelKey(source)));
    expect(missing).toEqual([]);
  });
});
