/**
 * Input schemas shared by server validation and the editor (NF-28): one source for rules and types.
 * zod/mini keeps the client chunk small; only the editor chunk imports this file.
 */
import * as z from 'zod/mini';
import { LIMITS } from './constants.ts';

// Control characters except tab/newline are never allowed in text fields.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the regex exists to reject control characters
const NO_CONTROL = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;
// Single-line fields additionally reject line breaks.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the regex exists to reject control characters
const SINGLE_LINE = /^[^\u0000-\u001F\u007F]*$/;

const line = (min: number, max: number) =>
  z.string().check(z.trim(), z.minLength(min), z.maxLength(max), z.regex(SINGLE_LINE));
const text = (max: number) => z.string().check(z.trim(), z.maxLength(max), z.regex(NO_CONTROL));
const minutes = z.nullable(z.int().check(z.gte(LIMITS.minutesMin), z.lte(LIMITS.minutesMax)));

export const AVATARS = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'] as const;
export type AvatarToken = (typeof AVATARS)[number];

export const ProfileInput = z.object({
  name: line(1, LIMITS.profileName),
  avatar: z.optional(z.enum(AVATARS)),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ProfilePatch = z.object({
  name: z.optional(line(1, LIMITS.profileName)),
  avatar: z.optional(z.enum(AVATARS)),
});
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export const IngredientInput = z
  .object({
    group: z._default(line(0, LIMITS.groupName), ''),
    amount: z._default(z.nullable(z.number().check(z.gte(0), z.lte(1_000_000))), null),
    amountMax: z._default(z.nullable(z.number().check(z.gte(0), z.lte(1_000_000))), null),
    unit: z._default(line(0, LIMITS.unit), ''),
    name: line(1, LIMITS.ingredientName),
    note: z._default(line(0, LIMITS.ingredientNote), ''),
  })
  .check(
    z.refine((v) => v.amountMax === null || (v.amount !== null && v.amountMax > v.amount), {
      message: 'Die Obergrenze muss größer als die Menge sein',
      path: ['amountMax'],
    }),
  );
export type IngredientInput = z.infer<typeof IngredientInput>;

export const StepInput = z.object({
  text: z.string().check(z.trim(), z.minLength(1), z.maxLength(LIMITS.stepText), z.regex(NO_CONTROL)),
});
export type StepInput = z.infer<typeof StepInput>;

const recipeFields = {
  title: line(1, LIMITS.recipeTitle),
  description: z._default(text(LIMITS.description), ''),
  servings: z._default(
    z.nullable(z.number().check(z.gte(LIMITS.servingsMin), z.lte(LIMITS.servingsMax))),
    null,
  ),
  servingsUnit: z._default(line(0, 20), 'Portionen'),
  prepMinutes: z._default(minutes, null),
  cookMinutes: z._default(minutes, null),
  source: z._default(line(0, LIMITS.source), ''),
  ingredients: z._default(z.array(IngredientInput).check(z.maxLength(LIMITS.ingredients)), []),
  steps: z._default(z.array(StepInput).check(z.maxLength(LIMITS.steps)), []),
  tags: z._default(z.array(line(1, LIMITS.tagName)).check(z.maxLength(LIMITS.tagsPerRecipe)), []),
  /** null removes the image; omitted on PUT keeps nothing special — PUT replaces the recipe completely. */
  imageId: z._default(z.nullable(z.int().check(z.gte(1))), null),
};

/** POST /recipes (Kap. 7.4): createKey makes double submits idempotent (NF-09). */
export const RecipeCreateInput = z.object({
  ...recipeFields,
  createKey: z.string().check(z.trim(), z.minLength(8), z.maxLength(64), z.regex(/^[A-Za-z0-9_-]+$/)),
});
export type RecipeCreateInput = z.infer<typeof RecipeCreateInput>;

/** PUT /recipes/:id (Kap. 7.4): full replacement guarded by the server-side version (F-07). */
export const RecipeUpdateInput = z.object({
  ...recipeFields,
  version: z.int().check(z.gte(1)),
});
export type RecipeUpdateInput = z.infer<typeof RecipeUpdateInput>;

/** The editable part shared by create and update (used by the editor form). */
export type RecipeFields = Omit<RecipeCreateInput, 'createKey'>;

/** POST /tags and PATCH /tags/:id (Kap. 7.6): the same name rules as a recipe's tags (F-17). */
export const TagInput = z.object({ name: line(1, LIMITS.tagName) });
export type TagInput = z.infer<typeof TagInput>;

/** POST /tags/:id/merge (Kap. 7.6, F-19). */
export const TagMergeInput = z.object({ intoTagId: z.int().check(z.gte(1)) });
export type TagMergeInput = z.infer<typeof TagMergeInput>;
