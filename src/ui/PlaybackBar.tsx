import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { MonthBar } from './MonthBar';
import { SPEEDS, type GameController } from './useGame';

interface Props {
  game: GameState;
  controller: GameController;
}

/**
 * The sticky bar at the bottom of the play screen, like a video player:
 * play/pause, speed, and the month bar of the current year (D38).
 */
export function PlaybackBar({ game, controller }: Props) {
  const { running, speed } = controller;
  return (
    <div className="playback">
      <button
        type="button"
        className="button button--primary playback__play"
        onClick={controller.togglePlay}
        aria-pressed={running}
      >
        {running ? `⏸ ${t('controls.pause')}` : `▶ ${t('controls.play')}`}
      </button>

      <div className="segmented playback__speed" role="radiogroup" aria-label={t('controls.speed')}>
        {SPEEDS.map((value) => (
          <label key={value} className="segmented__option">
            <input
              type="radio"
              name="speed"
              value={value}
              checked={speed === value}
              onChange={() => controller.setSpeed(value)}
            />
            <span>{value}×</span>
          </label>
        ))}
      </div>

      <MonthBar game={game} />
    </div>
  );
}
