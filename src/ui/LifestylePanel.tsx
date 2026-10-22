import { BALANCE } from '../data/balance';
import { hasOwnLifestyle, isWorking } from '../engine/passive';
import type { GameState, HabitKey, Habits } from '../engine/types';
import { t } from '../i18n/i18n';
import { habitReason, type HabitReason } from './lifestyle';
import { countHabitMonths, monthSlots } from './months';

interface Props {
  game: GameState;
}

const HABIT_ORDER: HabitKey[] = ['exercise', 'sleep', 'overtime'];

/** Colour of each level: is it good for you? */
const LEVEL_TONE: { [K in HabitKey]: Record<Habits[K], 'good' | 'mid' | 'bad'> } = {
  exercise: { none: 'bad', light: 'mid', regular: 'good' },
  sleep: { short: 'bad', enough: 'good' },
  overtime: { none: 'good', some: 'mid', heavy: 'bad' },
};

function toneOf<K extends HabitKey>(habit: K, level: Habits[K]): 'good' | 'mid' | 'bad' {
  return LEVEL_TONE[habit][level];
}

function reasonText(habit: HabitKey, reason: HabitReason): string {
  switch (reason.kind) {
    case 'family':
      return t('habit.reason.family');
    case 'event':
      return t('habit.reason.event', { event: t(`event.${reason.eventId}.title`) });
    case 'temporary':
      return t('habit.reason.temporary', {
        event: t(`event.${reason.eventId}.title`),
        months: reason.monthsLeft,
        level: t(`habit.${habit}.${reason.revertTo}`),
      });
  }
}

/**
 * 12 small cells: which level of this habit applied in each month of the
 * year shown in the month bar, plus "regular 3 months · light 9 months".
 * Needed because events can change habits mid-year.
 */
function HabitYearStrip<K extends HabitKey>({ game, habit }: { game: GameState; habit: K }) {
  const slots = monthSlots(game);
  const lived = slots.flatMap((slot) => (slot.habits ? [slot.habits] : []));
  const counts = [...countHabitMonths(lived, habit).entries()];
  return (
    <div className="habit-strip" aria-label={t('habit.yearStrip')}>
      <span className="habit-strip__cells" aria-hidden="true">
        {slots.map((slot) => {
          const level = slot.habits?.[habit];
          const tone = level === undefined ? 'empty' : toneOf(habit, level);
          return <span key={slot.calendarMonth} className={`habit-strip__cell habit-strip__cell--${tone}`} />;
        })}
      </span>
      <span className="muted small">
        {counts.map(([level, count]) => t('habit.monthsCount', { level: t(`habit.${habit}.${level}`), count })).join(' · ')}
      </span>
    </div>
  );
}

/**
 * Lifestyle card (D50): read-only. The player never picks habits; events
 * change them. Each habit shows its current level, why it is so, and the
 * months of the year. Before Grade 1 the family decides daily routines.
 */
export function LifestylePanel({ game }: Props) {
  if (!hasOwnLifestyle(game)) {
    return (
      <section className="card">
        <h2>{t('layer.habits')}</h2>
        <p>{t('habit.locked', { age: BALANCE.earlyChildhood.ownLifestyleFromAge })}</p>
      </section>
    );
  }

  const working = isWorking(game);
  return (
    <section className="card">
      <h2>{t('layer.habits')}</h2>
      <p className="muted small">{t('habit.hint')}</p>
      <ul className="lifestyle">
        {HABIT_ORDER.map((habit) => {
          const level = game.habits[habit];
          if (habit === 'overtime' && !working) {
            return (
              <li key={habit} className="lifestyle__item lifestyle__item--inactive">
                <div className="lifestyle__head">
                  <span>{t(`habit.${habit}`)}</span>
                  <span className="muted small">{t('habit.overtime.inactive')}</span>
                </div>
              </li>
            );
          }
          return (
            <li key={habit} className="lifestyle__item">
              <div className="lifestyle__head">
                <span>{t(`habit.${habit}`)}</span>
                <span className={`lifestyle__level lifestyle__level--${toneOf(habit, level)}`}>{t(`habit.${habit}.${level}`)}</span>
              </div>
              <p className="muted small lifestyle__reason">{reasonText(habit, habitReason(game, habit))}</p>
              <HabitYearStrip game={game} habit={habit} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
