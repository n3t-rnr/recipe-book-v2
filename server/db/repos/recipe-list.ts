import type BetterSqlite3 from 'better-sqlite3';
import type { RecipeCard, TagRef } from '../../../shared/types.ts';
import type { SearchSpec } from '../search.ts';
import type { DB } from '../types.ts';

/**
 * Sort orders of the list: F-26 (relevance, newest, title) and "Zuletzt geändert" (F-44);
 * the rating sorts follow in M5.
 */
export type ListSort = 'relevance' | 'newest' | 'updated' | 'title';
type KeysetSort = Exclude<ListSort, 'relevance'>;

/**
 * Position after the last row of a page (Kap. 4.5 point 8). Newest, updated and title use a keyset:
 * the sort value(s) of that row plus its id as tie-break, so equal timestamps or titles never skip
 * or repeat a recipe. Relevance uses an offset, which is fine for ≤ 1,000 hits.
 */
export type ListCursor =
  | { sort: 'newest' | 'updated'; at: string; id: number }
  | { sort: 'title'; key: string; title: string; id: number }
  | { sort: 'relevance'; offset: number };

/** Tag filter (F-24, Kap. 4.5 point 4): "all" needs every tag, "any" one of them. */
export interface TagFilter {
  /** Distinct tag ids, at least one. An unknown id matches nothing in "all" and is ignored in "any". */
  ids: number[];
  mode: 'all' | 'any';
}

export interface ListOptions {
  /** 'relevance' needs `search`. */
  sort: ListSort;
  /** null = first page. Its sort must equal `sort`. */
  cursor: ListCursor | null;
  /** Page size, 1..100 (validated by the route). */
  limit: number;
  /** Header profile for myRating/isFavorite; null leaves both null (F-05). */
  profileId: number | null;
  /** Full-text search (F-21, F-22); null = none. */
  search: SearchSpec | null;
  tagFilter: TagFilter | null;
}

export interface ListPage {
  items: RecipeCard[];
  /** Position after the last item, null on the last page. */
  nextCursor: ListCursor | null;
  /** Active recipes matching search and filters. */
  total: number;
  /** All active recipes ("14 von 38 Rezepten"). */
  totalAll: number;
  /**
   * meta.data_revision as read by the page statement of a search (freshness of the „Meintest du“
   * word list without an extra statement); null without a search.
   */
  revision: number | null;
}

/** Tags shown on a card; the rest is counted in moreTags (F-29 card, Kap. 7.4). */
export const CARD_TAG_COUNT = 3;

/** Largest relevance offset a cursor carries; the relevance list ends there. */
export const MAX_RELEVANCE_OFFSET = 10_000;

/** A shape cache that grew past this many statements is dropped and rebuilt on demand. */
const MAX_CACHED_SHAPES = 64;

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
const ORDERS: Record<KeysetSort, Order> = {
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
 * One statement for page and total (NF-04, Kap. 4.5 point 6) of the unfiltered list. The count row is
 * the driving table and the page is LEFT JOINed onto it, so an empty page still returns the total
 * (one row, p.* NULL). Rating average/count are correlated subqueries over idx_ratings_recipe; own
 * rating and favorite are joins on the header profile (@profileId NULL matches nothing).
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

/**
 * What decides the SQL text of a list statement; the parameter values never do.
 * terms: 'L' = 3+ characters in every spelling (prefix and substring), 'S' = prefix only ("ei", "oel").
 */
export interface ListShape {
  sort: ListSort;
  /** Keyset sorts only; the relevance offset is always a parameter. */
  withCursor: boolean;
  terms: ReadonlyArray<'L' | 'S'>;
  tagMode: TagFilter['mode'] | null;
}

function shapeKey(shape: ListShape): string {
  return `${shape.sort}|${shape.withCursor ? 1 : 0}|${shape.terms.join('')}|${shape.tagMode ?? '-'}`;
}

/** Substring test of term i on a key column; both patterns are bound (Kap. 4.5 point 2). */
function likeBoth(column: string, i: number): string {
  return `(${column} LIKE @l${i}a ESCAPE '\\' OR ${column} LIKE @l${i}b ESCAPE '\\')`;
}

/**
 * Ids hit by term i: prefix in any FTS column, and for 'L' terms also a substring of the title key,
 * of a tag key or of an ingredient key (compounds). Trash is filtered later.
 */
function termCte(kind: 'L' | 'S', i: number): string {
  const sources = [`SELECT rowid AS id FROM recipes_fts WHERE recipes_fts MATCH @f${i}`];
  if (kind === 'L') {
    sources.push(
      `SELECT id FROM recipes WHERE ${likeBoth('title_key', i)}`,
      `SELECT rt.recipe_id FROM tags t JOIN recipe_tags rt ON rt.tag_id = t.id WHERE ${likeBoth('t.name_key', i)}`,
      `SELECT recipe_id FROM ingredients WHERE ${likeBoth('name_key', i)}`,
    );
  }
  return `m${i} AS (
      ${sources.join('\n      UNION ')}
    )`;
}

/** Active recipes that pass search and tag filter; `r` is the recipes row. */
function filterSql(search: boolean, tagMode: TagFilter['mode'] | null): string {
  const parts = ['r.deleted_at IS NULL'];
  if (search) parts.push('r.id IN (SELECT id FROM hits)');
  if (tagMode === 'all') {
    parts.push(
      `r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag_id IN (SELECT value FROM json_each(@tagIds))
               GROUP BY recipe_id HAVING count(*) = @tagCount)`,
    );
  } else if (tagMode === 'any') {
    parts.push(
      `EXISTS (SELECT 1 FROM recipe_tags rt
               WHERE rt.recipe_id = r.id AND rt.tag_id IN (SELECT value FROM json_each(@tagIds)))`,
    );
  }
  return parts.join('\n        AND ');
}

/** Ranking tier 0 (Kap. 4.5 point 5a): every term hits the title, as substring or ('S' terms) prefix. */
function titleAllSql(terms: ListShape['terms']): string {
  return terms
    .map((kind, i) =>
      kind === 'L'
        ? likeBoth('r.title_key', i)
        : `r.id IN (SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH @t${i})`,
    )
    .join(' AND ');
}

/**
 * Page, filtered total, total of all active recipes and (for a search) the data revision in ONE
 * statement (NF-04: with profile lookup, card tags and revision header a request stays at 4).
 * `hits` is used by count and page and `rank` by every page row, so both MUST be materialized:
 * inlined, SQLite re-runs the FTS query per row („zwieb“ took 54 ms instead of 0.7 ms).
 *
 * Relevance (Kap. 4.5 point 5): tier 0 = all terms in the title, tier 1 = any FTS hit, weighted by
 * bm25 (title 10, tags 6, ingredients 4, text 1) also inside tier 0, tier 2 = only substring hits
 * outside the title; ties by title_key, title and id.
 */
function buildListSql(shape: ListShape): string {
  const search = shape.terms.length > 0;
  const filter = filterSql(search, shape.tagMode);
  const ctes: string[] = [];
  if (search) {
    shape.terms.forEach((kind, i) => {
      ctes.push(termCte(kind, i));
    });
    ctes.push(
      `hits AS MATERIALIZED (${shape.terms.map((_, i) => `SELECT id FROM m${i}`).join(' INTERSECT ')})`,
    );
  }

  let outerOrder: string;
  if (shape.sort === 'relevance') {
    if (!search) throw new Error('relevance needs a search');
    ctes.push(
      `rank AS MATERIALIZED (
      SELECT rowid AS id, bm25(recipes_fts, 10.0, 6.0, 4.0, 1.0) AS score
      FROM recipes_fts WHERE recipes_fts MATCH @ftsAny
    )`,
      `page AS (
      SELECT r.id, r.title, r.title_key, r.created_at, r.updated_at, r.prep_minutes, r.cook_minutes,
        CASE WHEN ${titleAllSql(shape.terms)} THEN 0 WHEN rk.score IS NOT NULL THEN 1 ELSE 2 END AS tier,
        coalesce(rk.score, 0) AS score
      FROM recipes r LEFT JOIN rank rk ON rk.id = r.id
      WHERE ${filter}
      ORDER BY tier, score, r.title_key, r.title, r.id
      LIMIT @take OFFSET @offset
    )`,
    );
    outerOrder = 'p.tier, p.score, p.title_key, p.title, p.id';
  } else {
    const order = ORDERS[shape.sort];
    ctes.push(
      `page AS (
      SELECT r.id, r.title, r.title_key, r.created_at, r.updated_at, r.prep_minutes, r.cook_minutes
      FROM recipes r
      WHERE ${filter}${shape.withCursor ? `\n        AND ${order.after}` : ''}
      ORDER BY ${order.inner}
      LIMIT @take
    )`,
    );
    outerOrder = order.outer;
  }

  const revision = search ? "(SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'data_revision')" : 'NULL';
  return `
    WITH ${ctes.join(',\n    ')}
    SELECT
      t.total, t.total_all, t.revision,
      p.id, p.title, p.title_key, p.created_at, p.updated_at, p.prep_minutes, p.cook_minutes,
      img.file_key, img.width, img.height,
      (SELECT avg(r.stars) FROM ratings r WHERE r.recipe_id = p.id) AS rating_avg,
      (SELECT count(*) FROM ratings r WHERE r.recipe_id = p.id) AS rating_count,
      mine.stars AS my_stars,
      fav.recipe_id IS NOT NULL AS is_favorite
    FROM (
      SELECT count(*) AS total,
        (SELECT count(*) FROM recipes WHERE deleted_at IS NULL) AS total_all,
        ${revision} AS revision
      FROM recipes r
      WHERE ${filter}
    ) AS t
    LEFT JOIN page AS p ON 1
    LEFT JOIN images AS img ON img.recipe_id = p.id
    LEFT JOIN ratings AS mine ON mine.recipe_id = p.id AND mine.profile_id = @profileId
    LEFT JOIN favorites AS fav ON fav.recipe_id = p.id AND fav.profile_id = @profileId
    ORDER BY ${outerOrder}`;
}

/** SQL text of a shape; the unfiltered shapes keep the M2 statement (same text, same plan). */
export function listSql(shape: ListShape): string {
  if (shape.terms.length === 0 && shape.tagMode === null && shape.sort !== 'relevance') {
    return pageSql(ORDERS[shape.sort], shape.withCursor);
  }
  return buildListSql(shape);
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
  /** Page statements by shape key, compiled on first use. */
  pages: Map<string, Stmt>;
  tags: Stmt;
}

// Prepared per connection; a repeated request shape only executes (never compiles) statements.
const cache = new WeakMap<DB, ListStatements>();

function statements(db: DB): ListStatements {
  let s = cache.get(db);
  if (!s) {
    s = { pages: new Map(), tags: db.prepare(TAGS_SQL) };
    cache.set(db, s);
  }
  return s;
}

function pageStatement(db: DB, shape: ListShape): Stmt {
  const pages = statements(db).pages;
  const key = shapeKey(shape);
  let stmt = pages.get(key);
  if (!stmt) {
    // Up to 8 terms, 3 tag modes and 4 sorts give hundreds of shapes; real use needs a handful.
    if (pages.size >= MAX_CACHED_SHAPES) pages.clear();
    stmt = db.prepare(listSql(shape));
    pages.set(key, stmt);
  }
  return stmt;
}

interface PageRow {
  total: number;
  /** Only in filtered shapes. */
  total_all?: number;
  /** Only in filtered shapes; NULL unless searching. */
  revision?: number | null;
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

type Params = Record<string, string | number | null>;

function cursorParams(cursor: ListCursor): Params {
  switch (cursor.sort) {
    case 'title':
      return { key: cursor.key, title: cursor.title, id: cursor.id };
    case 'relevance':
      return { offset: cursor.offset };
    default:
      return { at: cursor.at, id: cursor.id };
  }
}

function searchParams(search: SearchSpec, relevance: boolean): Params {
  const params: Params = {};
  search.terms.forEach((term, i) => {
    params[`f${i}`] = term.fts;
    if (term.likes) {
      params[`l${i}a`] = term.likes[0];
      params[`l${i}b`] = term.likes[1];
    } else if (relevance) {
      params[`t${i}`] = term.ftsTitle;
    }
  });
  if (relevance) params.ftsAny = search.ftsAny;
  return params;
}

function cursorAfter(sort: KeysetSort, row: CardRow): ListCursor {
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
 * One page of active recipes as cards (Kap. 7.4), optionally searched (F-21, F-22) and filtered by
 * tags (F-24), with keyset or (relevance) offset pagination (Kap. 4.5 point 8).
 * Executes at most two statements: page + totals, then the tags of the page ids (NF-04).
 */
export function listRecipes(db: DB, opts: ListOptions): ListPage {
  if (opts.cursor && opts.cursor.sort !== opts.sort) {
    throw new Error(`cursor for sort "${opts.cursor.sort}" used with sort "${opts.sort}"`);
  }
  if (opts.sort === 'relevance' && !opts.search) throw new Error('sort "relevance" needs a search');
  const tagFilter = opts.tagFilter && opts.tagFilter.ids.length > 0 ? opts.tagFilter : null;
  const relevance = opts.sort === 'relevance';
  const shape: ListShape = {
    sort: opts.sort,
    withCursor: opts.cursor !== null && !relevance,
    terms: opts.search ? opts.search.terms.map((t) => (t.likes ? 'L' : 'S')) : [],
    tagMode: tagFilter?.mode ?? null,
  };
  const plain = shape.terms.length === 0 && shape.tagMode === null;

  const params: Params = {
    take: opts.limit + 1,
    profileId: opts.profileId,
    ...(relevance ? { offset: 0 } : {}),
    ...(opts.cursor ? cursorParams(opts.cursor) : {}),
    ...(opts.search ? searchParams(opts.search, relevance) : {}),
  };
  if (tagFilter) {
    params.tagIds = JSON.stringify(tagFilter.ids);
    if (tagFilter.mode === 'all') params.tagCount = tagFilter.ids.length;
  }

  const rows = pageStatement(db, shape).all(params) as PageRow[];
  const head = rows[0];
  const total = head?.total ?? 0;
  const totalAll = plain ? total : (head?.total_all ?? 0);
  const revision = head?.revision ?? null;
  const found = rows.filter((row): row is CardRow => row.id !== null);

  // One extra row was fetched to learn whether another page exists without a second query.
  const hasMore = found.length > opts.limit;
  const pageRows = hasMore ? found.slice(0, opts.limit) : found;
  if (pageRows.length === 0) return { items: [], nextCursor: null, total, totalAll, revision };

  const tagRows = statements(db).tags.all({ ids: JSON.stringify(pageRows.map((r) => r.id)) }) as TagRow[];
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

  let nextCursor: ListCursor | null = null;
  const last = pageRows.at(-1);
  if (hasMore && last) {
    if (opts.sort === 'relevance') {
      const offset = (opts.cursor?.sort === 'relevance' ? opts.cursor.offset : 0) + opts.limit;
      nextCursor = offset <= MAX_RELEVANCE_OFFSET ? { sort: 'relevance', offset } : null;
    } else {
      nextCursor = cursorAfter(opts.sort, last);
    }
  }
  return { items, nextCursor, total, totalAll, revision };
}
