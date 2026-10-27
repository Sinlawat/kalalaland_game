import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { friendLines } from './friends';

/**
 * D72: the friends the character is still close to, during play. The player
 * gets attached to friends by seeing their names all along, not once at the
 * end. Shown from the first friend on; friendships that ended are in the
 * life summary, not here.
 */
export function FriendsCard({ game }: { game: GameState }) {
  if (game.people.length === 0) return null;
  const lines = friendLines(game);

  return (
    <section className="card friends-card">
      <h2>{t('friends.title')}</h2>
      {lines.length === 0 ? (
        <p className="muted small">{t('friends.none')}</p>
      ) : (
        <ul className="friends-list">
          {lines.map((line) => (
            <li key={line.id} className="friends-list__item">
              <span className="friends-list__star" aria-hidden="true">
                {line.relation === 'best_friend' ? '★' : ''}
              </span>
              <strong>{line.nickname}</strong>
              <span className="muted small">
                {t(line.relation === 'best_friend' ? 'friends.bestSince' : 'friends.friendSince', { age: line.sinceAge })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
