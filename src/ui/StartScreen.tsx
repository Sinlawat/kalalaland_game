import { useState, type FormEvent } from 'react';
import { randomSeed } from '../engine/newLife';
import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import type { GameController } from './useGame';
import { formatAge } from './format';

interface Props {
  resumable: GameState | null;
  loadError: GameController['loadError'];
  onStart(seed: number): void;
  onResume(): void;
}

/** Accepts "", or a whole number 0..2^32−1. Returns null when invalid. */
function parseSeed(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return randomSeed();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= 0xffffffff ? value : null;
}

export function StartScreen({ resumable, loadError, onStart, onResume }: Props) {
  const [seedInput, setSeedInput] = useState('');
  const [seedError, setSeedError] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const seed = parseSeed(seedInput);
    if (seed === null) {
      setSeedError(true);
      return;
    }
    onStart(seed);
  };

  return (
    <main className="screen start">
      <header className="start__header">
        <h1>{t('app.title')}</h1>
        <p className="muted">{t('app.tagline')}</p>
      </header>

      {loadError !== null && <p className="notice notice--error">{t(`save.error.${loadError}`)}</p>}

      {resumable !== null && (
        <section className="card">
          <p>
            <strong>{resumable.nickname}</strong> · {t(`sex.${resumable.sex}`)} · {formatAge(resumable.ageInMonths)}
          </p>
          <button type="button" className="button button--primary" onClick={onResume}>
            {t('start.continue')}
          </button>
        </section>
      )}

      <form className="card" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>{t('start.seedLabel')}</span>
          <input
            inputMode="numeric"
            value={seedInput}
            onChange={(event) => {
              setSeedInput(event.target.value);
              setSeedError(false);
            }}
            aria-invalid={seedError}
            aria-describedby="seed-help"
          />
        </label>
        <p id="seed-help" className={seedError ? 'field__error' : 'muted small'}>
          {seedError ? t('start.seedInvalid') : t('start.seedHint')}
        </p>
        {resumable !== null && <p className="notice">{t('start.confirmOverwrite')}</p>}
        <button type="submit" className={resumable === null ? 'button button--primary' : 'button'}>
          {t('start.newLife')}
        </button>
      </form>
    </main>
  );
}
