/**
 * The bridge between React and the engine.
 *
 * React keeps ONE value: the current GameState returned by the engine.
 * Every player action calls a pure engine function and stores the new state.
 * No game rules live here — only "when to call what" and autosave.
 */

import { useMemo, useState } from 'react';
import { setHabit } from '../actions/habits';
import { acknowledgeTraitReveal, shouldRevealTraits } from '../actions/traits';
import { advanceUntilStop } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import type { GameState, HabitKey, Habits, StopReason } from '../engine/types';
import { deleteSave, loadGame, saveGame, type LoadResult } from '../save/save';
import { getBrowserStorage } from './browserStorage';

export interface GameController {
  /** The life being played, or null on the start screen. */
  game: GameState | null;
  lastStop: StopReason | null;
  /** A saved life that can be resumed from the start screen. */
  resumable: GameState | null;
  /** Why the save could not be loaded when the page opened, if it failed. */
  loadError: Extract<LoadResult, { status: 'error' }>['reason'] | null;
  saveFailed: boolean;
  startNewLife(seed: number): void;
  resume(): void;
  advance(): void;
  changeHabit<K extends HabitKey>(habit: K, level: Habits[K]): void;
  acknowledgeTraits(): void;
  quitToStart(): void;
}

export function useGame(): GameController {
  const storage = useMemo(getBrowserStorage, []);
  // Lazy initial state: the save is read once, on the first render only.
  const [boot] = useState<LoadResult>(() => loadGame(storage));
  const [resumable, setResumable] = useState<GameState | null>(boot.status === 'ok' ? boot.state : null);
  const [game, setGame] = useState<GameState | null>(null);
  const [lastStop, setLastStop] = useState<StopReason | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  /** Every state change happens while the game is paused, so we autosave each time. */
  const commit = (next: GameState, stop: StopReason | null): void => {
    setGame(next);
    setLastStop(stop);
    setSaveFailed(saveGame(storage, next).status === 'error');
  };

  return {
    game,
    lastStop,
    resumable,
    loadError: boot.status === 'error' ? boot.reason : null,
    saveFailed,
    startNewLife: (seed) => commit(createNewLife(seed), null),
    resume: () => {
      if (resumable !== null) commit(resumable, null);
    },
    advance: () => {
      if (game === null || game.death !== null) return;
      const result = advanceUntilStop(game);
      commit(result.state, result.stop);
    },
    changeHabit: (habit, level) => {
      if (game !== null && game.death === null) commit(setHabit(game, habit, level), lastStop);
    },
    acknowledgeTraits: () => {
      if (game !== null && shouldRevealTraits(game)) commit(acknowledgeTraitReveal(game), lastStop);
    },
    quitToStart: () => {
      deleteSave(storage);
      setResumable(null);
      setGame(null);
      setLastStop(null);
    },
  };
}
