import { HABIT_OPTIONS } from '../actions/habits';
import { BALANCE } from '../data/balance';
import { canChooseHabits, isWorking } from '../engine/passive';
import type { GameState, HabitKey, Habits } from '../engine/types';
import { t } from '../i18n/i18n';
import { countHabitMonths, monthSlots } from './months';

interface Props {
  game: GameState;
  onChange<K extends HabitKey>(habit: K, level: Habits[K]): void;
}

const HABIT_ORDER: HabitKey[] = ['exercise', 'sleep', 'overtime'];

/** Colour of each level in the month strip: is it good for you? */
const LEVEL_TONE: { [K in HabitKey]: Record<Habits[K], 'good' | 'mid' | 'bad'> } = {
  exercise: { none: 'bad', light: 'mid', regular: 'good' },
  sleep: { short: 'bad', enough: 'good' },
  overtime: { none: 'good', some: 'mid', heavy: 'bad' },
};

/**
 * 12 small cells: which level of this habit was used in each month of the
 * year shown in the month bar, plus "regular 3 months · light 9 months".
 * Needed because habits can change mid-year (D38).
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
          const tone = level === undefined ? 'empty' : LEVEL_TONE[habit][level];
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
 * Segmented radio groups: every option is visible, one click to change.
 * Before Grade 1 the controls are not rendered at all (design decision):
 * the family, not the child, decides daily routines.
 */
export function HabitControls({ game, onChange }: Props) {
  if (!canChooseHabits(game)) {
    return (
      <section className="card">
        <h2>{t('layer.habits')}</h2>
        <p>{t('habit.locked', { age: BALANCE.earlyChildhood.playerChoosesHabitsFromAge })}</p>
        <p className="muted small">{t('habit.lockedReason')}</p>
      </section>
    );
  }

  const working = isWorking(game);
  return (
    <section className="card">
      <h2>{t('layer.habits')}</h2>
      <p className="muted small">{t('habit.hint')}</p>
      {HABIT_ORDER.map((habit) => {
        const inactive = habit === 'overtime' && !working;
        return (
          <fieldset key={habit} className="habit" disabled={inactive}>
            <legend>
              {t(`habit.${habit}`)}
              {inactive && <span className="muted small"> · {t('habit.overtime.inactive')}</span>}
            </legend>
            <div className="segmented">
              {HABIT_OPTIONS[habit].map((level) => (
                <label key={level} className="segmented__option">
                  <input
                    type="radio"
                    name={`habit-${habit}`}
                    value={level}
                    checked={game.habits[habit] === level}
                    onChange={() => onChange(habit, level)}
                  />
                  <span>{t(`habit.${habit}.${level}`)}</span>
                </label>
              ))}
            </div>
            {!inactive && <HabitYearStrip game={game} habit={habit} />}
          </fieldset>
        );
      })}
    </section>
  );
}
