/**
 * All tags with their recipe counts (GET /tags, F-19, F-20, F-24): the chip row and filter sheet of the
 * list, the tag page and the editor's autocomplete (F-18: „lokale Tag-Liste, kein Request je Taste“) share
 * this one list. Every write answers with a new X-Data-Revision (connection.dataRevision), so `stale`
 * notices own and foreign changes without an explicit invalidate. No texts and no normalize here (NF-01).
 */
import { untrack } from 'svelte';
import type { TagCount, TagsResponse } from '../../../shared/types.ts';
import { get } from '../lib/api.ts';
import { connection } from './connection.svelte.ts';

class TagStore {
  /** Server order: count descending, then name; unused tags last. Replaced as a whole on every load. */
  list = $state.raw<readonly TagCount[]>([]);
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** Error of the last failed load (for errorMessage()); null after a successful one. */
  error = $state.raw<unknown>(null);

  /** data_revision the list belongs to. */
  #revision = $state<string | null>(null);
  /** Number of the newest load; an older answer arriving later is outdated and dropped. */
  #loads = 0;
  #running: Promise<void> | null = null;
  /** connection.dataRevision when the running load started. */
  #runningFor: string | null = null;

  /**
   * True until a load succeeded, and again after any write (own or on another device, seen through
   * X-Data-Revision) until the next load finishes. Unknown tag ids in the URL are only dropped while false.
   */
  get stale(): boolean {
    return this.status !== 'ready' || this.#revision !== connection.dataRevision;
  }

  /**
   * Loads the list when it is stale; otherwise resolves at once. A running load is shared, unless a write
   * happened after it started (a newer revision than the one known then): its answer may miss that
   * write, so a new load replaces it. A revision first learned while the load runs (app start) is none.
   * Reads nothing reactively, so an $effect calling it does not rerun on every status change (a failed
   * load must not start the next one by itself).
   */
  ensure(): Promise<void> {
    return untrack(() => {
      const running = this.#running;
      const since = this.#runningFor;
      if (running && (since === null || since === connection.dataRevision)) return running;
      return this.stale ? this.load() : Promise.resolve();
    });
  }

  /** Loads the list („Aktualisieren“, reconnect). Keeps the old list while loading and on failure; never rejects. */
  load(): Promise<void> {
    return untrack(() => {
      const load = ++this.#loads;
      this.status = 'loading';
      this.#runningFor = connection.dataRevision;
      const running = this.#fetch(load).finally(() => {
        if (this.#running === running) this.#running = null;
      });
      this.#running = running;
      return running;
    });
  }

  async #fetch(load: number): Promise<void> {
    try {
      const res = await get<TagsResponse>('/tags');
      if (load !== this.#loads) return;
      this.list = res.tags;
      this.#revision = String(res.revision);
      this.error = null;
      this.status = 'ready';
    } catch (err) {
      if (load !== this.#loads) return;
      this.error = err;
      this.status = 'error';
    }
  }
}

export const tags = new TagStore();
