import { useEffect, useRef } from 'react';
import { TRAIT_KEYS, type GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatStat, traitBand } from './format';

interface Props {
  game: GameState;
  /** Called when the player closes the popup (button or Escape). */
  onClose(): void;
}

/**
 * One-time popup at Grade 1: "this is who you are" (D35).
 *
 * Uses the native <dialog> element with showModal():
 * - the browser traps keyboard focus inside and makes the page behind inert,
 * - Escape closes it, and screen readers announce it as a dialog,
 * all without a library. (Not to be confused with alert()/confirm(),
 * which block the whole page and cannot be styled.)
 */
export function TraitRevealDialog({ game, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    // Guard: React StrictMode runs effects twice in development, and calling
    // showModal() on an already open dialog throws.
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="trait-reveal-title" onClose={onClose}>
      <h2 id="trait-reveal-title">{t('traitReveal.title')}</h2>
      <p className="muted">{t('traitReveal.intro', { name: game.nickname })}</p>
      <ul className="trait-list">
        {TRAIT_KEYS.map((key) => {
          const value = game.traits[key];
          return (
            <li key={key} className="trait-list__item">
              <div className="trait-list__head">
                <strong>{t(`stat.${key}`)}</strong>
                <span className="trait-list__value">{formatStat(value)}</span>
              </div>
              <p>{t(`trait.${key}.${traitBand(value)}`)}</p>
              <p className="muted small">{t(`trait.${key}.effect`)}</p>
            </li>
          );
        })}
      </ul>
      <p className="muted small">{t('traitReveal.footer')}</p>
      {/* method="dialog": submitting closes the dialog and fires onClose. */}
      <form method="dialog">
        <button type="submit" className="button button--primary" autoFocus>
          {t('traitReveal.ok')}
        </button>
      </form>
    </dialog>
  );
}
