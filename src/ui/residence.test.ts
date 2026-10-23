import { describe, expect, it } from 'vitest';
import { makeState } from '../engine/testUtils';
import { buildTimeline } from './timeline';
import { formatDuration, residenceLabel, residenceMoves } from './residence';

const city = { regionId: 'city', homeId: 'parents' } as const;
const grandparents = { regionId: 'rural', homeId: 'grandparents' } as const;

describe('residenceLabel', () => {
  it('shows only the region for the parents\' home, region and home otherwise', () => {
    expect(residenceLabel(city)).toBe('กลางเมือง');
    expect(residenceLabel(grandparents)).toBe('ชนบท · บ้านตายาย');
  });
});

describe('residenceMoves', () => {
  it('lists the events that moved the character, oldest first, and nothing else', () => {
    const state = makeState({
      eventHistory: [
        { id: 'pox', ageInMonths: 40 },
        { id: 'to_grandparents', ageInMonths: 76, residenceChange: { from: city, to: grandparents } },
        { id: 'back_home', ageInMonths: 120, residenceChange: { from: grandparents, to: city } },
      ],
    });
    expect(residenceMoves(state)).toEqual([
      { ageInMonths: 76, eventId: 'to_grandparents', from: city, to: grandparents },
      { ageInMonths: 120, eventId: 'back_home', from: grandparents, to: city },
    ]);
  });

  it('is empty for a life that never moved', () => {
    expect(residenceMoves(makeState({ eventHistory: [{ id: 'pox', ageInMonths: 40 }] }))).toEqual([]);
  });
});

describe('formatDuration', () => {
  it.each([
    [7, '7 เดือน'],
    [24, '2 ปี'],
    [43, '3 ปี 7 เดือน'],
    [0, '0 เดือน'],
  ])('%i months → %s', (months, text) => {
    expect(formatDuration(months)).toBe(text);
  });
});

describe('timeline: residence change under the event', () => {
  it('carries the move on the timeline entry', () => {
    const state = makeState({
      eventHistory: [{ id: 'to_grandparents', ageInMonths: 76, residenceChange: { from: city, to: grandparents } }],
      history: [],
      yearLog: {},
    });
    expect(buildTimeline(state)[0]!.entries[0]!.residenceChange).toEqual({ from: city, to: grandparents });
  });
});
