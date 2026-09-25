/**
 * Which image variant a view loads (NF-06), as pure functions for the unit tests. Lists offer s and m
 * through srcset, and the browser picks by rendered width × pixel density, at most 2× (CARD_SIZES); the
 * detail loads m, only the full-screen view loads l (F-29). Kept tiny: RecipeMedia and with it this
 * module are in the entry chunk.
 */
import { IMAGE_VARIANTS } from '../../../shared/constants.ts';
import type { CardImage } from '../../../shared/types.ts';

/**
 * sizes of the list cards (RecipeList): one column below 600 px with 20 px page margins, two columns with
 * a 16 px gap up to 1023 px; from 1024 px the list shows compact rows (112 px images) instead.
 * Below 2 dppx the entries give the card width. From 2 dppx, where NF-06 caps the density at 2×, they
 * pick the variant: the browser would multiply the card width by the full density (DPR-3 phones load m
 * where s covers 2×), and Chromium picks between two candidates by their geometric mean (s below 2× for
 * cards up to 464 px). 1px lets s cover any density: cards up to 360 px, half the width of s (viewport
 * up to 400 px, or 600–776 px with two columns); 720px, the width of s, leaves no candidate covering
 * 2 dppx, so the largest, m, wins. Browsers without the resolution feature skip those entries.
 */
export const CARD_SIZES =
  '(max-width: 400px) and (min-resolution: 2dppx) 1px, (min-width: 600px) and (max-width: 776px) and (min-resolution: 2dppx) 1px, (min-resolution: 2dppx) 720px, (min-width: 600px) calc(50vw - 28px), calc(100vw - 40px)';

/** Width of variant m: the long edge of l (width/height) scaled to 1200 px, never upscaled (F-15). */
export function mediumWidth(img: { width: number; height: number }): number {
  return Math.round(img.width * Math.min(1, IMAGE_VARIANTS.m.longEdge / Math.max(img.width, img.height)));
}

/**
 * src and srcset of a recipe photo: the detail loads m alone; cards s (720 × 480, cropped to 3:2) and m
 * (never l), m only when it covers s in both directions: not for a photo narrower than 0.6:1 (m below
 * 720 px wide) nor a panorama wider than 2.5:1 (m below 480 px high), where m would be the larger file
 * with fewer pixels in the 3:2 card.
 */
export function mediaSource(image: CardImage, use: 'card' | 'detail'): { src: string; srcset?: string } {
  const { s, m } = image.urls;
  const w = mediumWidth(image);
  return use === 'card' &&
    w > IMAGE_VARIANTS.s.width &&
    w * image.height > IMAGE_VARIANTS.s.height * image.width
    ? { src: s, srcset: `${s} ${IMAGE_VARIANTS.s.width}w, ${m} ${w}w` }
    : { src: use === 'card' ? s : m };
}
