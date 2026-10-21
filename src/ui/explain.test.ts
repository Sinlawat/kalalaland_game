import { describe, expect, it } from 'vitest';
import { BALANCE } from '../data/balance';
import { physicalSetPoint } from '../engine/passive';
import th from '../i18n/th.json';
import { explainSource } from './explain';

const messages: Record<string, string> = th;
const keysWith = (prefix: string): string[] =>
  Object.keys(messages)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

describe('explanations', () => {
  it('exist for every log source that has a name, and only for those', () => {
    // A new source without an explanation would show an empty or raw-key tooltip.
    expect(keysWith('explain.').sort()).toEqual(keysWith('source.').sort());
  });

  it('never leave an unfilled {placeholder}', () => {
    for (const source of keysWith('source.')) {
      expect(explainSource(source, { age: 40, physicalWear: 10 })).not.toMatch(/\{\w+\}/);
    }
  });

  it('state the normal level of mental health from the balance data', () => {
    expect(explainSource('mind.drift', { age: 30, physicalWear: 0 })).toContain(
      `คือ ${BALANCE.mentalHealth.setPoint}`,
    );
  });

  it('state the normal physical level for the age of the summary', () => {
    const normal = Math.round(physicalSetPoint(60));
    expect(explainSource('body.drift', { age: 60, physicalWear: 0 })).toContain(`คือ ${normal}`);
  });

  it('show how far wear has lowered the real normal level', () => {
    const normal = Math.round(physicalSetPoint(40));
    const text = explainSource('body.wear', { age: 40, physicalWear: 12 });
    expect(text).toContain(`จาก ${normal} เหลือ ${normal - 12}`);
  });
});
