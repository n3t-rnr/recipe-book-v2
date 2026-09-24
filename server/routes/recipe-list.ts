import { Hono } from 'hono';
import * as z from 'zod/mini';
import { LIMITS } from '../../shared/constants.ts';
import type { ValidationDetail } from '../../shared/error-codes.ts';
import type { RecipeListResponse, TrashResponse } from '../../shared/types.ts';
import { type ListCursor, type ListSort, listRecipes } from '../db/repos/recipe-list.ts';
import { AppError } from '../errors.ts';
import { requireProfile } from '../middleware/profile.ts';
import { getTrash, purgeRecipe } from '../services/trash.ts';
import type { AppDeps, AppEnv } from '../types.ts';

/** Query parameters of later milestones (Kap. 7.4): filters in M4/M5. */
const LATER_PARAMS = ['q', 'tags', 'tagMode', 'fav', 'minRating'] as const;
/** Sort orders of later milestones: relevance (M4), rating and myRating (M5). */
const LATER_SORTS = new Set(['relevance', 'rating', 'myRating']);
const LATER_MESSAGE = 'Diese Filter folgen in einer späteren Version';

const SORTS = ['newest', 'updated', 'title'] as const satisfies readonly ListSort[];

const ListQuery = z.object({
  sort: z._default(z.enum(SORTS), 'newest'),
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
  sort: 'Unbekannte Sortierung',
  cursor: 'Ungültige Seitenmarke – bitte die Liste neu laden',
  limit: `Die Seitengröße muss zwischen 1 und ${LIMITS.pageSizeMax} liegen`,
};

// Cursor wire format: base64url(JSON) of [sortTag, ...sortValues, id]. Opaque for the client.
const SORT_TAGS = { newest: 'n', updated: 'u', title: 't' } as const satisfies Record<ListSort, string>;
const posId = z.int().check(z.gte(1));
const isoTime = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/));
const CursorTuple = z.union([
  z.tuple([z.literal('n'), isoTime, posId]),
  z.tuple([z.literal('u'), isoTime, posId]),
  z.tuple([z.literal('t'), z.string().check(z.maxLength(500)), z.string().check(z.maxLength(500)), posId]),
]);

export function encodeCursor(cursor: ListCursor): string {
  const tuple =
    cursor.sort === 'title'
      ? [SORT_TAGS.title, cursor.key, cursor.title, cursor.id]
      : [SORT_TAGS[cursor.sort], cursor.at, cursor.id];
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
  const { sort, cursor: rawCursor, limit } = parsed.data;
  let cursor: ListCursor | null = null;
  if (rawCursor !== undefined) {
    cursor = decodeCursor(rawCursor, sort);
    if (!cursor) throw validationError([{ field: 'cursor', message: QUERY_MESSAGES.cursor ?? '' }]);
  }
  return { sort, cursor, limit: limit === undefined ? LIMITS.pageSize : Number(limit) };
}

/** An id that is not a positive integer cannot exist, so it is answered like an unknown one. */
function parseRecipeId(raw: string): number {
  const id = /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(id)) throw new AppError('NOT_FOUND', 'Rezept nicht gefunden');
  return id;
}

/** Recipe list (F-26, F-29 cards, F-34), trash list and final deletion (F-08) — Kap. 7.4. */
export function recipeListRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/recipes', (c) => {
    const { sort, cursor, limit } = parseListQuery(c.req.query());
    const profile = c.get('profile');
    const page = listRecipes(deps.db, { sort, cursor, limit, profileId: profile?.id ?? null });
    const body: RecipeListResponse = {
      items: page.items,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      total: page.total,
    };
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
