import { useId, useState } from 'react';
import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { compareGroups, comparePoints, formatDiff } from './compare';
import { formatAge } from './format';
import { useModal } from './useModal';

interface Props {
  game: GameState;
  onClose(): void;
}

function diffClass(diff: number | undefined): string {
  if (diff === undefined || diff === 0) return 'neutral';
  return diff > 0 ? 'up' : 'down';
}

/**
 * "Compare years": every value now next to an earlier birthday (default:
 * the last one) or birth, with the difference. The reasons stay in the
 * ▲/▼ popovers on the cards; this table answers "how much, in total".
 */
export function CompareDialog({ game, onClose }: Props) {
  const dialogRef = useModal();
  const selectId = useId();
  const points = comparePoints(game);
  const [pointId, setPointId] = useState(points[0]?.id);
  const point = points.find((p) => p.id === pointId) ?? points[0];

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="compare-title" onClose={onClose}>
      <h2 id="compare-title">{t('compare.title')}</h2>

      {point === undefined ? (
        <p>{t('compare.none')}</p>
      ) : (
        <>
          <div className="compare-picker">
            <label htmlFor={selectId} className="muted small">
              {t('compare.pickLabel', { age: formatAge(game.ageInMonths) })}
            </label>
            <select id={selectId} className="select" value={point.id} onChange={(e) => setPointId(e.target.value)}>
              {points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">{t('compare.column.value')}</th>
                <th scope="col">{point.shortLabel}</th>
                <th scope="col">{t('compare.column.now')}</th>
                <th scope="col">{t('compare.column.diff')}</th>
              </tr>
            </thead>
            {compareGroups(game, point.snapshot).map((group) => (
              <tbody key={group.key}>
                <tr>
                  <th scope="colgroup" colSpan={4} className="compare-table__group">
                    {group.title}
                  </th>
                </tr>
                {group.rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td>{r.then ?? '—'}</td>
                    <td>{r.now}</td>
                    <td className={diffClass(r.diff)}>{r.diff === undefined ? '—' : formatDiff(r.diff)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <p className="muted small">{t('compare.hint')}</p>
        </>
      )}

      <form method="dialog">
        <button type="submit" className="button">
          {t('history.close')}
        </button>
      </form>
    </dialog>
  );
}
