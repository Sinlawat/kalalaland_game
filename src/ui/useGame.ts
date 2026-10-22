/**
 * The bridge between React and the engine, including the real-time runner.
 *
 * React keeps ONE game value: the current GameState returned by the engine.
 * Every action calls a pure engine function and stores the new state.
 * No game rules live here — only "when to call what", timing and saving.
 *
 * Time (D38): while running, one game month passes every 1.25 s at 1×
 * (15 s per year). The runner pauses by itself when something needs the
 * player (a popup: trait reveal or an event with choices) or the character
 * dies, and when the tab is hidden. After the popup is answered, time goes
 * on by itself if the player had it running.
 *
 * Saving (D44): on a new life, every birthday, death, pause, when a choice
 * popup appears and when it is answered, and when the page is hidden or
 * closed. (The player does not change habits: events do, D50.)
 * Not every month: at most one year (15 s) can be lost, and the save grows
 * with the life, so writing it 12 times a year would be wasted work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { acknowledgeTraitReveal, shouldRevealTraits } from '../actions/traits';
import { advanceOneMonth, resolveChoice, settlePendingChoices } from '../engine/game';
import { createNewLife } from '../engine/newLife';
import type { GameState } from '../engine/types';
import { deleteSave, loadGame, saveGame, type LoadResult } from '../save/save';
import { getBrowserStorage } from './browserStorage';

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** D38: 15 seconds of real time per game year at 1×. */
export const MS_PER_MONTH_AT_1X = 15_000 / 12;

export interface GameController {
  /** The life being played, or null on the start screen. */
  game: GameState | null;
  /** A saved life that can be resumed from the start screen. */
  resumable: GameState | null;
  /** Why the save could not be loaded when the page opened, if it failed. */
  loadError: Extract<LoadResult, { status: 'error' }>['reason'] | null;
  saveFailed: boolean;
  /** The player wants time to run (it may still be held by a popup). */
  running: boolean;
  speed: Speed;
  startNewLife(seed: number): void;
  resume(): void;
  togglePlay(): void;
  setSpeed(speed: Speed): void;
  acknowledgeTraits(): void;
  /** The player's answer to the choice popup. */
  choose(choiceId: string): void;
  quitToStart(): void;
}

/** Something on screen needs the player before time can move on. */
function isHeld(game: GameState): boolean {
  return game.death !== null || game.pendingChoices.length > 0 || shouldRevealTraits(game);
}

export function useGame(): GameController {
  const storage = useMemo(getBrowserStorage, []);
  // Lazy initial state: the save is read once, on the first render only.
  const [boot] = useState<LoadResult>(() => loadGame(storage));
  const [resumable, setResumable] = useState<GameState | null>(boot.status === 'ok' ? boot.state : null);
  const [game, setGame] = useState<GameState | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [saveFailed, setSaveFailed] = useState(false);

  // The latest state for event listeners (pagehide) that live outside renders.
  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;

  const persist = useCallback(
    (state: GameState) => setSaveFailed(saveGame(storage, state).status === 'error'),
    [storage],
  );

  // ── The runner: one month per tick ─────────────────────────────────────
  // A new timeout is scheduled after every month (each tick produces a new
  // `game`, which re-runs this effect). Cleanup cancels a pending tick when
  // the player pauses, changes speed, or a popup appears.
  useEffect(() => {
    if (!running || game === null || isHeld(game)) return undefined;
    const timer = window.setTimeout(() => {
      const result = advanceOneMonth(game);
      setGame(result.state);
      if (result.stop !== null) persist(result.state); // birthday, death, or a choice popup
      if (result.stop === 'death') setRunning(false);
    }, MS_PER_MONTH_AT_1X / speed);
    return () => window.clearTimeout(timer);
  }, [game, running, speed, persist]);

  // ── Pause and save when the page is hidden or closed ───────────────────
  useEffect(() => {
    const onHide = () => {
      if (gameRef.current !== null) persist(gameRef.current);
      setRunning(false); // nobody is watching: don't let a life run by itself
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, [persist]);

  return {
    game,
    resumable,
    loadError: boot.status === 'error' ? boot.reason : null,
    saveFailed,
    running,
    speed,
    startNewLife: (seed) => {
      const life = createNewLife(seed);
      setGame(life);
      persist(life);
      setRunning(true); // a new life starts living right away
    },
    resume: () => {
      if (resumable === null) return;
      // An update may have removed an event that was waiting for a choice.
      const settled = settlePendingChoices(resumable).state;
      setGame(settled);
      if (settled !== resumable) persist(settled);
      setRunning(false); // a resumed life waits for the player to press play
    },
    togglePlay: () => {
      if (game === null || game.death !== null) return;
      if (running) persist(game);
      setRunning(!running);
    },
    setSpeed,
    acknowledgeTraits: () => {
      if (game === null || !shouldRevealTraits(game)) return;
      const next = acknowledgeTraitReveal(game);
      setGame(next);
      persist(next);
    },
    choose: (choiceId) => {
      if (game === null || game.pendingChoices.length === 0) return;
      const result = resolveChoice(game, choiceId);
      setGame(result.state);
      persist(result.state);
      if (result.stop === 'death') setRunning(false);
    },
    quitToStart: () => {
      deleteSave(storage);
      setResumable(null);
      setGame(null);
      setRunning(false);
    },
  };
}
