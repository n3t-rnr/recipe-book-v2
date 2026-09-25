import { type Context, Hono } from 'hono';
import { TagInput, TagMergeInput } from '../../shared/schemas.ts';
import type { TagMergeResponse, TagResponse, TagsResponse } from '../../shared/types.ts';
import { toValidationDetails } from '../../shared/validation.ts';
import { AppError, isAppError } from '../errors.ts';
import { parseId, requireProfile } from '../middleware/profile.ts';
import { createTag, deleteTag, listTags, mergeTag, renameTag } from '../services/tags.ts';
import type { AppDeps, AppEnv } from '../types.ts';

/**
 * Tag endpoints (Kap. 7.6, F-17 to F-20). Reads need no profile; every write needs X-Profile-Id
 * (F-05) and X-Rezepte-Client (client guard). data_revision is bumped by the revision middleware.
 */

type Issue = Parameters<typeof toValidationDetails>[0][number];

/** The part of a zod schema this file needs (TagInput, TagMergeInput). */
interface SafeParser<T> {
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (err) {
    if (isAppError(err)) throw err;
    throw new AppError('VALIDATION', 'Ungültiges JSON');
  }
}

/** Parses the body with a shared schema (NF-28); unknown fields are stripped. */
async function parseBody<T>(c: Context<AppEnv>, schema: SafeParser<T>): Promise<T> {
  const result = schema.safeParse(await readJson(c));
  if (!result.success) {
    throw new AppError('VALIDATION', 'Eingaben prüfen', toValidationDetails(result.error.issues));
  }
  return result.data;
}

/** "abc", "007", 0 and ids beyond the safe range cannot name a tag: 404 like an unknown id. */
function tagId(c: Context<AppEnv>): number {
  const id = parseId(c.req.param('id'));
  if (id === null) throw new AppError('NOT_FOUND', 'Tag nicht gefunden');
  return id;
}

export function tagsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = deps;

  app.get('/tags', (c) => {
    const body: TagsResponse = listTags(db);
    return c.json(body);
  });

  app.post('/tags', async (c) => {
    requireProfile(c);
    const input = await parseBody(c, TagInput);
    const { tag, created } = createTag(db, input);
    const body: TagResponse = { tag };
    return c.json(body, created ? 201 : 200);
  });

  app.patch('/tags/:id', async (c) => {
    requireProfile(c);
    const id = tagId(c);
    const input = await parseBody(c, TagInput);
    const body: TagResponse = { tag: renameTag(db, id, input) };
    return c.json(body);
  });

  app.post('/tags/:id/merge', async (c) => {
    requireProfile(c);
    const id = tagId(c);
    const input = await parseBody(c, TagMergeInput);
    const body: TagMergeResponse = mergeTag(db, id, input.intoTagId);
    return c.json(body);
  });

  app.delete('/tags/:id', (c) => {
    requireProfile(c);
    deleteTag(db, tagId(c));
    return c.body(null, 204);
  });

  return app;
}
