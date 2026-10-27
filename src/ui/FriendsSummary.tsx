import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { lifeFriends } from './friends';
import { formatDuration } from './residence';

/**
 * D72: "friends and people who mattered" in the life summary. Everyone who
 * was ever a friend, in the order they met, with how long and how it ended.
 * Two counts: friends over the whole life, and those still there at the end.
 */
export function FriendsSummary({ game, endAge }: { game: GameState; endAge: number }) {
  const { rows, lifetime, untilTheEnd } = lifeFriends(game, endAge);

  return (
    <section className="card">
      <h2>{t('lifeFriends.title')}</h2>
      {rows.length === 0 ? (
        <p className="muted">{t('lifeFriends.none')}</p>
      ) : (
        <>
          <p>{t('lifeFriends.counts', { lifetime, untilTheEnd })}</p>
          <ul className="friends-list friends-list--summary">
            {rows.map((row) => (
                <li key={row.id} className="friends-list__item">
                  <span className="friends-list__star" aria-hidden="true">
                    {row.relation === 'best_friend' ? '★' : ''}
                  </span>
                  <strong>{row.nickname}</strong>
                  <span>
                    {t('lifeFriends.span', {
                      relation: t(`relation.${row.relation}`),
                      duration: formatDuration(row.months),
                      from: row.fromAge,
                      to: row.toAge,
                    })}
                    {' · '}
                    {row.endReason === undefined ? t('lifeFriends.untilTheEnd') : t(`endReason.${row.endReason}`)}
                  </span>
                  <span className="muted small friends-list__met">{t('lifeFriends.metVia', { event: t(`event.${row.metVia}.title`) })}</span>
                </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
