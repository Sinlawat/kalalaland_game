import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatAge } from './format';
import { formatDuration, residenceLabel, residenceMoves } from './residence';
import { useModal } from './useModal';

interface Props {
  game: GameState;
  onClose(): void;
}

/**
 * "Where do I live now?" — the current home, since when and why, the birth
 * region, and every move (newest first, birth last).
 */
export function ResidenceDialog({ game, onClose }: Props) {
  const dialogRef = useModal();
  const moves = residenceMoves(game);
  const lastMove = moves.at(-1);
  const atBirthHome = game.residence.homeId === 'parents' && game.residence.regionId === game.birthRegionId;
  // A save from before moves were recorded may live elsewhere with no move on record: then "since" is unknown.
  const sinceMonth = lastMove?.ageInMonths ?? (atBirthHome ? 0 : undefined);

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="residence-title" onClose={onClose}>
      <h2 id="residence-title">{t('residence.title')}</h2>

      <div className="residence-now">
        <strong className="residence-now__place">{residenceLabel(game.residence)}</strong>
        {sinceMonth !== undefined && (
          <span className="muted small">
            {sinceMonth === 0
              ? t('residence.sinceBirth')
              : sinceMonth === game.ageInMonths
                ? t('residence.justMoved')
                : t('residence.since', {
                    duration: formatDuration(game.ageInMonths - sinceMonth),
                    age: formatAge(sinceMonth),
                  })}
          </span>
        )}
        {lastMove && (
          <span className="muted small">{t('residence.because', { event: t(`event.${lastMove.eventId}.title`) })}</span>
        )}
      </div>

      <dl className="residence-facts">
        <dt className="muted">{t('residence.birthplace')}</dt>
        <dd>{residenceLabel({ regionId: game.birthRegionId, homeId: 'parents' })}</dd>
      </dl>

      <h3 className="residence-history__title">{t('residence.history')}</h3>
      <ol className="residence-history">
        {[...moves].reverse().map((move) => (
          <li key={`${move.ageInMonths}:${move.eventId}`} className="residence-history__item">
            <span className="muted small">{formatAge(move.ageInMonths)}</span>
            <span>
              <strong>{residenceLabel(move.to)}</strong>
              <br />
              <span className="muted small">{t(`event.${move.eventId}.title`)}</span>
            </span>
          </li>
        ))}
        <li className="residence-history__item">
          <span className="muted small">{t('residence.birth')}</span>
          <strong>{residenceLabel({ regionId: game.birthRegionId, homeId: 'parents' })}</strong>
        </li>
      </ol>

      <form method="dialog">
        <button type="submit" className="button">
          {t('history.close')}
        </button>
      </form>
    </dialog>
  );
}
