import type { SaveStorage } from '../save/save';

/**
 * Returns localStorage wrapped so that even ACCESSING it cannot crash the app.
 * In some browsers (blocked cookies, sandboxed iframes) just reading
 * `window.localStorage` throws a SecurityError.
 */
export function getBrowserStorage(): SaveStorage {
  const storage = (): Storage => window.localStorage;
  return {
    getItem: (key) => storage().getItem(key),
    setItem: (key, value) => storage().setItem(key, value),
    removeItem: (key) => storage().removeItem(key),
  };
}
