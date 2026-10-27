import { useEffect, useRef } from 'react';
import { findEvent, lockReasons } from '../engine/events';
import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { lockedText } from './choiceLock';

interface Props {
  game: GameState;
  onChoose(choiceId: string): void;
}

/**
 * Popup for an event with choices (D39). Time is held while it is open
 * (useGame), and it cannot be dismissed: the player must pick a choice.
 *
 * Shows the oldest waiting event; when several happened in the same month,
 * the next one appears after this one is answered (App gives each event its
 * own `key`, so React mounts a fresh dialog and focus starts at the top).
 */
export function ChoiceDialog({ game, onChoose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pending = game.pendingChoices[0];
  const event = pending ? findEvent(pending.eventId) : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    // Guard: StrictMode runs effects twice in development; showModal() on an open dialog throws.
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  if (!pending || !event?.choices) return null;
  const waitingAfterThis = game.pendingChoices.length - 1;
  // D72: the person the event is about, for {name} in its texts.
  const params: Record<string, string> = pending.person ? { name: pending.person.nickname } : {};

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="choice-title"
      aria-describedby="choice-text"
      // Escape normally closes a dialog. Here closing without a choice is not allowed.
      onCancel={(e) => e.preventDefault()}
      // Some browsers close anyway on a repeated Escape (anti-abuse rule for
      // dialogs). If that happens, open it again: the game waits for a choice.
      onClose={(e) => {
        const dialog = e.currentTarget;
        if (dialog.isConnected && !dialog.open) dialog.showModal();
      }}
    >
      <h2 id="choice-title">{t(`event.${event.id}.title`)}</h2>
      <p id="choice-text">{t(`event.${event.id}.text`, params)}</p>

      <ul className="choice-list" aria-label={t('choice.label')}>
        {event.choices.map((choice) => {
          const reasons = lockReasons(choice, game);
          const locked = reasons.length > 0;
          const reasonId = `choice-reason-${choice.id}`;
          return (
            <li key={choice.id}>
              <button
                type="button"
                className="choice-list__button"
                disabled={locked}
                aria-describedby={locked ? reasonId : undefined}
                onClick={() => onChoose(choice.id)}
              >
                {t(`event.${event.id}.choice.${choice.id}`, params)}
              </button>
              {locked && (
                <p id={reasonId} className="choice-list__reason">
                  🔒 {lockedText(game, event.id, choice, reasons, params)}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* Secondary notes go AFTER the choices, so the story reads straight into
          the buttons: how choosing works (left) and what is still waiting (right). */}
      <div className="choice-footer muted small">
        <span>{t('choice.hint')}</span>
        {waitingAfterThis > 0 && <span>{t('choice.queue', { count: waitingAfterThis })}</span>}
      </div>
    </dialog>
  );
}
