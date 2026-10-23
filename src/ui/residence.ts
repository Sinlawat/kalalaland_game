/**
 * Where the character lives, for the header and the residence popup.
 * The moves come from the event history (each move is recorded on the event
 * that caused it), so nothing extra is stored. Pure functions; no React.
 */

import type { EventRecord, GameState, Residence } from '../engine/types';
import { t } from '../i18n/i18n';

export interface ResidenceMove {
  /** Month of life of the move. */
  ageInMonths: number;
  /** The event that moved the character. */
  eventId: string;
  from: Residence;
  to: Residence;
}

type MoveSource = Pick<GameState, 'eventHistory'>;

/** Every move, oldest first. */
export function residenceMoves(state: MoveSource): ResidenceMove[] {
  return state.eventHistory.flatMap((record: EventRecord) =>
    record.residenceChange
      ? [{ ageInMonths: record.ageInMonths, eventId: record.id, ...record.residenceChange }]
      : [],
  );
}

/** "ชนบท · บ้านตายาย"; the home is left out for the parents' home, the usual case. */
export function residenceLabel(residence: Residence): string {
  const region = t(`region.${residence.regionId}`);
  return residence.homeId === 'parents' ? region : `${region} · ${t(`home.${residence.homeId}`)}`;
}

/** "3 ปี 7 เดือน", "7 เดือน", "2 ปี". */
export function formatDuration(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return t('duration.months', { months: rest });
  if (rest === 0) return t('duration.years', { years });
  return t('duration.yearsMonths', { years, months: rest });
}
