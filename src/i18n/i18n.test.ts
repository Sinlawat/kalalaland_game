import { describe, expect, it } from 'vitest';
import { HABIT_OPTIONS } from '../actions/habits';
import { simulateWholeLife } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import { DEATH_CAUSES, REGION_IDS, type HabitKey } from '../engine/types';
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
      ...['discipline', 'resilience', 'riskTaking', 'familyWealth', 'familyWarmth', 'workStress',
        'financialStress', 'physicalHealth', 'mentalHealth', 'knowledge', 'looks', 'fame'].map((s) => `stat.${s}`),
      ...['discipline', 'resilience', 'riskTaking'].flatMap((trait) =>
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
      };
      for (const year of simulateWholeLife(life).history) {
        for (const bySource of Object.values(year.changes)) {
          for (const source of Object.keys(bySource)) sources.add(source);
        }
      }
    }
    const missing = [...sources].filter((source) => !hasMessage(`source.${source}`));
    expect(missing).toEqual([]);
  });
});
