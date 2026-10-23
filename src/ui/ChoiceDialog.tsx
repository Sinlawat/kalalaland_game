import { useEffect, useRef } from 'react';
import { findEvent, lockReasons, type EventChoice, type LockReason } from '../engine/events';
import { knowsOwnTraits } from '../engine/passive';
import type { GameState } from '../engine/types';
import { hasMessage, t } from '../i18n/i18n';
import { formatStat } from './format';

interface Props {
  game: GameState;
  onChoose(choiceId: string): void;
}

const TRAIT_STATS = ['discipline', 'resilience', 'riskTaking'];

/** Text the game writes itself for one unmet condition. */
function automaticReason(game: GameState, reason: LockReason): string {
  switch (reason.kind) {
    case 'flag':
      return t('choice.locked.generic');
    case 'habit':
      return t('choice.locked.habit', { habit: t(`habit.${reason.habit}`), level: t(`habit.${reason.habit}.${reason.level}`) });
    case 'stat':
      // Before Grade 1 the child does not know their traits (D35): don't spell them out.
      if (TRAIT_STATS.includes(reason.stat) && !knowsOwnTraits(game)) return t('choice.locked.generic');
      return t(reason.op === '>=' ? 'choice.locked.atLeast' : 'choice.locked.below', {
        stat: t(`stat.${reason.stat}`),
        value: reason.value,
        current: formatStat(reason.current),
      });
  }
}

/**
 * Text for a locked choice (D39: shown disabled, with the reason).
 * The writer's own words win when the content has them (required for flag
 * conditions, optional otherwise, e.g. house rules: "your parents don't
 * allow games after 10 pm"). Otherwise the game explains each condition.
 */
function lockedText(game: GameState, eventId: string, choice: EventChoice, reasons: LockReason[]): string {
  const key = `event.${eventId}.choice.${choice.id}.locked`;
  if (hasMessage(key)) return t(key);
  return reasons.map((reason) => automaticReason(game, reason)).join(' · ');
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
      <p id="choice-text">{t(`event.${event.id}.text`)}</p>

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
                {t(`event.${event.id}.choice.${choice.id}`)}
              </button>
              {locked && (
                <p id={reasonId} className="choice-list__reason">
                  🔒 {lockedText(game, event.id, choice, reasons)}
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
