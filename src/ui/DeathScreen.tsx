import { SKILL_KEYS, type GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatStat } from './format';

interface Props {
  game: GameState;
  onReplay(): void;
  onNewLife(): void;
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 140;

/** Simple SVG line chart of yearly snapshots — no chart library needed for two lines. */
function HealthTimeline({ game }: { game: GameState }) {
  const points = game.history;
  if (points.length < 2) return null;
  const x = (index: number) => (index / (points.length - 1)) * CHART_WIDTH;
  const y = (value: number) => CHART_HEIGHT - (value / 100) * CHART_HEIGHT;
  const path = (pick: (s: (typeof points)[number]['snapshot']) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(p.snapshot)).toFixed(1)}`).join(' ');

  return (
    <figure className="timeline">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={t('death.timeline')}>
        <path d={path((s) => s.physicalHealth)} className="timeline__physical" />
        <path d={path((s) => s.mentalHealth)} className="timeline__mental" />
      </svg>
      <figcaption className="timeline__legend small">
        <span className="legend legend--physical">{t('stat.physicalHealth')}</span>
        <span className="legend legend--mental">{t('stat.mentalHealth')}</span>
        <span className="muted">0 – {Math.floor(game.ageInMonths / 12)}</span>
      </figcaption>
    </figure>
  );
}

export function DeathScreen({ game, onReplay, onNewLife }: Props) {
  if (game.death === null) return null;
  const age = Math.floor(game.death.ageInMonths / 12);
  const peak = (pick: (s: GameState['history'][number]['snapshot']) => number) =>
    Math.max(...game.history.map((h) => pick(h.snapshot)));
  // D65: no single "knowledge" any more; show the skill that got the highest.
  const topSkill = SKILL_KEYS.map((key) => ({ key, value: peak((s) => s.skills[key]) })).reduce((best, next) =>
    next.value > best.value ? next : best,
  );

  return (
    <main className="screen">
      <section className="card death">
        <h1>{t('death.title', { name: game.nickname, age })}</h1>
        <p>{t('death.cause', { cause: t(`death.cause.${game.death.cause}`) })}</p>
        <p className="muted small">{t('status.seed', { seed: game.seed })}</p>
      </section>

      <section className="card">
        <h2>{t('death.timeline')}</h2>
        <HealthTimeline game={game} />
      </section>

      <section className="card">
        <h2>{t('death.peaks')}</h2>
        <ul className="peaks">
          <li>
            {t('death.topSkill', { skill: t(`stat.${topSkill.key}`) })} <strong>{formatStat(topSkill.value)}</strong>
          </li>
          <li>
            {t('stat.looks')} <strong>{formatStat(peak((s) => s.looks))}</strong>
          </li>
        </ul>
      </section>

      {/* The final-year summary was removed on purpose: the last year is usually
          only a few months, so its numbers mean little. A proper life summary
          (dreams, best rankings, key events — design doc section 3) comes
          after the dream, NPC and event systems exist. */}

      <div className="actions">
        <button type="button" className="button" onClick={onReplay}>
          {t('death.replay')}
        </button>
        <button type="button" className="button button--primary" onClick={onNewLife}>
          {t('start.newLife')}
        </button>
      </div>
    </main>
  );
}
