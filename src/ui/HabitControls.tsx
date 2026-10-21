import { HABIT_OPTIONS } from '../actions/habits';
import { BALANCE } from '../data/balance';
import { canChooseHabits, isWorking } from '../engine/passive';
import type { GameState, HabitKey, Habits } from '../engine/types';
import { t } from '../i18n/i18n';

interface Props {
  game: GameState;
  onChange<K extends HabitKey>(habit: K, level: Habits[K]): void;
}

const HABIT_ORDER: HabitKey[] = ['exercise', 'sleep', 'overtime'];

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
          </fieldset>
        );
      })}
    </section>
  );
}
