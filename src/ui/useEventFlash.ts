import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../engine/types';
import { newEventChanges, type FlashTarget } from './eventFlash';

/** How long the "+3.0" stays beside the bar. Long enough to read at 1× speed (1.25 s per month). */
export const FLASH_MS = 2500;

export interface StatFlash {
  amount: number;
  /**
   * Changes on every new flash. Used as a React `key`, so the element is
   * created again and its CSS animation starts over, even when the same
   * stat flashes twice in a row.
   */
  token: number;
}

export type StatFlashes = Partial<Record<FlashTarget, StatFlash>>;

/**
 * Watches the game and returns the stats an event has just changed, each
 * for FLASH_MS. Each stat has its own timer: a new event replaces only the
 * stats it changed, the others finish their own time.
 *
 * Nothing flashes on the first render (a loaded save) — see newEventChanges.
 */
export function useEventFlash(game: GameState): StatFlashes {
  const previousRef = useRef<GameState | undefined>(undefined);
  const tokenRef = useRef(0);
  const timersRef = useRef(new Set<number>());
  const [flashes, setFlashes] = useState<StatFlashes>({});

  useEffect(() => {
    const changes = newEventChanges(previousRef.current, game);
    // Set BEFORE returning: StrictMode runs effects twice in development, and
    // the second run must compare the game with itself (no double flash).
    previousRef.current = game;

    const entries = Object.entries(changes) as [FlashTarget, number][];
    if (entries.length === 0) return;

    const added: StatFlashes = {};
    for (const [target, amount] of entries) {
      tokenRef.current += 1;
      const token = tokenRef.current;
      added[target] = { amount, token };
      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer);
        // Remove only if no newer flash replaced this one meanwhile.
        setFlashes((current) => {
          if (current[target]?.token !== token) return current;
          const rest = { ...current };
          delete rest[target];
          return rest;
        });
      }, FLASH_MS);
      timersRef.current.add(timer);
    }
    setFlashes((current) => ({ ...current, ...added }));
  }, [game]);

  // Unmount (e.g. back to the start screen): no state updates after that.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return flashes;
}
