/**
 * Route chunks after a reconnect (NF-09). A chunk that failed once stays failed for the page: browsers
 * keep the failed fetch in their module map (Chromium), so import() fails again without a request and
 * "Erneut versuchen" by re-importing cannot work. Only a page reload loads it again, so the view that
 * shows a failed chunk reloads once the server answers (App.svelte, ProfileChoice). No runes, so the
 * tests run this in Node.
 */

/** Remembers whether the newest chunk load failed and for which view (`where`, e.g. the route name). */
export class ChunkRetry {
  #where: () => string;
  #ticket = 0;
  #failed: string | null = null;

  constructor(where: () => string) {
    this.#where = where;
  }

  /** Passes a chunk load through and notes its outcome; only the newest load counts. */
  track<T>(promise: Promise<T>): Promise<T> {
    const ticket = ++this.#ticket;
    const at = this.#where();
    const note = (failed: string | null): void => {
      if (ticket === this.#ticket) this.#failed = failed;
    };
    promise.then(
      () => note(null),
      () => note(at),
    );
    return promise;
  }

  /** True when the view shown now failed to load its chunk; a failure of a view left since is not. */
  get failed(): boolean {
    return this.#failed !== null && this.#failed === this.#where();
  }
}

/** Pause between two automatic reloads, so a chunk that is really missing cannot cause a reload loop. */
export const RELOAD_PAUSE_MS = 30_000;
const RELOAD_KEY = 'chunkReload';

/**
 * Whether the page may reload for a failed chunk now that the server answers again; notes the time.
 * False when an automatic reload happened within RELOAD_PAUSE_MS (the reloaded page failed the same
 * way) and without sessionStorage, so "Erneut versuchen" stays and nothing can loop.
 */
export function mayReloadForChunk(now: number = Date.now()): boolean {
  try {
    if (now - Number(sessionStorage.getItem(RELOAD_KEY)) < RELOAD_PAUSE_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
