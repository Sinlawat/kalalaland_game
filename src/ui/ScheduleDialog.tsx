import { useState } from 'react';
import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { ACTIVITIES, clock, DAYS_IN_MONTH, daySchedule, wakingDay, weekdayOf, weekSummary, type Activity } from './schedule';
import { useModal } from './useModal';

interface Props {
  game: GameState;
  onClose(): void;
}

/** The week's hours by activity, in the order of the legend. */
const SUMMARY_KEYS: Record<Activity, keyof ReturnType<typeof weekSummary>['hours']> = {
  sleep: 'sleep',
  essentials: 'essentials',
  commute: 'commute',
  study: 'study',
  work: 'work',
  lessons: 'lessons',
  care: 'care',
  chores: 'chores',
  exercise: 'exercise',
  friends: 'friends',
  free: 'free',
};

/** D85: activities only some lives have are listed while they take hours. */
const SOMETIMES: readonly Activity[] = ['chores', 'lessons', 'care', 'friends'];

/** One day as a bar from midnight (top) to midnight (bottom). */
function DayBar({ game, weekday }: { game: GameState; weekday: number }) {
  return (
    <span className="schedule-bar" aria-hidden="true">
      {daySchedule(game, weekday).map((block, i) => (
        <span key={i} className={`schedule-bar__part schedule--${block.activity}`} style={{ flexGrow: block.end - block.start }} />
      ))}
    </span>
  );
}

/**
 * D83: a typical month (30 days, day 1 a Monday) made from the time budget:
 * each day's activities, the week's hours, and whether the week is full.
 * The days are the same every month; they change when school, work or the
 * lifestyle does.
 */
export function ScheduleDialog({ game, onClose }: Props) {
  const dialogRef = useModal();
  const [selected, setSelected] = useState(1);
  const summary = weekSummary(game);
  const weekday = weekdayOf(selected);
  // D85: the day as the character lives it, from waking up to the next morning.
  const blocks = wakingDay(game, weekday);

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="schedule-title" onClose={onClose}>
      <h2 id="schedule-title">{t('schedule.title')}</h2>
      <p className="muted small">{t('schedule.hint')}</p>

      <h3 className="residence-history__title">{t('schedule.week')}</h3>
      <ul className="finance-list">
        {ACTIVITIES.filter((activity) => !SOMETIMES.includes(activity) || summary.hours[SUMMARY_KEYS[activity]] > 0).map((activity) => (
          <li key={activity}>
            <span>
              <span className={`schedule-dot schedule--${activity}`} aria-hidden="true" /> {t(`schedule.activity.${activity}`)}
            </span>
            <span>{t('schedule.hours', { hours: Math.round(summary.hours[SUMMARY_KEYS[activity]] * 10) / 10 })}</span>
          </li>
        ))}
      </ul>
      {summary.cut.length > 0 ? (
        <p className="notice small">
          {t('schedule.cut', {
            min: summary.minFree,
            wanted: summary.cut.map((c) => `${t(`habit.${c.habit}`)}: ${t(`habit.${c.habit}.${c.wanted}`)}`).join(' และ '),
            now: summary.cut.map((c) => `${t(`habit.${c.habit}`)}: ${t(`habit.${c.habit}.${c.now}`)}`).join(' และ '),
          })}
        </p>
      ) : summary.full ? (
        <p className="notice small">{t('schedule.full', { min: summary.minFree })}</p>
      ) : (
        <p className="muted small">{t('schedule.fits', { min: summary.minFree })}</p>
      )}

      <div className="schedule-grid" role="group" aria-label={t('schedule.month')}>
        {Array.from({ length: 7 }, (_, d) => (
          <span key={`h${d}`} className="schedule-grid__head muted small">
            {t(`schedule.weekday.${d}`)}
          </span>
        ))}
        {Array.from({ length: DAYS_IN_MONTH }, (_, i) => i + 1).map((day) => (
          <button
            key={day}
            type="button"
            className={`schedule-day${day === selected ? ' schedule-day--selected' : ''}`}
            aria-pressed={day === selected}
            aria-label={t('schedule.dayLabel', { day, weekday: t(`schedule.weekday.${weekdayOf(day)}`) })}
            onClick={() => setSelected(day)}
          >
            <span className="schedule-day__number">{day}</span>
            <DayBar game={game} weekday={weekdayOf(day)} />
          </button>
        ))}
      </div>

      <h3 className="residence-history__title">{t('schedule.day', { day: selected, weekday: t(`schedule.weekday.${weekday}`) })}</h3>
      <p className="muted small">{t('schedule.dayHint')}</p>
      <ul className="finance-list">
        {blocks.map((block, i) => (
          <li key={i}>
            <span>
              <span className={`schedule-dot schedule--${block.activity}`} aria-hidden="true" /> {t(`schedule.activity.${block.activity}`)}
            </span>
            <span>
              {clock(block.start)}–{clock(block.end)}
              {block.end > 24 && <span className="muted small"> {t('schedule.nextDay')}</span>}
            </span>
          </li>
        ))}
      </ul>

      <form method="dialog">
        <button type="submit" className="button">
          {t('history.close')}
        </button>
      </form>
    </dialog>
  );
}
