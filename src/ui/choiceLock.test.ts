import { describe, expect, it } from 'vitest';
import { findEvent, lockReasons } from '../engine/events';
import { makeState } from '../engine/testUtils';
import { t } from '../i18n/i18n';
import { lockedText } from './choiceLock';

/** The text under a locked choice of a real event, for a given state. */
function textFor(eventId: string, choiceId: string, state: ReturnType<typeof makeState>, params: Record<string, string> = {}): string {
  const choice = findEvent(eventId)!.choices!.find((c) => c.id === choiceId)!;
  const reasons = lockReasons(choice, state);
  expect(reasons.length).toBeGreaterThan(0);
  return lockedText(state, eventId, choice, reasons, params);
}

describe('lockedText (D39, D73)', () => {
  // "Apologise first" needs resilience ≥ 50 and mental health ≥ 55, each with its own reason.
  const apologize = ['social_fell_out', 'apologize'] as const;

  it("uses the writer's words for the condition that is not met", () => {
    const state = makeState({ traits: { resilience: 80 }, condition: { mentalHealth: 40 } });
    expect(textFor(...apologize, state)).toBe(t('event.social_fell_out.choice.apologize.locked.mentalHealth'));
  });

  it("falls back to the game's words for a condition the writer did not explain", () => {
    const state = makeState({ traits: { resilience: 30 }, condition: { mentalHealth: 80 } });
    const text = textFor(...apologize, state);
    expect(text).toBe(t('choice.locked.atLeast', { stat: t('stat.resilience'), value: 50, current: '30' }));
    expect(text).not.toBe(t('event.social_fell_out.choice.apologize.locked.mentalHealth'));
  });

  it('gives every unmet condition, in the order the content lists them', () => {
    const state = makeState({ traits: { resilience: 30 }, condition: { mentalHealth: 40 } });
    expect(textFor(...apologize, state)).toBe(
      [
        t('choice.locked.atLeast', { stat: t('stat.resilience'), value: 50, current: '30' }),
        t('event.social_fell_out.choice.apologize.locked.mentalHealth'),
      ].join(' · '),
    );
  });

  it('fills {name} in the writer\'s words', () => {
    const state = makeState({ traits: { resilience: 80 }, condition: { mentalHealth: 40 } });
    const text = textFor('social_friend_confides', 'listen', state, { name: 'มะปราง' });
    expect(text).toContain('มะปราง');
    expect(text).not.toContain('{name}');
  });

  it('a sentence for the whole choice still wins over everything else', () => {
    const state = makeState({ traits: { discipline: 10 } });
    expect(textFor('social_reckless_dare', 'think_first', state)).toBe(t('event.social_reckless_dare.choice.think_first.locked'));
  });
});
