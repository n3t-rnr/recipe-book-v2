import { type Context, Hono } from 'hono';
import { RecipeCreateInput, RecipeUpdateInput } from '../../shared/schemas.ts';
import type { RecipeResponse } from '../../shared/types.ts';
import { toValidationDetails } from '../../shared/validation.ts';
import { AppError, isAppError } from '../errors.ts';
import { requireProfile } from '../middleware/profile.ts';
import { createRecipe, getRecipe, restoreRecipe, trashRecipe, updateRecipe } from '../services/recipes.ts';
import type { AppDeps, AppEnv } from '../types.ts';

/**
 * Recipe core endpoints (Kap. 7.4). The list, /trash and /recipes/similar live elsewhere; the
 * numeric id matcher keeps /recipes/similar free for M5.
 */

type Issue = Parameters<typeof toValidationDetails>[0][number];

/** The part of a zod schema this file needs (RecipeCreateInput, RecipeUpdateInput). */
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

/** Parses the body with a shared schema (NF-28); unknown fields such as profileId are stripped (F-05). */
async function parseBody<T>(c: Context<AppEnv>, schema: SafeParser<T>): Promise<T> {
  const result = schema.safeParse(await readJson(c));
  if (!result.success) {
    throw new AppError('VALIDATION', 'Eingaben prüfen', toValidationDetails(result.error.issues));
  }
  return result.data;
}

/** The route matcher only lets digits through; ids beyond the safe range cannot exist. */
function recipeId(c: Context<AppEnv>): number {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError('NOT_FOUND', 'Rezept nicht gefunden');
  return id;
}

export function recipesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/recipes', async (c) => {
    const profile = requireProfile(c);
    const input = await parseBody(c, RecipeCreateInput);
    const { recipe, created } = createRecipe(deps, input, profile);
    const body: RecipeResponse = { recipe };
    return c.json(body, created ? 201 : 200);
  });

  app.get('/recipes/:id{[0-9]+}', (c) => {
    const body: RecipeResponse = { recipe: getRecipe(deps, recipeId(c), c.get('profile')) };
    return c.json(body);
  });

  app.put('/recipes/:id{[0-9]+}', async (c) => {
    const profile = requireProfile(c);
    const id = recipeId(c);
    const input = await parseBody(c, RecipeUpdateInput);
    const force = c.req.query('force') === '1';
    const body: RecipeResponse = { recipe: updateRecipe(deps, id, input, profile, { force }) };
    return c.json(body);
  });

  app.delete('/recipes/:id{[0-9]+}', (c) => {
    const profile = requireProfile(c);
    trashRecipe(deps, recipeId(c), profile);
    return c.body(null, 204);
  });

  app.post('/recipes/:id{[0-9]+}/restore', (c) => {
    const profile = requireProfile(c);
    const body: RecipeResponse = { recipe: restoreRecipe(deps, recipeId(c), profile) };
    return c.json(body);
  });

  return app;
}
