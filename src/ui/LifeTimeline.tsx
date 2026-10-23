import { useState } from 'react';
import { knowsOwnTraits } from '../engine/passive';
import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { LifeHistoryDialog } from './LifeHistoryDialog';
import { buildTimeline, countEntries, RECENT_YEARS, splitRecent, withoutTraitChips } from './timeline';
import { TimelineYears } from './TimelineYears';

/**
 * The life timeline card (center of the play screen):
 * - the last 5 years of events, newest first, each with its effects;
 * - a button (top right) to a popup with the older years, when there are any.
 * Stat-by-stat detail lives in the stat bars on the left (ChangePopover).
 */
export function LifeTimeline({ game }: { game: GameState }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const built = buildTimeline(game);
  // D35: traits stay secret until Grade 1, including what events did to them.
  const timeline = knowsOwnTraits(game) ? built : withoutTraitChips(built);
  const { recent, older } = splitRecent(timeline, game.ageInMonths);
  const olderCount = countEntries(older);

  return (
    <section className="card life-timeline" aria-live="polite">
      {/* The history button sits in the header (top right) so it is reachable
          without scrolling past a long list of recent events. */}
      <div className="card__header">
        <h2>{t('timeline.title')}</h2>
        {olderCount > 0 && (
          <button type="button" className="button button--small" onClick={() => setHistoryOpen(true)}>
            {t('timeline.openHistory', { count: olderCount })}
          </button>
        )}
      </div>
      <p className="muted small">{t('timeline.recentHint', { years: RECENT_YEARS })}</p>

      {recent.length === 0 ? (
        <p className="muted small">{t('timeline.empty', { years: RECENT_YEARS })}</p>
      ) : (
        <TimelineYears years={recent} />
      )}

      {historyOpen && <LifeHistoryDialog years={older} onClose={() => setHistoryOpen(false)} />}
    </section>
  );
}
