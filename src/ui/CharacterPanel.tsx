import { BALANCE } from '../data/balance';
import { knowsOwnTraits } from '../engine/passive';
import type { Condition, Environment, GameState, StatTarget, Traits, YearSummary } from '../engine/types';
import { t } from '../i18n/i18n';
import { StatBar } from './StatBar';

// Explicit display order (Object.keys order is an implementation detail).
const CONDITION_KEYS: (keyof Condition)[] = ['physicalHealth', 'mentalHealth', 'knowledge'];
const TRAIT_KEYS: (keyof Traits)[] = ['discipline', 'resilience', 'riskTaking'];
// Work/financial stress stay hidden until the systems that set them exist.
const ENVIRONMENT_KEYS: (keyof Environment)[] = ['familyWealth', 'familyWarmth'];

interface Props {
  game: GameState;
  /** The latest completed year; its totals are the "▲/▼" next to each bar. */
  lastYear: YearSummary | undefined;
}

/**
 * The change of a stat over the last year = the sum of its logged sources.
 * Reusing the yearly log (instead of storing last year's values separately)
 * guarantees the number beside the bar equals the total in the summary.
 */
function yearlyChange(lastYear: YearSummary | undefined, target: StatTarget): number | undefined {
  if (lastYear === undefined) return undefined;
  return Object.values(lastYear.changes[target] ?? {}).reduce((sum, amount) => sum + amount, 0);
}

export function CharacterPanel({ game, lastYear }: Props) {
  return (
    <div className="panels">
      <section className="card">
        <h2>{t('layer.condition')}</h2>
        {CONDITION_KEYS.map((key) => (
          <StatBar key={key} label={t(`stat.${key}`)} value={game.condition[key]} change={yearlyChange(lastYear, key)} />
        ))}
      </section>

      <section className="card">
        <h2>{t('layer.outcome')}</h2>
        <StatBar label={t('stat.looks')} value={game.outcome.looks} change={yearlyChange(lastYear, 'looks')} />
      </section>

      {/* Traits and environment do not change yet, so they have no change indicator.
          D35: traits are hidden until Grade 1 (they still act in the engine). */}
      <section className="card">
        <h2>{t('layer.traits')}</h2>
        {knowsOwnTraits(game) ? (
          TRAIT_KEYS.map((key) => <StatBar key={key} label={t(`stat.${key}`)} value={game.traits[key]} />)
        ) : (
          <>
            <p>{t('traits.locked', { age: BALANCE.earlyChildhood.playerChoosesHabitsFromAge })}</p>
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
