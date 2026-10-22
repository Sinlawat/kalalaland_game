import { useState } from 'react';
import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { monthSlots, type MonthSlot } from './months';

/**
 * A ▼ marker above a month with events. Hover, focus or tap shows the
 * event names; the bubble is positioned against the whole bar (.month-bar),
 * so it never overflows a narrow screen.
 */
function EventMarker({ slot }: { slot: MonthSlot }) {
  const [open, setOpen] = useState(false);
  const titles = slot.eventIds.map((id) => t(`event.${id}.title`));
  const label = `${t(`month.${slot.calendarMonth}`)}: ${titles.join(', ')}`;
  return (
    <span className="month-bar__marker-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={`month-bar__marker month-bar__marker--${slot.tone}`}
        aria-label={label}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        ▼
      </button>
      <span role="tooltip" className="month-bar__bubble" hidden={!open}>
        {label}
      </span>
    </span>
  );
}

/**
 * D38: 12 slots, January to December of the current calendar year. Lived
 * months fill in as time runs; months with events are coloured
 * (green = only gains, red = only losses, yellow = mixed or no stat change)
 * and carry a ▼. The birth month is marked with 🎂; months before birth
 * (only in the year of birth) are drawn as empty outlines.
 */
export function MonthBar({ game }: { game: GameState }) {
  const slots = monthSlots(game);
  return (
    <div className="month-bar" role="group" aria-label={t('monthBar.label')}>
      <ol className="month-bar__slots">
        {slots.map((slot) => {
          const classes = [
            'month-bar__slot',
            slot.lived ? 'month-bar__slot--lived' : '',
            slot.beforeBirth ? 'month-bar__slot--unborn' : '',
            slot.current ? 'month-bar__slot--current' : '',
            slot.tone ? `month-bar__slot--${slot.tone}` : '',
          ].join(' ');
          return (
            <li key={slot.calendarMonth} className="month-bar__cell">
              <span className="month-bar__marker-row">{slot.tone && <EventMarker slot={slot} />}</span>
              <span className={classes} />
              <span className={`month-bar__label${slot.birthday ? ' month-bar__label--birthday' : ''}`}>
                {t(`month.${slot.calendarMonth}`)}
                {slot.birthday && (
                  <span className="month-bar__cake" title={t('monthBar.birthday')} aria-label={t('monthBar.birthday')}>
                    🎂
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
