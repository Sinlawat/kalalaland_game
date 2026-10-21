import { t } from '../i18n/i18n';

/**
 * Placeholder for the future pixel-art scene that shows the character's
 * life at a glance (home, age, mood...). Only the frame exists for now, so
 * the layout is final and the art can be dropped in later without moving
 * anything else on the screen.
 */
export function SceneFrame() {
  return (
    <section className="card scene" aria-label={t('scene.label')}>
      <div className="scene__canvas">
        <span className="muted small">{t('scene.placeholder')}</span>
      </div>
    </section>
  );
}
