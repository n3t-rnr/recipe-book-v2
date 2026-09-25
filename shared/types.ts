/** API response types (Kap. 7.3–7.4). Server builds them, the client consumes them. */
import type { AvatarToken } from './schemas.ts';

export interface PersonRef {
  id: number;
  name: string;
}

export interface Profile {
  id: number;
  name: string;
  avatar: AvatarToken;
  /** "A", or two letters when initials collide ("An", "Ad") — F-03. Computed over all profiles. */
  initials: string;
  ratingCount: number;
  favoriteCount: number;
}

export interface ProfilesResponse {
  profiles: Profile[];
}

export interface TagRef {
  id: number;
  name: string;
}

/** A tag with its usage count (GET /tags, F-19, F-20). */
export interface TagCount extends TagRef {
  /** active recipes using the tag (trash excluded) */
  count: number;
}

/** GET /tags: ordered by count descending, then name key, name and id; unused tags come last. */
export interface TagsResponse {
  tags: TagCount[];
  /** meta.data_revision, equals X-Data-Revision */
  revision: number;
}

/** POST /tags (201 new, 200 existing key) and PATCH /tags/:id. */
export interface TagResponse {
  tag: TagCount;
}

/** POST /tags/:id/merge. */
export interface TagMergeResponse {
  tag: TagCount;
  /** active recipes that carried the source tag */
  movedRecipes: number;
}

/** details of 409 TAG_EXISTS on PATCH /tags/:id (F-19): the tag that already has the new name. */
export interface TagExistsDetails {
  targetId: number;
  targetName: string;
  /** active recipes of the renamed tag */
  affectedRecipes: number;
}

/** Image URLs point to /media/<fileKey>-<variant>.webp (M3). */
export interface CardImage {
  urls: { s: string; m: string };
  width: number;
  height: number;
}

export interface DetailImage {
  id: number;
  urls: { s: string; m: string; l: string };
  width: number;
  height: number;
}

export interface RecipeCard {
  id: number;
  title: string;
  image: CardImage | null;
  /** At most 3 tags, ordered by name key; the rest is counted in moreTags. */
  tags: TagRef[];
  moreTags: number;
  ratingAvg: number | null;
  ratingCount: number;
  /** null without X-Profile-Id. */
  myRating: number | null;
  /** null without X-Profile-Id. */
  isFavorite: boolean | null;
  /** prep + cook minutes, null when both are unset. */
  totalMinutes: number | null;
  updatedAt: string;
}

export type RecipeSort = 'relevance' | 'newest' | 'updated' | 'title' | 'rating' | 'myRating';

export interface RecipeListResponse {
  items: RecipeCard[];
  nextCursor: string | null;
  total: number;
  /** Omitted when there is no suggestion, never sent as undefined. */
  didYouMean?: string;
}

/** GET /recipes from M4 on; RecipeListResponse stays unchanged as the base type. */
export interface RecipeListPage extends RecipeListResponse {
  /** all active recipes, for '14 von 38 Rezepten' */
  totalAll: number;
}

export interface IngredientDetail {
  id: number;
  group: string;
  amount: number | null;
  amountMax: number | null;
  unit: string;
  name: string;
  note: string;
}

export interface StepDetail {
  id: number;
  text: string;
}

export interface RatingSummary {
  avg: number | null;
  count: number;
  mine: number | null;
  byProfile: Array<{ profileId: number; name: string; stars: number }>;
}

export interface RecipeDetail {
  id: number;
  title: string;
  description: string;
  servings: number | null;
  servingsUnit: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  source: string;
  ingredients: IngredientDetail[];
  steps: StepDetail[];
  tags: TagRef[];
  image: DetailImage | null;
  rating: RatingSummary;
  isFavorite: boolean | null;
  createdBy: PersonRef | null;
  updatedBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RecipeResponse {
  recipe: RecipeDetail;
}

/** details of 410 IN_TRASH (Kap. 7.2). */
export interface InTrashDetails {
  deletedAt: string;
  deletedBy: PersonRef | null;
}

/** details of 409 VERSION_CONFLICT (F-07). */
export interface VersionConflictDetails {
  current: RecipeDetail;
}

export interface TrashItem {
  id: number;
  title: string;
  deletedAt: string;
  deletedBy: PersonRef | null;
  /** deletedAt + TRASH_DAYS */
  purgeAt: string;
}

export interface TrashResponse {
  items: TrashItem[];
}

/** 201 answer of POST /images (Kap. 7.5): the image exists but is not assigned to a recipe yet. */
export interface ImageUploadResponse {
  imageId: number;
  urls: { s: string; m: string; l: string };
  width: number;
  height: number;
}

/** GET /images/:id (Kap. 7.5): lets the editor check a draft's image before restoring it (F-09). */
export interface ImageInfo extends ImageUploadResponse {
  assigned: boolean;
}
