/**
 * Lazily loaded route chunks (NF-01): the initial JS budget covers shell, profile choice and list
 * (≤ 35 KB gzip); detail, editor, tags and "Mehr" load on demand. Nothing is prefetched on idle, so the
 * first visit of the list loads only the entry chunk (NF-01 AK); intent-based preloading is fine.
 */
import { connection } from '../state/connection.svelte.ts';

/**
 * Loads a chunk once; a failed load (server gone) marks the connection offline. Chromium keeps the failed
 * import in its module map, so callers recover with a page reload once the server answers (chunk-retry.ts).
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((err: unknown) => {
      pending = null;
      connection.markOffline();
      throw err;
    }));
}

export const loadRecipeDetail = lazy(() => import('../routes/RecipeDetail.svelte'));
export const loadRecipeEdit = lazy(() => import('../routes/RecipeEdit.svelte'));
export const loadTags = lazy(() => import('../routes/Tags.svelte'));
export const loadMore = lazy(() => import('../routes/More.svelte'));
export const loadConnect = lazy(() => import('../routes/Connect.svelte'));
export const loadTrash = lazy(() => import('../routes/Trash.svelte'));
export const loadStatus = lazy(() => import('../routes/Status.svelte'));

/**
 * Starts loading the detail chunk when the user presses a recipe (pointerdown/focus on a card or row),
 * so the tap opens the detail without waiting for the network (F-29: ≤ 200 ms).
 */
export function preloadRecipeDetail(): void {
  loadRecipeDetail().catch(() => {});
}
