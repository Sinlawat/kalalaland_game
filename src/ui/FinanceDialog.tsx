import { BALANCE } from '../data/balance';
import { SPENDING_LEVELS, type GameState, type SpendingLevel } from '../engine/types';
import { t } from '../i18n/i18n';
import { formatMoney } from './format';
import { jobIncomes, lifeTotals, moneyText, showsFamilyMoneyStress, spendingLines, stressLines, yearLines, type SourceLine } from './work';
import { useModal } from './useModal';

interface Props {
  game: GameState;
  /** D80: the player picks how freely the character spends. */
  onSpendingChange(level: SpendingLevel): void;
  onClose(): void;
}

function SourceList({ lines, sign }: { lines: SourceLine[]; sign: '+' | '−' }) {
  return (
    <ul className="finance-list">
      {lines.map((line) => (
        <li key={line.source}>
          <span>{line.label}</span>
          <span>
            {sign}
            {formatMoney(line.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * D79: "where does my money come from?" — savings, the jobs now and what
 * they pay, this year's money by source, the whole life so far, and what
 * the family's money stress is made of.
 */
export function FinanceDialog({ game, onSpendingChange, onClose }: Props) {
  const dialogRef = useModal();
  const jobs = jobIncomes(game);
  const year = yearLines(game);
  const life = lifeTotals(game);
  const stress = stressLines(game);
  const spending = spendingLines(game);

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="finance-title" onClose={onClose}>
      <h2 id="finance-title">{t('finance.title')}</h2>

      <div className="residence-now">
        <span className="muted small">{t('stat.money')}</span>
        <strong className="residence-now__place">{moneyText(game.money.cash)}</strong>
      </div>

      <h3 className="residence-history__title">{t('finance.jobs')}</h3>
      {jobs.length === 0 ? (
        <p className="muted small">{t('finance.noJob')}</p>
      ) : (
        <ul className="finance-jobs">
          {jobs.map((job, index) => (
            <li key={index}>
              <strong>
                {job.level} · {job.job}
              </strong>
              <span>{t('finance.wage', { monthly: formatMoney(job.monthly), yearly: formatMoney(job.yearly) })}</span>
              <span className="muted small">
                {t('finance.split', {
                  percent: job.sharePercent,
                  given: formatMoney(job.given),
                  spending: formatMoney(job.spending),
                  saved: job.saved < 0 ? `−${formatMoney(-job.saved)}` : formatMoney(job.saved),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* D80: what the character pays for themselves, and how freely. */}
      <h3 className="residence-history__title">{t('finance.spending.title')}</h3>
      <div className="finance-levels" role="group" aria-label={t('finance.spending.level')}>
        {SPENDING_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`button button--small${game.money.spendingLevel === level ? ' button--primary' : ''}`}
            aria-pressed={game.money.spendingLevel === level}
            onClick={() => onSpendingChange(level)}
          >
            {t(`finance.spending.level.${level}`)}
          </button>
        ))}
      </div>
      <p className="muted small">{t(`finance.spending.levelHint.${game.money.spendingLevel}`)}</p>
      {spending.total === 0 ? (
        <p className="muted small">{t('finance.spending.parentsPay')}</p>
      ) : (
        <SourceList lines={[...spending.lines, { source: 'total', label: t('finance.spending.total'), amount: spending.total }]} sign="−" />
      )}
      {game.money.shortfall > 0 && <p className="notice notice--error small">{t('finance.spending.short', { amount: formatMoney(game.money.shortfall) })}</p>}

      <h3 className="residence-history__title">{t('finance.year', { age: Math.floor(game.ageInMonths / 12) })}</h3>
      {year.income.length === 0 && year.spent.length === 0 && year.given === 0 ? (
        <p className="muted small">{t('finance.nothingYet')}</p>
      ) : (
        <>
          <SourceList lines={year.income} sign="+" />
          <SourceList lines={year.given > 0 ? [{ source: 'given', label: t('finance.given'), amount: year.given }, ...year.spent] : year.spent} sign="−" />
        </>
      )}

      <h3 className="residence-history__title">{t('finance.life')}</h3>
      <dl className="residence-facts">
        <dt className="muted">{t('finance.life.wages')}</dt>
        <dd>{moneyText(life.wages)}</dd>
        <dt className="muted">{t('finance.life.other')}</dt>
        <dd>{moneyText(life.other)}</dd>
        <dt className="muted">{t('finance.life.given')}</dt>
        <dd>{moneyText(life.given)}</dd>
        <dt className="muted">{t('finance.life.spent')}</dt>
        <dd>{moneyText(life.spent)}</dd>
      </dl>

      <h3 className="residence-history__title">{t('familyStress.label')}</h3>
      {showsFamilyMoneyStress(game) ? (
        <>
          <p>
            <strong>{stress.total}</strong> <span className="muted small">{t('familyStress.hint', { until: BALANCE.familyMoneyStress.untilAge })}</span>
          </p>
          {stress.parts.length > 0 && (
            <ul className="finance-list">
              {stress.parts.map((part) => (
                <li key={part.key}>
                  <span>{t(`familyStress.part.${part.key}`, { wealth: Math.round(game.environment.familyWealth) })}</span>
                  <span>{part.amount > 0 ? `+${part.amount}` : `−${Math.abs(part.amount)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted small">{t('familyStress.over', { until: BALANCE.familyMoneyStress.untilAge })}</p>
      )}

      <form method="dialog">
        <button type="submit" className="button">
          {t('history.close')}
        </button>
      </form>
    </dialog>
  );
}
