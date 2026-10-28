import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatStat } from './format';
import { StatHud } from './StatHud';
import { showsFamilyMoneyStress } from './work';
import { BALANCE } from '../data/balance';

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
      {/* D77: the family's money stress, bottom centre of the picture, while it is the family's. */}
      {showsFamilyMoneyStress(game) && (
        <p className="scene__stress" title={t('familyStress.hint', { until: BALANCE.familyMoneyStress.untilAge })}>
          <span aria-hidden="true">😟</span> {t('familyStress.label')} <strong>{formatStat(game.environment.financialStress)}</strong>
        </p>
      )}
    </section>
  );
}
