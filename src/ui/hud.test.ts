import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import { hasMessage } from '../i18n/i18n';
import { formatHudDelta, hudGroups, MONEY_EMOJI, STAT_EMOJI } from './hud';

const keysOf = (groups: ReturnType<typeof hudGroups>['left']) => groups.flatMap((group) => group.items.map((item) => item.key));

describe('hudGroups (D75)', () => {
  it('shows every stat of the cards once: condition, skills, outcome on the left; traits, environment on the right', () => {
    const hud = hudGroups(makeState());
    expect(hud.left.map((group) => group.titleKey)).toEqual(['layer.condition', 'layer.skills', 'layer.outcome']);
    expect(hud.right.map((group) => group.titleKey)).toEqual(['layer.traits', 'layer.environment']);
    expect(keysOf(hud.left)).toEqual(['physicalHealth', 'mentalHealth', 'academic', 'creative', 'communication', 'practical', 'looks', 'money']);
    expect(keysOf(hud.right)).toEqual(['discipline', 'resilience', 'riskTaking', 'imagination', 'familyWealth', 'familyWarmth']);
  });

  it('D77: the savings sit with the outcome, in baht with thousands separators, and never flash like a 0–100 stat', () => {
    const state = makeState();
    state.money.cash = 12400;
    const money = hudGroups(state).left[2]!.items.at(-1)!;
    expect(money).toEqual({ key: 'money', emoji: MONEY_EMOJI, value: '12,400' });
    expect(Object.values(STAT_EMOJI)).not.toContain(MONEY_EMOJI);
    expect(hasMessage('stat.money')).toBe(true);
  });

  it('every stat has its own emoji and a Thai name', () => {
    const keys = Object.keys(STAT_EMOJI);
    expect(new Set(Object.values(STAT_EMOJI)).size).toBe(keys.length);
    expect(keys.filter((key) => !hasMessage(`stat.${key}`))).toEqual([]);
    expect(hasMessage('hud.locked')).toBe(true);
  });

  it('rounds values the way the cards do', () => {
    const hud = hudGroups(makeState({ condition: { physicalHealth: 78.6, mentalHealth: 64.4 } }));
    expect(hud.left[0]!.items.map((item) => item.value)).toEqual(['79', '64']);
  });

  it('hides traits before Grade 1 (D35), shows them after', () => {
    const traitValues = (ageInMonths: number) => hudGroups(makeState({ ageInMonths })).right[0]!.items.map((item) => item.value);
    expect(traitValues(5 * 12)).toEqual([undefined, undefined, undefined, undefined]);
    expect(traitValues(30 * 12).every((value) => value !== undefined)).toBe(true);
  });
});

describe('formatHudDelta', () => {
  it.each([
    [2.4, '+2'],
    [-3.6, '−4'],
    [0.5, '+1'],
    [10, '+10'],
    // Smaller than half a point would round to 0: keep one decimal.
    [0.3, '+0.3'],
    [-0.2, '−0.2'],
  ])('%d → "%s"', (amount, text) => {
    expect(formatHudDelta(amount)).toBe(text);
  });
});
