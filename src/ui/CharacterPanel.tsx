import { useState } from 'react';
import { BALANCE } from '../data/balance';
import { knowsOwnTraits } from '../engine/passive';
import { SKILL_KEYS, TRAIT_KEYS, type Condition, type Environment, type GameState, type StatTarget } from '../engine/types';
import { t } from '../i18n/i18n';
import { comparePoints } from './compare';
import { CompareDialog } from './CompareDialog';
import { habitSourceMonths } from './months';
import { StatBar, type StatChange } from './StatBar';
import { useEventFlash } from './useEventFlash';

// Explicit display order (Object.keys order is an implementation detail).
const CONDITION_KEYS: (keyof Condition)[] = ['physicalHealth', 'mentalHealth'];
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
  const flashes = useEventFlash(game);
  const lastYear = game.history.at(-1);
  const [compareOpen, setCompareOpen] = useState(false);
  // Nothing to compare with in a save from before birth values were kept, until its first birthday.
  const canCompare = comparePoints(game).length > 0;

  return (
    <div className="panels">
      <section className="card">
        <div className="card__header">
          <h2>{t('layer.condition')}</h2>
          {canCompare && (
            <button type="button" className="button button--small" onClick={() => setCompareOpen(true)}>
              {t('compare.open')}
            </button>
          )}
        </div>
        {CONDITION_KEYS.map((key) => (
          <StatBar
            key={key}
            label={t(`stat.${key}`)}
            value={game.condition[key]}
            change={lastYearChange(game, key)}
            flash={flashes[key]}
          />
        ))}
        {/* The ▲/▼ lags behind events by up to a year; say what it measures. */}
        {lastYear !== undefined && (
          <p className="muted small stat-hint">{t('stat.changeHint', { from: lastYear.age - 1, to: lastYear.age })}</p>
        )}
        {compareOpen && <CompareDialog game={game} onClose={() => setCompareOpen(false)} />}
      </section>

      {/* D65: four skills instead of one "knowledge"; no total on purpose
          (someone great at one thing would look average). */}
      <section className="card">
        <h2>{t('layer.skills')}</h2>
        {SKILL_KEYS.map((key) => (
          <StatBar
            key={key}
            label={t(`stat.${key}`)}
            value={game.skills[key]}
            change={lastYearChange(game, key)}
            flash={flashes[key]}
          />
        ))}
      </section>

      <section className="card">
        <h2>{t('layer.outcome')}</h2>
        <StatBar
          label={t('stat.looks')}
          value={game.outcome.looks}
          change={lastYearChange(game, 'looks')}
          flash={flashes.looks}
        />
      </section>

      {/* Traits and environment have no yearly log, so no ▲/▼; events still flash them.
          D35: traits are hidden until Grade 1 (they still act in the engine). */}
      <section className="card">
        <h2>{t('layer.traits')}</h2>
        {knowsOwnTraits(game) ? (
          TRAIT_KEYS.map((key) => (
            <StatBar key={key} label={t(`stat.${key}`)} value={game.traits[key]} flash={flashes[key]} />
          ))
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
          <StatBar key={key} label={t(`stat.${key}`)} value={game.environment[key]} flash={flashes[key]} />
        ))}
      </section>
    </div>
  );
}
