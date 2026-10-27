import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { StatHud } from './StatHud';

/**
 * The frame for the future pixel-art scene that shows the character's life
 * at a glance (home, age, mood...), full width under the playback bar.
 * Only the frame exists for now, so the layout is final and the art can be
 * dropped in later without moving anything else on the screen.
 *
 * D75: the stats at a glance sit over its top corners (StatHud). On a phone
 * the frame is too small for that, so the boxes move below the picture.
 */
export function SceneFrame({ game }: { game: GameState }) {
  return (
    <section className="card scene" aria-label={t('scene.label')}>
      <div className="scene__canvas">
        <span className="muted small">{t('scene.placeholder')}</span>
      </div>
      <StatHud game={game} />
    </section>
  );
}
