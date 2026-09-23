/** Limits shared by client validation, server validation and tests (Kap. 12, A18). */
export const LIMITS = {
  profileName: 40,
  recipeTitle: 120,
  description: 2000,
  source: 500,
  tagName: 40,
  tagsPerRecipe: 20,
  ingredients: 200,
  ingredientName: 120,
  ingredientNote: 200,
  unit: 20,
  groupName: 60,
  steps: 100,
  stepText: 4000,
  servingsMin: 0.25,
  servingsMax: 100,
  minutesMin: 1,
  minutesMax: 1440,
  /** JSON body limit (Kap. 7.1). */
  jsonBodyBytes: 1_048_576,
  /** Upload limit 20 MiB (F-14). */
  uploadBytes: 20_971_520,
  /** Pixel limit 60 MP (F-15). */
  uploadMaxPixels: 60_000_000,
  pageSize: 40,
  pageSizeMax: 100,
} as const;

/**
 * Image variants (F-15), fixed by the approved design (M1, token sheet):
 * card image 3:2, 350×233 on phones → s = 720×480 (≥ 2× card width).
 */
export const IMAGE_VARIANTS = {
  s: { width: 720, height: 480, quality: 72 },
  m: { longEdge: 1200, quality: 78 },
  l: { longEdge: 2048, quality: 80 },
} as const;

export const API_BASE = '/api/v1';
export const CLIENT_HEADER = 'X-Rezepte-Client';
export const PROFILE_HEADER = 'X-Profile-Id';
