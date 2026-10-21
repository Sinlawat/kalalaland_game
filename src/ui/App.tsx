import { shouldRevealTraits } from '../actions/traits';
import { t } from '../i18n/i18n';
import { TraitRevealDialog } from './TraitRevealDialog';
import { CharacterPanel } from './CharacterPanel';
import { DeathScreen } from './DeathScreen';
import { formatAge } from './format';
import { HabitControls } from './HabitControls';
import { SceneFrame } from './SceneFrame';
import { StartScreen } from './StartScreen';
import { useGame } from './useGame';
import { YearSummaryPanel } from './YearSummaryPanel';

export function App() {
  const controller = useGame();
  const { game } = controller;

  if (game === null) {
    return (
      <StartScreen
        resumable={controller.resumable}
        loadError={controller.loadError}
        onStart={controller.startNewLife}
        onResume={controller.resume}
      />
    );
  }

  if (game.death !== null) {
    return (
      <DeathScreen
        game={game}
        onReplay={() => controller.startNewLife(game.seed)}
        onNewLife={controller.quitToStart}
      />
    );
  }

  // Always show the most recent completed year — also right after loading a
  // save, not only at the moment a birthday was reached.
  const lastYear = game.history.at(-1);

  return (
    <main className="screen screen--wide">
      <header className="topbar card">
        <div>
          <h1 className="topbar__name">
            {game.name.first} {game.name.last}
          </h1>
          <p className="muted">
            {formatAge(game.ageInMonths)} · {t(`region.${game.regionId}`)}
          </p>
        </div>
        <span className="muted small">{t('status.seed', { seed: game.seed })}</span>
      </header>

      {controller.saveFailed && <p className="notice notice--error">{t('save.error.unwritable')}</p>}

      {/* Layout areas are placed by CSS grid (see .play in styles.css), so the
          order here is the reading order for screen readers and phones. */}
      <div className="play">
        <div className="play__scene">
          <SceneFrame />
        </div>

        <div className="play__summary">
          {lastYear ? (
            <YearSummaryPanel
              summary={lastYear}
              explainContext={{ age: lastYear.age, physicalWear: game.hidden.physicalWear }}
            />
          ) : (
            <section className="card">
              <p className="muted small">{t('summary.firstYearHint')}</p>
            </section>
          )}
        </div>

        <div className="play__stats">
          <CharacterPanel game={game} lastYear={lastYear} />
        </div>

        <div className="play__habits">
          <HabitControls game={game} onChange={controller.changeHabit} />
        </div>
      </div>

      {shouldRevealTraits(game) && <TraitRevealDialog game={game} onClose={controller.acknowledgeTraits} />}

      <div className="actions actions--sticky">
        <button type="button" className="button button--primary button--large" onClick={controller.advance}>
          {t('controls.continue')}
        </button>
        <span className="muted small">{t('controls.continueHint')}</span>
      </div>
    </main>
  );
}
