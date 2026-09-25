/**
 * List filter of the recipe list (F-21, F-24, F-26, F-34): search text, tags, tag mode and sort live in
 * the URL (Kap. 6.2), this module turns them into the list state, the API query and back. Pure and in the
 * entry chunk, so it imports neither zod nor normalize nor tag matching (NF-01, NF-02).
 */
import { LIMITS } from '../../../shared/constants.ts';
import type { TagCount } from '../../../shared/types.ts';
import { buildQuery, type QueryInput, type RouteName } from './routes.ts';

export type ListSortChoice = 'relevance' | 'newest' | 'title';
export type TagMode = 'all' | 'any';

export interface ListFilter {
  /** Raw search text as typed (the URL keeps it, so the caret never jumps). */
  q: string;
  /** Active tag ids in activation order (URL order), without duplicates, at most LIMITS.filterTags. */
  tags: number[];
  tagMode: TagMode;
  /** Explicit sort; null = the default (relevance with a search term, else newest; F-26). */
  sort: ListSortChoice | null;
}

export const EMPTY_FILTER: ListFilter = { q: '', tags: [], tagMode: 'all', sort: null };
/** F-21: „Die Suche startet ab 2 Zeichen mit 150 ms Debounce“. */
export const SEARCH_DEBOUNCE_MS = 150;
/** F-24: „aktive Tags zuerst, dann die 12 meistgenutzten“. */
export const CHIP_ROW_TAGS = 12;

const TAG_ID = /^[1-9]\d{0,15}$/;
const SORTS: readonly string[] = ['relevance', 'newest', 'title'] satisfies ListSortChoice[];

/**
 * At most LIMITS.query UTF-16 units (as the server counts them), but never half an emoji: a lone
 * surrogate makes encodeURIComponent (buildQuery) throw, which would take the list down.
 */
function clip(text: string): string {
  const cut = text.slice(0, LIMITS.query);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * Reads the filter from the URL query. Lenient: malformed or unknown values fall back to the defaults, so
 * a hand-edited or old link still opens a list. Ids beyond Number.MAX_SAFE_INTEGER are dropped, because
 * they would be sent rounded (and rejected with 400).
 */
export function parseListFilter(query: URLSearchParams): ListFilter {
  const tags: number[] = [];
  for (const part of (query.get('tags') ?? '').split(',')) {
    const id = Number(part);
    if (TAG_ID.test(part) && Number.isSafeInteger(id) && !tags.includes(id)) tags.push(id);
  }
  const sort = query.get('sort') ?? '';
  return {
    q: clip(query.get('q') ?? ''),
    tags: tags.slice(0, LIMITS.filterTags),
    tagMode: query.get('tagMode') === 'any' ? 'any' : 'all',
    sort: SORTS.includes(sort) ? (sort as ListSortChoice) : null,
  };
}

/**
 * True when the text has a usable search term: 2 or more letters or digits in a row (Kap. 4.5, F-21).
 * Combining marks between them count as part of the letter, as normalize() drops them: a pasted „Öl“ in
 * decomposed form (O + U+0308 + l) searches like the composed one. Such a term survives normalize() on
 * the server, so a searchable text always searches there.
 */
export function searchable(q: string): boolean {
  return /[\p{L}\p{N}]\p{M}*[\p{L}\p{N}]/u.test(q);
}

/** F-26: „Relevanz (Standard bei Suchbegriff), Neueste (Standard ohne Suchbegriff)“. */
export function effectiveSort(f: ListFilter): ListSortChoice {
  return f.sort === 'title' || f.sort === 'newest' ? f.sort : searchable(f.q) ? 'relevance' : 'newest';
}

export function isFiltered(f: ListFilter): boolean {
  return searchable(f.q) || f.tags.length > 0;
}

/** Number at the filter button (F-24 AK2): the active tags; M5 adds favourites and rating. */
export function activeFilterCount(f: ListFilter): number {
  return f.tags.length;
}

/**
 * URL query (keys in the order q, tags, tagMode, sort). Defaults are left out: no tagMode=all, never
 * sort=relevance, and sort=newest only while a search term would otherwise sort by relevance.
 */
export function toUrlQuery(f: ListFilter): QueryInput {
  return {
    q: f.q.trim() === '' ? null : f.q,
    tags: f.tags,
    tagMode: f.tagMode === 'any' ? 'any' : null,
    sort: f.sort === 'title' || (f.sort === 'newest' && searchable(f.q)) ? f.sort : null,
  };
}

/** Query of GET /recipes: q only when searchable (trimmed, whitespace collapsed), always the sort used. */
export function toApiQuery(f: ListFilter): QueryInput {
  return {
    q: searchable(f.q) ? clip(f.q.trim().replace(/\s+/g, ' ')) : null,
    tags: f.tags,
    tagMode: f.tags.length > 0 && f.tagMode === 'any' ? 'any' : null,
    sort: effectiveSort(f),
  };
}

/**
 * Identity of the result list: equal for filters the server answers the same way (tag order, a
 * one-letter q, the mode without tags). Keys the list snapshots and decides when the list reloads.
 */
export function filterKey(f: ListFilter): string {
  return buildQuery({ ...toApiQuery(f), tags: [...f.tags].sort((a, b) => a - b) });
}

/**
 * Switches one tag (F-24 AK1: „ein Fingertipp schaltet den Filter an oder aus“). A new tag goes to the
 * end (activation order); beyond LIMITS.filterTags active tags nothing is added.
 */
export function toggleTag(f: ListFilter, id: number): ListFilter {
  if (f.tags.includes(id)) return { ...f, tags: f.tags.filter((t) => t !== id) };
  return f.tags.length < LIMITS.filterTags ? { ...f, tags: [...f.tags, id] } : f;
}

/**
 * F-24 AK3: „Filter zurücksetzen“ removes the search text, all tags and the mode; an explicit sort
 * (Titel A–Z, Neueste) stays, relevance goes with the search text.
 */
export function resetFilter(f: ListFilter): ListFilter {
  return { q: '', tags: [], tagMode: 'all', sort: f.sort === 'relevance' ? null : f.sort };
}

/**
 * The chip row under the search field (F-24): the active tags in activation order (ids missing from the
 * list are skipped), then the first `limit` other tags in server order (count descending, so the most
 * used; unused start tags fill the row, F-20).
 */
export function chipRow(
  list: readonly TagCount[],
  active: readonly number[],
  limit: number = CHIP_ROW_TAGS,
): Array<{ tag: TagCount; active: boolean }> {
  const row: Array<{ tag: TagCount; active: boolean }> = [];
  // Ids already in the row: a keyed {#each} must never see a tag twice.
  const shown = new Set<number>();
  for (const id of active) {
    const tag = list.find((t) => t.id === id);
    if (tag && !shown.has(id)) {
      shown.add(id);
      row.push({ tag, active: true });
    }
  }
  let rest = 0;
  for (const tag of list) {
    if (rest >= limit) break;
    if (shown.has(tag.id)) continue;
    shown.add(tag.id);
    row.push({ tag, active: false });
    rest++;
  }
  return row;
}

/**
 * The filter without tag ids that `list` does not know (deleted or merged tags in an old link), or null
 * when every id is known. Only meaningful with a loaded, current tag list.
 */
export function knownTags(f: ListFilter, list: readonly TagCount[]): ListFilter | null {
  const ids = new Set(list.map((t) => t.id));
  const tags = f.tags.filter((id) => ids.has(id));
  return tags.length === f.tags.length ? null : { ...f, tags };
}

let remembered: ListFilter = EMPTY_FILTER;

/**
 * Filter of the list on this route. The detail at ≥ 1024 px shows the list next to it: a detail URL
 * without list parameters (after saving in the editor, a deep link) shows the last list filter.
 */
export function listFilterFor(route: RouteName, query: URLSearchParams): ListFilter {
  const plain = !['q', 'tags', 'tagMode', 'sort'].some((key) => query.has(key));
  return route === 'recipe' && plain ? remembered : parseListFilter(query);
}

/** Notes the filter the list shows, for listFilterFor() on a detail URL without list parameters. */
export function rememberListFilter(f: ListFilter): void {
  remembered = f;
}
