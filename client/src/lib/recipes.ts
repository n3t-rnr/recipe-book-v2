/**
 * Recipe list data of the initial screens (Kap. 7.4) and the caches that make navigation feel instant:
 * - the list snapshots survive unmounting, one per filter (the last 4), so Back from a recipe shows the
 *   same pages of the same filter at once and the router can restore the scroll position (F-34);
 * - the card cache gives the detail its title and image from list data before the detail request
 *   answers (F-29: ≤ 200 ms).
 * Calls of the lazily loaded screens (detail, trash, "Mehr") stay in those chunks (NF-01).
 */
import { LIMITS } from '../../../shared/constants.ts';
import type { RecipeCard, RecipeListPage } from '../../../shared/types.ts';
import { get } from './api.ts';
import type { QueryInput } from './routes.ts';

export const PAGE_SIZE = LIMITS.pageSize;

/**
 * One page of GET /recipes. `filter` is the list filter as API query (lib/list-query.ts toApiQuery: q,
 * tags, tagMode, sort); without it the server sorts by "newest".
 */
export function fetchRecipePage(
  cursor: string | null,
  limit: number = PAGE_SIZE,
  signal?: AbortSignal,
  filter: QueryInput = {},
): Promise<RecipeListPage> {
  const query = { ...filter, cursor, limit: Math.min(Math.max(limit, 1), LIMITS.pageSizeMax) };
  return get<RecipeListPage>('/recipes', signal ? { query, signal } : { query });
}

export interface ListSnapshot {
  items: RecipeCard[];
  nextCursor: string | null;
  /** Recipes matching the filter. */
  total: number;
  /** All active recipes („14 von 38 Rezepten“); missing in snapshots from before M4, use `total` then. */
  totalAll?: number;
  /** „Meintest du“ suggestion of an empty search result (F-23). */
  didYouMean?: string | null;
  /** X-Data-Revision the items belong to; a newer revision makes the list reload (F-36 light). */
  revision: string | null;
}

/** Snapshots per filter key (list-query.ts filterKey), least recently used first. */
const snapshots = new Map<string, ListSnapshot>();
const SNAPSHOTS = 4;
const cards = new Map<number, RecipeCard>();

/** The snapshot of the list with this filter key ('' = unfiltered), or null. */
export function readListSnapshot(key = ''): ListSnapshot | null {
  const found = snapshots.get(key);
  if (!found) return null;
  // Used again: it is the last one to be dropped.
  snapshots.delete(key);
  snapshots.set(key, found);
  return found;
}

/** Keeps the list of this filter key; beyond 4 keys the least recently used one is dropped. */
export function writeListSnapshot(next: ListSnapshot, key = ''): void {
  snapshots.delete(key);
  snapshots.set(key, next);
  for (const old of snapshots.keys()) {
    if (snapshots.size <= SNAPSHOTS) break;
    snapshots.delete(old);
  }
  for (const card of next.items) cards.set(card.id, card);
}

/**
 * Keeps the list in step with X-Data-Revision (F-36 light). A page belongs to the revision known when
 * it was requested, not to the one noted when it arrived: a write answered while the request ran
 * ("Rückgängig" right after deleting) may be missing from it, so the list loads once more.
 */
export class ListRevision {
  /** Revision the shown items belong to; null while unknown. */
  shown: string | null;
  /** Revision known when the running reload was requested; undefined while none runs. */
  #sent: string | null | undefined;
  #newer = false;

  constructor(shown: string | null) {
    this.shown = shown;
  }

  /** A reload starts; `latest` is the newest revision seen so far. */
  start(latest: string | null): void {
    this.#sent = latest;
    this.#newer = false;
  }

  /** Every revision seen; true when the shown list is outdated and no reload runs. */
  seen(latest: string | null): boolean {
    if (this.#sent === undefined) return latest !== null && this.shown !== null && latest !== this.shown;
    if (this.#sent !== null && latest !== this.#sent) this.#newer = true;
    return false;
  }

  /** The reload's page is shown; true when it has to load again. */
  done(latest: string | null): boolean {
    const shown = this.#sent ?? latest;
    const again = this.#newer || (latest !== null && latest !== shown);
    this.shown = shown;
    this.#sent = undefined;
    return again;
  }

  /** The reload failed. */
  stop(): void {
    this.#sent = undefined;
  }
}

/** List data of a recipe, if a list showed it in this session. */
export function cachedCard(id: number): RecipeCard | null {
  return cards.get(id) ?? null;
}
