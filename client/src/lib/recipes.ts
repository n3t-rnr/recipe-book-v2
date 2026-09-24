/**
 * Recipe list data of the initial screens (Kap. 7.4) and the caches that make navigation feel instant:
 * - the list snapshot survives unmounting, so Back from a recipe shows the same pages at once and the
 *   router can restore the scroll position (F-34);
 * - the card cache gives the detail its title and image from list data before the detail request
 *   answers (F-29: ≤ 200 ms).
 * Calls of the lazily loaded screens (detail, trash, "Mehr") stay in those chunks (NF-01).
 */
import { LIMITS } from '../../../shared/constants.ts';
import type { RecipeCard, RecipeListResponse } from '../../../shared/types.ts';
import { get } from './api.ts';

export const PAGE_SIZE = LIMITS.pageSize;

/** One page of GET /recipes (default sort "newest"; filters follow in M4). */
export function fetchRecipePage(
  cursor: string | null,
  limit: number = PAGE_SIZE,
  signal?: AbortSignal,
): Promise<RecipeListResponse> {
  const query = { cursor, limit: Math.min(Math.max(limit, 1), LIMITS.pageSizeMax) };
  return get<RecipeListResponse>('/recipes', signal ? { query, signal } : { query });
}

export interface ListSnapshot {
  items: RecipeCard[];
  nextCursor: string | null;
  total: number;
  /** X-Data-Revision the items belong to; a newer revision makes the list reload (F-36 light). */
  revision: string | null;
}

let snapshot: ListSnapshot | null = null;
const cards = new Map<number, RecipeCard>();

export function readListSnapshot(): ListSnapshot | null {
  return snapshot;
}

export function writeListSnapshot(next: ListSnapshot): void {
  snapshot = next;
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
