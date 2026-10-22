import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/i18n';
import type { TimelineYear } from './timeline';
import { TimelineYears } from './TimelineYears';

interface Props {
  /** Years with events, newest first. */
  years: TimelineYear[];
  onClose(): void;
}

/**
 * Popup to browse older years of the life (design decision: the main card
 * shows only the last 5 years). The player picks a year of age; only that
 * year's events are shown, so the popup stays short however long the life.
 * Native <dialog> + showModal(): focus trap, Escape and backdrop for free.
 */
export function LifeHistoryDialog({ years, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedAge, setSelectedAge] = useState<number | undefined>(years[0]?.age);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const selected = years.filter((year) => year.age === selectedAge);

  return (
    <dialog ref={dialogRef} className="dialog dialog--wide" aria-labelledby="life-history-title" onClose={onClose}>
      <h2 id="life-history-title">{t('history.title')}</h2>
      <p className="muted small">{t('history.pickYear')}</p>
      <div className="year-picker" role="group" aria-label={t('history.pickYear')}>
        {years.map((year) => (
          <button
            key={year.age}
            type="button"
            className={year.age === selectedAge ? 'year-picker__button year-picker__button--selected' : 'year-picker__button'}
            aria-pressed={year.age === selectedAge}
            onClick={() => setSelectedAge(year.age)}
          >
            {year.age === 0 ? t('timeline.ageInfant') : t('timeline.age', { age: year.age })}
          </button>
        ))}
      </div>
      <TimelineYears years={selected} />
      <form method="dialog">
        <button type="submit" className="button">
          {t('history.close')}
        </button>
      </form>
    </dialog>
  );
}
