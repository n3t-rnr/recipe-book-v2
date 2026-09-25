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
  /** Characters of the search text in GET /recipes?q= (search strategy: Kap. 4.5). */
  query: 200,
  /** Tag ids per list filter in GET /recipes?tags= (F-24). */
  filterTags: 20,
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

/**
 * Decode limits of the image pipeline (NF-05: ≤ 250 MB RSS while images are processed, also with
 * two uploads at once; server only, the client does not import this). Most uploads are decoded in
 * strips: baseline JPEG with shrink-on-load, non-interlaced PNG, lossy WebP. Their peak hardly
 * grows with the pixel count. Some layouts need the whole image in memory first: progressive JPEG
 * (DCT coefficients, 2 bytes per sample), interlaced PNG (all passes) and lossless WebP (4 bytes per
 * pixel); services/images.ts prices them from the header (decodePlan).
 *
 * Chosen by measurement with the real server and scripts/measure-images.ts (dev PC, 2026-09-24;
 * idle 86–101 MB, RSS drifts up by up to 45 MB over repeated jobs): one job at maxWholeImageBytes
 * starts at ~180 MB and stays ≤ 230 MB (progressive 4:4:4 10 MP; 12 MP reached 240 MB, 16 MP 237 MB
 * on the first job, 60 MP 456 MB). Two jobs below the exclusive thresholds stay ≤ 212 MB (two 8-MP
 * RGBA PNGs; two 16-MP ones reached 253 MB, two 60-MP ones 288 MB).
 */
export const IMAGE_DECODE = {
  /** Whole-image buffer above which an upload is refused with 413 (progressive 4:4:4 JPEG: 10 MP). */
  maxWholeImageBytes: 60_000_000,
  /** Whole-image buffer above which a job takes both queue slots and runs alone. */
  exclusiveWholeImageBytes: 32_000_000,
  /** PNG and WebP above this pixel count run alone, 16-bit PNG always. */
  exclusivePixels: 8_000_000,
} as const;

export const API_BASE = '/api/v1';
export const CLIENT_HEADER = 'X-Rezepte-Client';
export const PROFILE_HEADER = 'X-Profile-Id';
