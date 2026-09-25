import { Hono } from 'hono';
import * as z from 'zod/mini';
import { LIMITS } from '../../shared/constants.ts';
import type { ValidationDetail } from '../../shared/error-codes.ts';
import type { RecipeListPage, TrashResponse } from '../../shared/types.ts';
import {
  type ListCursor,
  type ListSort,
  listRecipes,
  MAX_RELEVANCE_OFFSET,
  type TagFilter,
} from '../db/repos/recipe-list.ts';
import { buildSearchSpec, type SearchSpec } from '../db/search.ts';
import { AppError } from '../errors.ts';
import { requireProfile } from '../middleware/profile.ts';
import { didYouMean, MIN_SUGGEST_TERM } from '../services/did-you-mean.ts';
import { getTrash, purgeRecipe } from '../services/trash.ts';
import type { AppDeps, AppEnv } from '../types.ts';

/** Query parameters of a later milestone (Kap. 7.4): favorites and minimum rating in M5. */
const LATER_PARAMS = ['fav', 'minRating'] as const;
/** Sort orders of a later milestone: rating and myRating (M5). */
const LATER_SORTS = new Set(['rating', 'myRating']);
const LATER_MESSAGE = 'Diese Filter folgen in einer späteren Version';

const SORTS = ['relevance', 'newest', 'updated', 'title'] as const satisfies readonly ListSort[];
const TAG_MODES = ['all', 'any'] as const satisfies readonly TagFilter['mode'][];

/** 1 to 20 positive ids, comma-separated (F-24); an id above the safe integer range is refused below. */
const TAG_IDS = new RegExp(String.raw`^[1-9]\d{0,15}(,[1-9]\d{0,15}){0,${LIMITS.filterTags - 1}}$`);

const ListQuery = z.object({
  q: z.optional(z.string().check(z.maxLength(LIMITS.query))),
  tags: z.optional(
    z.string().check(
      z.regex(TAG_IDS),
      z.refine((v) => v.split(',').every((id) => Number.isSafeInteger(Number(id)))),
    ),
  ),
  tagMode: z._default(z.enum(TAG_MODES), 'all'),
  sort: z.optional(z.enum(SORTS)),
  cursor: z.optional(z.string().check(z.maxLength(2048))),
  limit: z.optional(
    z.string().check(
      z.regex(/^\d{1,3}$/),
      z.refine((v) => Number(v) >= 1 && Number(v) <= LIMITS.pageSizeMax),
    ),
  ),
});

/** German texts per query field; the generic zod messages would only say "Eingabe …". */
const QUERY_MESSAGES: Record<string, string> = {
  q: 'Suchbegriff zu lang',
  tags: 'Ungültige Tag-Auswahl',
  tagMode: 'Unbekannter Filtermodus',
  sort: 'Unbekannte Sortierung',
  cursor: 'Ungültige Seitenmarke – bitte die Liste neu laden',
  limit: `Die Seitengröße muss zwischen 1 und ${LIMITS.pageSizeMax} liegen`,
};

// Cursor wire format: base64url(JSON) of [sortTag, ...sortValues, id], for relevance ['r', offset].
// Opaque for the client.
const SORT_TAGS = { relevance: 'r', newest: 'n', updated: 'u', title: 't' } as const satisfies Record<
  ListSort,
  string
>;
const posId = z.int().check(z.gte(1));
const isoTime = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/));
const CursorTuple = z.union([
  z.tuple([z.literal('r'), z.int().check(z.gte(1), z.lte(MAX_RELEVANCE_OFFSET))]),
  z.tuple([z.literal('n'), isoTime, posId]),
  z.tuple([z.literal('u'), isoTime, posId]),
  z.tuple([z.literal('t'), z.string().check(z.maxLength(500)), z.string().check(z.maxLength(500)), posId]),
]);

export function encodeCursor(cursor: ListCursor): string {
  let tuple: unknown[];
  switch (cursor.sort) {
    case 'relevance':
      tuple = [SORT_TAGS.relevance, cursor.offset];
      break;
    case 'title':
      tuple = [SORT_TAGS.title, cursor.key, cursor.title, cursor.id];
      break;
    default:
      tuple = [SORT_TAGS[cursor.sort], cursor.at, cursor.id];
  }
  return Buffer.from(JSON.stringify(tuple), 'utf8').toString('base64url');
}

/** Decodes a cursor for `sort`; null when it is malformed or belongs to another sort order. */
export function decodeCursor(raw: string, sort: ListSort): ListCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = CursorTuple.safeParse(json);
  if (!parsed.success) return null;
  const t = parsed.data;
  switch (t[0]) {
    case 'r':
      return sort === 'relevance' ? { sort, offset: t[1] } : null;
    case 't':
      return sort === 'title' ? { sort, key: t[1], title: t[2], id: t[3] } : null;
    case 'n':
      return sort === 'newest' ? { sort, at: t[1], id: t[2] } : null;
    case 'u':
      return sort === 'updated' ? { sort, at: t[1], id: t[2] } : null;
  }
}

function validationError(details: ValidationDetail[]): AppError {
  return new AppError('VALIDATION', details[0]?.message ?? 'Ungültige Anfrage', details);
}

interface ParsedListQuery {
  /** Trimmed search text, '' without q. */
  q: string;
  /** null when q has no usable term (Kap. 4.5 point 1): the list is then unsearched. */
  search: SearchSpec | null;
  tagFilter: TagFilter | null;
  /** Effective sort: relevance with a usable term, else newest, unless given; relevance needs a term. */
  sort: ListSort;
  cursor: ListCursor | null;
  limit: number;
}

function parseListQuery(query: Record<string, string>): ParsedListQuery {
  // Empty values ("?q=&sort=") count as absent, as a form with empty fields would send them.
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value.trim() !== '') present[key] = value.trim();
  }

  const later: ValidationDetail[] = LATER_PARAMS.filter((key) => key in present).map((field) => ({
    field,
    message: LATER_MESSAGE,
  }));
  if (present.sort !== undefined && LATER_SORTS.has(present.sort)) {
    later.push({ field: 'sort', message: LATER_MESSAGE });
  }
  if (later.length > 0) throw new AppError('VALIDATION', LATER_MESSAGE, later);

  const parsed = ListQuery.safeParse(present);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))];
    throw validationError(
      fields.map((field) => ({ field, message: QUERY_MESSAGES[field] ?? 'Ungültiger Parameter' })),
    );
  }
  const { q = '', tags, tagMode, cursor: rawCursor, limit } = parsed.data;
  const search = q === '' ? null : buildSearchSpec(q);
  // F-26: relevance is the default with a search term; without one (still typing "k") it is newest.
  const requested = parsed.data.sort ?? (search ? 'relevance' : 'newest');
  const sort: ListSort = requested === 'relevance' && !search ? 'newest' : requested;
  // tagMode is validated always but only matters with tags; "3,3" is the tag 3 once.
  const tagFilter: TagFilter | null =
    tags === undefined ? null : { ids: [...new Set(tags.split(',').map(Number))], mode: tagMode };

  let cursor: ListCursor | null = null;
  if (rawCursor !== undefined) {
    cursor = decodeCursor(rawCursor, sort);
    if (!cursor) throw validationError([{ field: 'cursor', message: QUERY_MESSAGES.cursor ?? '' }]);
  }
  return {
    q,
    search,
    tagFilter,
    sort,
    cursor,
    limit: limit === undefined ? LIMITS.pageSize : Number(limit),
  };
}

/**
 * „Meintest du“ (F-23) only for a first page without hits whose search has a term of 4+ characters.
 * Not with a tag filter: there the 0 may come from the tags, and a word from the word list (built
 * from all active recipes) could again find nothing within those tags.
 */
function wantsSuggestion(query: ParsedListQuery, total: number): boolean {
  return (
    query.cursor === null &&
    total === 0 &&
    query.tagFilter === null &&
    (query.search?.terms.some((t) => Array.from(t.term).length >= MIN_SUGGEST_TERM) ?? false)
  );
}

/** An id that is not a positive integer cannot exist, so it is answered like an unknown one. */
function parseRecipeId(raw: string): number {
  const id = /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(id)) throw new AppError('NOT_FOUND', 'Rezept nicht gefunden');
  return id;
}

/**
 * Recipe list with search, tag filter and sorting (F-21 to F-24, F-26, F-29 cards, F-34), trash list
 * and final deletion (F-08) — Kap. 7.4.
 */
export function recipeListRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/recipes', (c) => {
    const query = parseListQuery(c.req.query());
    const profile = c.get('profile');
    const page = listRecipes(deps.db, {
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
      profileId: profile?.id ?? null,
      search: query.search,
      tagFilter: query.tagFilter,
    });
    const body: RecipeListPage = {
      items: page.items,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      total: page.total,
      totalAll: page.totalAll,
    };
    if (wantsSuggestion(query, page.total)) {
      // The page statement of a search read the revision, so a fresh word list costs no statement.
      const suggestion = didYouMean(deps.db, query.q, page.revision ?? 0);
      if (suggestion !== null) body.didYouMean = suggestion;
    }
    return c.json(body);
  });

  app.get('/trash', (c) => {
    const body: TrashResponse = { items: getTrash(deps) };
    return c.json(body);
  });

  app.delete('/trash/:id', (c) => {
    requireProfile(c);
    purgeRecipe(deps, parseRecipeId(c.req.param('id')));
    return c.body(null, 204);
  });

  return app;
}
