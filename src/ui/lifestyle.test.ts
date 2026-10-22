import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import { habitReason } from './lifestyle';

describe('habitReason (why is my lifestyle like this?)', () => {
  it('unchanged since Grade 1: the family', () => {
    expect(habitReason(makeState({ eventHistory: [] }), 'sleep')).toEqual({ kind: 'family' });
  });

  it('a lasting change names its event', () => {
    const state = makeState({ eventHistory: [{ id: 'fight', ageInMonths: 90, habitChanges: { sleep: 'short' } }] });
    expect(habitReason(state, 'sleep')).toEqual({ kind: 'event', eventId: 'fight' });
    expect(habitReason(state, 'exercise')).toEqual({ kind: 'family' });
  });

  it('a running temporary change shows the months left and the level it returns to', () => {
    const state = makeState({
      ageInMonths: 101,
      eventHistory: [{ id: 'exams', ageInMonths: 100, habitChanges: { sleep: 'short' }, habitMonths: { sleep: 2 } }],
      habitTimers: { sleep: { revertTo: 'enough', untilMonth: 102 } },
    });
    expect(habitReason(state, 'sleep')).toEqual({ kind: 'temporary', eventId: 'exams', monthsLeft: 1, revertTo: 'enough' });
  });

  it('an expired temporary change is skipped: the change before it explains the level', () => {
    const state = makeState({
      ageInMonths: 130,
      eventHistory: [
        { id: 'club', ageInMonths: 90, habitChanges: { exercise: 'regular' } },
        { id: 'flu', ageInMonths: 120, habitChanges: { exercise: 'none' }, habitMonths: { exercise: 2 } },
      ],
      habitTimers: {},
    });
    expect(habitReason(state, 'exercise')).toEqual({ kind: 'event', eventId: 'club' });
  });

  it('changes before Grade 1 do not count (the family lifestyle replaced them)', () => {
    const state = makeState({ eventHistory: [{ id: 'baby', ageInMonths: 30, habitChanges: { sleep: 'short' } }] });
    expect(habitReason(state, 'sleep')).toEqual({ kind: 'family' });
  });
});
