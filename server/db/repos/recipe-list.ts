import type BetterSqlite3 from 'better-sqlite3';
import type { RecipeCard, TagRef } from '../../../shared/types.ts';
import type { DB } from '../types.ts';

/** Sort orders of the M2 list (F-26, F-44 "Zuletzt geändert"); relevance and ratings follow in M4/M5. */
export type ListSort = 'newest' | 'updated' | 'title';

/**
 * Keyset position after the last row of a page (Kap. 4.5 point 8): the sort value(s) of that row
 * plus its id as tie-break, so equal timestamps or titles never skip or repeat a recipe.
 */
export type ListCursor =
  | { sort: 'newest' | 'updated'; at: string; id: number }
  | { sort: 'title'; key: string; title: string; id: number };

export interface ListOptions {
  sort: ListSort;
  /** null = first page. Its sort must equal `sort`. */
  cursor: ListCursor | null;
  /** Page size, 1..100 (validated by the route). */
  limit: number;
  /** Header profile for myRating/isFavorite; null leaves both null (F-05). */
  profileId: number | null;
}

export interface ListPage {
  items: RecipeCard[];
  /** Position after the last item, null on the last page. */
  nextCursor: ListCursor | null;
  /** All active recipes (M2 has no filters yet). */
  total: number;
}

/** Tags shown on a card; the rest is counted in moreTags (F-29 card, Kap. 7.4). */
export const CARD_TAG_COUNT = 3;

interface Order {
  /** ORDER BY inside the page CTE (unqualified columns, matches the partial indexes). */
  inner: string;
  /** Same order on the outer query, where the page is joined as p. */
  outer: string;
  /** Row-value comparison "after the cursor". */
  after: string;
}

// id is the rowid, so every partial index (created_at / updated_at / title_key, title) already ends
// with it and serves both the ORDER BY and the row-value range without a sort step.
const ORDERS: Record<ListSort, Order> = {
  newest: {
    inner: 'created_at DESC, id DESC',
    outer: 'p.created_at DESC, p.id DESC',
    after: '(created_at, id) < (@at, @id)',
  },
  updated: {
    inner: 'updated_at DESC, id DESC',
    outer: 'p.updated_at DESC, p.id DESC',
    after: '(updated_at, id) < (@at, @id)',
  },
  // DIN 5007-1 (Kap. 4.4): normalized key first, then the binary order of the original title, then id.
  title: {
    inner: 'title_key ASC, title ASC, id ASC',
    outer: 'p.title_key ASC, p.title ASC, p.id ASC',
    after: '(title_key, title, id) > (@key, @title, @id)',
  },
};

/**
 * One statement for page and total (NF-04, Kap. 4.5 point 6). The count row is the driving table
 * and the page is LEFT JOINed onto it, so an empty page still returns the total (one row, p.* NULL).
 * Rating average/count are correlated subqueries over idx_ratings_recipe; own rating and favorite
 * are joins on the header profile (@profileId NULL matches nothing).
 */
function pageSql(order: Order, withCursor: boolean): string {
  return `
    WITH page AS (
      SELECT id, title, title_key, created_at, updated_at, prep_minutes, cook_minutes
      FROM recipes
      WHERE deleted_at IS NULL${withCursor ? ` AND ${order.after}` : ''}
      ORDER BY ${order.inner}
      LIMIT @take
    )
    SELECT
      t.total,
      p.id, p.title, p.title_key, p.created_at, p.updated_at, p.prep_minutes, p.cook_minutes,
      img.file_key, img.width, img.height,
      (SELECT avg(r.stars) FROM ratings r WHERE r.recipe_id = p.id) AS rating_avg,
      (SELECT count(*) FROM ratings r WHERE r.recipe_id = p.id) AS rating_count,
      mine.stars AS my_stars,
      fav.recipe_id IS NOT NULL AS is_favorite
    FROM (SELECT count(*) AS total FROM recipes WHERE deleted_at IS NULL) AS t
    LEFT JOIN page AS p ON 1
    LEFT JOIN images AS img ON img.recipe_id = p.id
    LEFT JOIN ratings AS mine ON mine.recipe_id = p.id AND mine.profile_id = @profileId
    LEFT JOIN favorites AS fav ON fav.recipe_id = p.id AND fav.profile_id = @profileId
    ORDER BY ${order.outer}`;
}

/** Card tags of all page recipes in one statement: the first three by name key plus the count of the rest. */
const TAGS_SQL = `
  SELECT recipe_id, id, name, total
  FROM (
    SELECT rt.recipe_id, t.id, t.name,
           row_number() OVER (PARTITION BY rt.recipe_id ORDER BY t.name_key, t.name, t.id) AS n,
           count(*) OVER (PARTITION BY rt.recipe_id) AS total
    FROM recipe_tags rt
    JOIN tags t ON t.id = rt.tag_id
    WHERE rt.recipe_id IN (SELECT value FROM json_each(@ids))
  )
  WHERE n <= ${CARD_TAG_COUNT}
  ORDER BY recipe_id, n`;

type Stmt = BetterSqlite3.Statement<unknown[]>;

interface ListStatements {
  first: Record<ListSort, Stmt>;
  next: Record<ListSort, Stmt>;
  tags: Stmt;
}

// Prepared once per connection; a list request then only executes (never compiles) statements.
const cache = new WeakMap<DB, ListStatements>();

function statements(db: DB): ListStatements {
  let s = cache.get(db);
  if (!s) {
    const prepareAll = (withCursor: boolean): Record<ListSort, Stmt> => ({
      newest: db.prepare(pageSql(ORDERS.newest, withCursor)),
      updated: db.prepare(pageSql(ORDERS.updated, withCursor)),
      title: db.prepare(pageSql(ORDERS.title, withCursor)),
    });
    s = { first: prepareAll(false), next: prepareAll(true), tags: db.prepare(TAGS_SQL) };
    cache.set(db, s);
  }
  return s;
}

interface PageRow {
  total: number;
  id: number | null;
  title: string;
  title_key: string;
  created_at: string;
  updated_at: string;
  prep_minutes: number | null;
  cook_minutes: number | null;
  file_key: string | null;
  width: number | null;
  height: number | null;
  rating_avg: number | null;
  rating_count: number;
  my_stars: number | null;
  is_favorite: 0 | 1;
}

interface CardRow extends PageRow {
  id: number;
}

interface TagRow {
  recipe_id: number;
  id: number;
  name: string;
  total: number;
}

function cursorParams(cursor: ListCursor): Record<string, string | number> {
  return cursor.sort === 'title'
    ? { key: cursor.key, title: cursor.title, id: cursor.id }
    : { at: cursor.at, id: cursor.id };
}

function cursorAfter(sort: ListSort, row: CardRow): ListCursor {
  if (sort === 'title') return { sort, key: row.title_key, title: row.title, id: row.id };
  return { sort, at: sort === 'newest' ? row.created_at : row.updated_at, id: row.id };
}

/** Average with one decimal (F-27 shows "Ø 4,3"); null when nobody rated. */
function roundAvg(avg: number | null): number | null {
  return avg === null ? null : Math.round(avg * 10) / 10;
}

function totalMinutes(prep: number | null, cook: number | null): number | null {
  if (prep === null && cook === null) return null;
  return (prep ?? 0) + (cook ?? 0);
}

function toCard(row: CardRow, tags: TagRef[], moreTags: number, withProfile: boolean): RecipeCard {
  return {
    id: row.id,
    title: row.title,
    image:
      row.file_key === null
        ? null
        : {
            urls: { s: `/media/${row.file_key}-s.webp`, m: `/media/${row.file_key}-m.webp` },
            width: row.width ?? 0,
            height: row.height ?? 0,
          },
    tags,
    moreTags,
    ratingAvg: roundAvg(row.rating_avg),
    ratingCount: row.rating_count,
    myRating: withProfile ? row.my_stars : null,
    isFavorite: withProfile ? row.is_favorite === 1 : null,
    totalMinutes: totalMinutes(row.prep_minutes, row.cook_minutes),
    updatedAt: row.updated_at,
  };
}

/**
 * One page of active recipes as cards (Kap. 7.4) with keyset pagination (Kap. 4.5 point 8).
 * Executes at most two statements: page + total, then the tags of the page ids (NF-04).
 */
export function listRecipes(db: DB, opts: ListOptions): ListPage {
  if (opts.cursor && opts.cursor.sort !== opts.sort) {
    throw new Error(`cursor for sort "${opts.cursor.sort}" used with sort "${opts.sort}"`);
  }
  const s = statements(db);
  const stmt = opts.cursor ? s.next[opts.sort] : s.first[opts.sort];
  const params = {
    take: opts.limit + 1,
    profileId: opts.profileId,
    ...(opts.cursor ? cursorParams(opts.cursor) : {}),
  };
  const rows = stmt.all(params) as PageRow[];
  const total = rows[0]?.total ?? 0;
  const found = rows.filter((row): row is CardRow => row.id !== null);

  // One extra row was fetched to learn whether another page exists without a second query.
  const hasMore = found.length > opts.limit;
  const pageRows = hasMore ? found.slice(0, opts.limit) : found;
  if (pageRows.length === 0) return { items: [], nextCursor: null, total };

  const tagRows = s.tags.all({ ids: JSON.stringify(pageRows.map((r) => r.id)) }) as TagRow[];
  const tagsById = new Map<number, { tags: TagRef[]; total: number }>();
  for (const t of tagRows) {
    let entry = tagsById.get(t.recipe_id);
    if (!entry) {
      entry = { tags: [], total: t.total };
      tagsById.set(t.recipe_id, entry);
    }
    entry.tags.push({ id: t.id, name: t.name });
  }

  const withProfile = opts.profileId !== null;
  const items = pageRows.map((row) => {
    const entry = tagsById.get(row.id);
    const tags = entry?.tags ?? [];
    return toCard(row, tags, (entry?.total ?? 0) - tags.length, withProfile);
  });
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? cursorAfter(opts.sort, last) : null,
    total,
  };
}
