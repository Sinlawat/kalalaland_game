import { useState } from 'react';
import { shouldRevealTraits } from '../actions/traits';
import { t } from '../i18n/i18n';
import { CharacterPanel } from './CharacterPanel';
import { ChoiceDialog } from './ChoiceDialog';
import { DeathScreen } from './DeathScreen';
import { formatAge } from './format';
import { LifeTimeline } from './LifeTimeline';
import { FriendsCard } from './FriendsCard';
import { LifestylePanel } from './LifestylePanel';
import { PlaybackBar } from './PlaybackBar';
import { residenceLabel } from './residence';
import { ResidenceDialog } from './ResidenceDialog';
import { SceneFrame } from './SceneFrame';
import { StartScreen } from './StartScreen';
import { TraitRevealDialog } from './TraitRevealDialog';
import { useGame } from './useGame';

export function App() {
  const controller = useGame();
  const { game } = controller;
  // Hooks must run on every render, so this sits above the early returns.
  const [residenceOpen, setResidenceOpen] = useState(false);

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

  return (
    <main className="screen screen--wide">
      <header className="topbar card">
        <div>
          <h1 className="topbar__name">{game.nickname}</h1>
          <p className="muted">
            {t(`sex.${game.sex}`)} · {formatAge(game.ageInMonths)} · {residenceLabel(game.residence)}
          </p>
          <div className="topbar__actions">
            <button type="button" className="button button--small" onClick={() => setResidenceOpen(true)}>
              {t('residence.open')}
            </button>
          </div>
        </div>
        <span className="muted small">{t('status.seed', { seed: game.seed })}</span>
      </header>

      {residenceOpen && <ResidenceDialog game={game} onClose={() => setResidenceOpen(false)} />}

      {/* Time sits right under who and how old: the two things read together. */}
      <div className="playback-dock">
        <PlaybackBar game={game} controller={controller} />
      </div>

      {controller.saveFailed && <p className="notice notice--error">{t('save.error.unwritable')}</p>}

      {/* Layout areas are placed by CSS grid (see .play in styles.css), so the
          order here is the reading order for screen readers and phones. */}
      <div className="play">
        <div className="play__scene">
          <SceneFrame game={game} />
        </div>

        <div className="play__summary">
          <LifeTimeline game={game} />
        </div>

        {/* D75: the stats at a glance are over the scene; the detailed cards follow the friends card. */}
        <div className="play__habits">
          <LifestylePanel game={game} />
          <FriendsCard game={game} />
          <CharacterPanel game={game} />
        </div>
      </div>

      {/* One popup at a time. A choice belongs to a month that is still
          running, so it comes before the trait reveal of the same month. */}
      {game.pendingChoices.length > 0 ? (
        <ChoiceDialog key={game.pendingChoices[0]!.eventId} game={game} onChoose={controller.choose} />
      ) : (
        shouldRevealTraits(game) && <TraitRevealDialog game={game} onClose={controller.acknowledgeTraits} />
      )}
    </main>
  );
}
