import { BALANCE } from '../data/balance';
import { knowsOwnTraits } from '../engine/passive';
import type { Condition, Environment, GameState, StatTarget, Traits } from '../engine/types';
import { t } from '../i18n/i18n';
import { habitSourceMonths } from './months';
import { StatBar, type StatChange } from './StatBar';

// Explicit display order (Object.keys order is an implementation detail).
const CONDITION_KEYS: (keyof Condition)[] = ['physicalHealth', 'mentalHealth', 'knowledge'];
const TRAIT_KEYS: (keyof Traits)[] = ['discipline', 'resilience', 'riskTaking'];
// Work/financial stress stay hidden until the systems that set them exist.
const ENVIRONMENT_KEYS: (keyof Environment)[] = ['familyWealth', 'familyWarmth'];

/**
 * Last year's change of a stat = the sum of its logged sources, plus the
 * sources themselves for the breakdown popover. Both come from the same log,
 * so the "▲/▼" number always equals the total shown in the breakdown.
 */
function lastYearChange(game: GameState, target: StatTarget): StatChange | undefined {
  const lastYear = game.history.at(-1);
  if (lastYear === undefined) return undefined;
  const sources = lastYear.changes[target] ?? {};
  return {
    total: Object.values(sources).reduce((sum, amount) => sum + amount, 0),
    sources,
    explainContext: { age: lastYear.age, physicalWear: game.hidden.physicalWear },
    // Habits can change mid-year (D38): say how many months each one applied.
    sourceMonths: habitSourceMonths(lastYear.habits ?? []),
  };
}

export function CharacterPanel({ game }: { game: GameState }) {
  return (
    <div className="panels">
      <section className="card">
        <h2>{t('layer.condition')}</h2>
        {CONDITION_KEYS.map((key) => (
          <StatBar key={key} label={t(`stat.${key}`)} value={game.condition[key]} change={lastYearChange(game, key)} />
        ))}
      </section>

      <section className="card">
        <h2>{t('layer.outcome')}</h2>
        <StatBar label={t('stat.looks')} value={game.outcome.looks} change={lastYearChange(game, 'looks')} />
      </section>

      {/* Traits and environment do not change yet, so they have no change indicator.
          D35: traits are hidden until Grade 1 (they still act in the engine). */}
      <section className="card">
        <h2>{t('layer.traits')}</h2>
        {knowsOwnTraits(game) ? (
          TRAIT_KEYS.map((key) => <StatBar key={key} label={t(`stat.${key}`)} value={game.traits[key]} />)
        ) : (
          <>
            <p>{t('traits.locked', { age: BALANCE.earlyChildhood.ownLifestyleFromAge })}</p>
            <p className="muted small">{t('traits.lockedReason')}</p>
          </>
        )}
      </section>

      <section className="card">
        <h2>{t('layer.environment')}</h2>
        {ENVIRONMENT_KEYS.map((key) => (
          <StatBar key={key} label={t(`stat.${key}`)} value={game.environment[key]} />
        ))}
      </section>
    </div>
  );
}
