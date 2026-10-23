import type { HabitKey } from '../engine/types';
import { t } from '../i18n/i18n';
import { changeClass, formatChange } from './format';
import { residenceLabel } from './residence';
import type { TimelineEntry, TimelineYear } from './timeline';

function ageLabel(age: number): string {
  return age === 0 ? t('timeline.ageInfant') : t('timeline.age', { age });
}

/** Events with choices show what happened after the choice; others their own text. */
function entryText(entry: TimelineEntry): string {
  return entry.choiceId === undefined
    ? t(`event.${entry.id}.text`)
    : t(`event.${entry.id}.result.${entry.choiceId}`);
}

/**
 * A list of years, each with its events. Each event carries its own effects
 * as chips, so one event that changed three stats shows up ONCE, with all
 * three changes together (instead of once per stat).
 * Shared by the timeline card and the life-history popup.
 */
export function TimelineYears({ years }: { years: TimelineYear[] }) {
  return (
    <ol className="timeline-years">
      {years.map((year) => (
        <li key={year.age} className="timeline-years__year">
          <h3 className="timeline-years__age">{ageLabel(year.age)}</h3>
          <ul className="timeline-years__events">
            {year.entries.map((entry) => (
              <li key={entry.key} className="timeline-event">
                <strong>
                  {t(`event.${entry.id}.title`)}
                  {/* The month makes the order visible (newest on top); for repeats, the latest time. */}
                  <span className="muted small"> · {t(`month.${entry.calendarMonth}`)}</span>
                  {entry.count > 1 && <span className="muted small"> · {t('timeline.times', { count: entry.count })}</span>}
                </strong>
                <p>{entryText(entry)}</p>
                {entry.habitChanges &&
                  (Object.entries(entry.habitChanges) as [HabitKey, string][]).map(([habit, level]) => {
                    const months = entry.habitMonths?.[habit];
                    const params = { habit: t(`habit.${habit}`), level: t(`habit.${habit}.${level}`) };
                    return (
                      <p key={habit} className="muted small">
                        {months === undefined
                          ? t('timeline.habitChange', params)
                          : t('timeline.habitChangeTemporary', { ...params, months })}
                      </p>
                    );
                  })}
                {entry.residenceChange && (
                  <p className="muted small">
                    {t('timeline.residenceChange', {
                      from: residenceLabel(entry.residenceChange.from),
                      to: residenceLabel(entry.residenceChange.to),
                    })}
                  </p>
                )}
                {entry.effects.length > 0 && (
                  <ul className="effect-chips" aria-label={t('timeline.effects')}>
                    {entry.effects.map((chip) => (
                      <li key={chip.target} className={`effect-chip effect-chip--${changeClass(chip.amount)}`}>
                        {t(`stat.${chip.target}`)} {formatChange(chip.amount)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
