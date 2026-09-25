// Which image variant each view loads (NF-06, client/src/lib/media.ts): cards offer s and m via srcset
// with sizes matching the list layout; the browser's pick satisfies "natural width ≥ displayed width ×
// min(DPR, 2)" on phones and iPads but never goes beyond 2× ("höchstens 2-fache Pixeldichte"), in the
// selection of Safari and Firefox as well as in Chromium's; lists never load l, and the detail loads m.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_SIZES, mediaSource, mediumWidth } from '../../client/src/lib/media.ts';
import { IMAGE_VARIANTS } from '../../shared/constants.ts';
import type { CardImage } from '../../shared/types.ts';

/** Card image of a photo: width/height are those of variant l (2048 px long edge for a 12 MP photo). */
function photo(width: number, height: number): CardImage {
  return {
    urls: { s: '/media/0123456789abcdef-s.webp', m: '/media/0123456789abcdef-m.webp' },
    width,
    height,
  };
}

const LANDSCAPE = photo(2048, 1536);
const PORTRAIT = photo(1536, 2048);
/** 16:9, m = 1200 × 675. */
const WIDE = photo(2048, 1152);

// ------------------------------------------------------------------ browser model

/** Evaluates a length of the forms used in sizes: "Npx", "Nvw", "calc(Nvw - Npx)". */
function length(value: string, viewport: number): number {
  const calc = /^calc\((\d+)vw\s*-\s*(\d+)px\)$/.exec(value);
  if (calc) return (viewport * Number(calc[1])) / 100 - Number(calc[2]);
  const px = /^(\d+)px$/.exec(value);
  if (px) return Number(px[1]);
  const vw = /^(\d+)vw$/.exec(value);
  if (vw) return (viewport * Number(vw[1])) / 100;
  throw new Error(`unsupported length ${value}`);
}

/** Evaluates one media feature of the forms used in sizes. */
function matches(feature: string, viewport: number, dpr: number): boolean {
  const m = /^\((min-width|max-width|min-resolution):\s*([\d.]+)(px|dppx)\)$/.exec(feature);
  if (!m) throw new Error(`unsupported media feature ${feature}`);
  const value = Number(m[2]);
  if (m[1] === 'min-width') return viewport >= value;
  if (m[1] === 'max-width') return viewport <= value;
  return dpr >= value;
}

/** The source size a browser takes from a sizes attribute: the first entry whose condition matches. */
function slotWidth(sizes: string, viewport: number, dpr = 1): number {
  for (const entry of sizes.split(/,\s*(?![^(]*\))/)) {
    const parts = /^((?:\([^)]*\)\s*(?:and\s+)?)*)(.+)$/.exec(entry.trim());
    const conditions = parts?.[1]?.match(/\([^)]*\)/g) ?? [];
    if (conditions.every((c) => matches(c, viewport, dpr))) return length(parts?.[2]?.trim() ?? '', viewport);
  }
  throw new Error('no size matched');
}

interface Candidate {
  url: string;
  width: number;
}

function candidates(srcset: string): Candidate[] {
  return srcset
    .split(',')
    .map((c) => {
      const [url = '', w = ''] = c.trim().split(/\s+/);
      return { url, width: Number(w.replace('w', '')) };
    })
    .sort((a, b) => a.width - b.width);
}

/** Safari and Firefox: the smallest candidate whose density covers the DPR, else the largest. */
function pickCovering(srcset: string, slot: number, dpr: number): Candidate {
  const list = candidates(srcset);
  const fit = list.find((c) => c.width / slot >= dpr) ?? list.at(-1);
  if (!fit) throw new Error('empty srcset');
  return fit;
}

/**
 * Chromium (SelectionLogic in html_srcset_parser.cc): between the last candidate below the DPR and the
 * first covering it, the covering one only when the DPR reaches the geometric mean of both densities.
 */
function pickChromium(srcset: string, slot: number, dpr: number): Candidate {
  const list = candidates(srcset);
  const density = (c: Candidate | undefined): number => (c?.width ?? 0) / slot;
  let i = 0;
  for (; i < list.length - 1; i++) {
    const next = density(list[i + 1]);
    if (next < dpr) continue;
    const current = density(list[i]);
    if ((dpr <= 1 && dpr > current) || dpr >= Math.sqrt(current * next)) i++;
    break;
  }
  const chosen = list[i];
  if (!chosen) throw new Error('empty srcset');
  return chosen;
}

/** What a browser loads for a card, following its sizes and srcset; a photo without srcset loads src. */
function load(image: CardImage, viewport: number, dpr: number, pick = pickCovering): Candidate {
  const source = mediaSource(image, 'card');
  if (!source.srcset) return { url: source.src, width: IMAGE_VARIANTS.s.width };
  return pick(source.srcset, slotWidth(CARD_SIZES, viewport, dpr), dpr);
}

/** Card width in the list layout (RecipeList: 20 px margins, two columns with a 16 px gap from 600 px). */
function cardWidth(viewport: number): number {
  return viewport < 600 ? viewport - 40 : (viewport - 40 - 16) / 2;
}

/** The variant 2× needs: the smallest offered one at least twice the card width, else the largest. */
function atTwice(image: CardImage, viewport: number): Candidate {
  const source = mediaSource(image, 'card');
  if (!source.srcset) return { url: source.src, width: IMAGE_VARIANTS.s.width };
  return pickCovering(source.srcset, cardWidth(viewport), 2);
}

const PHONES_AND_IPADS = [360, 375, 384, 390, 393, 400, 412, 430, 744, 768, 810, 820, 834];
const HIGH_DPRS = [2, 2.25, 2.625, 2.75, 2.8125, 3, 3.5, 4, 4.5];

// ------------------------------------------------------------------ tests

describe('mediaSource', () => {
  it('offers s (720 px) and m (1200 px) to cards, never l', () => {
    const source = mediaSource(LANDSCAPE, 'card');
    expect(source.src).toBe(LANDSCAPE.urls.s);
    expect(source.srcset).toBe('/media/0123456789abcdef-s.webp 720w, /media/0123456789abcdef-m.webp 1200w');
    expect(source.srcset).not.toContain('-l.webp');
  });

  it('describes m of a portrait photo with its real width (900 px)', () => {
    expect(mediaSource(PORTRAIT, 'card').srcset).toContain('-m.webp 900w');
  });

  it('gives the detail m only (F-29: the full-screen view loads l)', () => {
    expect(mediaSource({ ...LANDSCAPE, urls: { ...LANDSCAPE.urls } }, 'detail')).toEqual({
      src: LANDSCAPE.urls.m,
    });
    expect(mediaSource(photo(1152, 2048), 'detail')).toEqual({ src: LANDSCAPE.urls.m });
  });

  it('computes the width of m from l without upscaling small photos', () => {
    expect(mediumWidth({ width: 2048, height: 1536 })).toBe(1200);
    expect(mediumWidth({ width: 1536, height: 2048 })).toBe(900);
    expect(mediumWidth({ width: 800, height: 600 })).toBe(800);
    expect(mediumWidth({ width: 1152, height: 2048 })).toBe(675);
    expect(mediumWidth({ width: 0, height: 0 })).toBe(0);
    expect(IMAGE_VARIANTS.m.longEdge).toBe(1200);
  });

  it('offers only s when m is narrower than s: tall photos below 0.6:1 (m would be the bigger file)', () => {
    // 9:16 → m 675 × 1200: in a srcset as "675w" the browser would take it for the smaller variant.
    expect(mediaSource(photo(1152, 2048), 'card')).toEqual({ src: LANDSCAPE.urls.s });
    // Exactly 0.6:1 → m 720 × 1200, no wider than s.
    expect(mediaSource(photo(1200, 2000), 'card')).toEqual({ src: LANDSCAPE.urls.s });
    // Slightly wider → m 732 px: offered.
    expect(mediaSource(photo(1250, 2048), 'card').srcset).toContain('-m.webp 732w');
  });

  it('offers only s when m is lower than s: panoramas wider than 2.5:1 fill the 3:2 card with fewer pixels', () => {
    // 3:1 → m 1200 × 400; in the 3:2 card only 600 × 400 of it show, s has 720 × 480.
    expect(mediaSource(photo(2048, 683), 'card')).toEqual({ src: LANDSCAPE.urls.s });
    // 2:1 → m 1200 × 600, covers s in both directions.
    expect(mediaSource(photo(2048, 1024), 'card').srcset).toContain('-m.webp 1200w');
  });

  it('never offers a degenerate m (0 × 0)', () => {
    expect(mediaSource(photo(0, 0), 'card')).toEqual({ src: LANDSCAPE.urls.s });
  });

  it('loads s for tall photos at any density, also where a srcset "675w" would have picked m', () => {
    const tall = photo(1152, 2048);
    for (const viewport of PHONES_AND_IPADS) {
      for (const dpr of [1, 2, 3]) expect(load(tall, viewport, dpr).url).toBe(tall.urls.s);
    }
  });
});

describe('card sizes match the list layout (NF-06)', () => {
  it('equals the rendered card width from 320 to 1023 px below 2 dppx', () => {
    for (let viewport = 320; viewport < 1024; viewport++) {
      for (const dpr of [1, 1.5, 1.75]) {
        expect(slotWidth(CARD_SIZES, viewport, dpr)).toBeCloseTo(cardWidth(viewport), 6);
      }
    }
  });

  it('lets the browser pick a variant at least as wide as displayed × min(DPR, 2), never l', () => {
    // Phones (1 column) and iPads in portrait (2 columns), the devices of the NF-06 AK.
    for (const image of [LANDSCAPE, PORTRAIT, WIDE]) {
      for (const viewport of PHONES_AND_IPADS) {
        for (const dpr of [1, 1.5, ...HIGH_DPRS]) {
          const chosen = load(image, viewport, dpr);
          expect(chosen.url).not.toContain('-l.webp');
          expect(
            chosen.width,
            `${image.width}×${image.height} at ${viewport} px, DPR ${dpr}`,
          ).toBeGreaterThanOrEqual(cardWidth(viewport) * Math.min(dpr, 2));
        }
      }
    }
  });

  it('holds the AK in Chromium from 2 dppx, although it may pick below the DPR (geometric mean)', () => {
    for (const image of [LANDSCAPE, PORTRAIT, WIDE]) {
      for (const viewport of PHONES_AND_IPADS) {
        for (const dpr of HIGH_DPRS) {
          const chosen = load(image, viewport, dpr, pickChromium);
          expect(
            chosen.width,
            `${image.width}×${image.height} at ${viewport} px, DPR ${dpr}`,
          ).toBeGreaterThanOrEqual(cardWidth(viewport) * 2);
        }
      }
    }
  });

  it('never loads more than 2× from 2 dppx: the variant of DPR 2 at any higher density, in every engine', () => {
    for (const image of [LANDSCAPE, PORTRAIT, WIDE]) {
      for (let viewport = 320; viewport < 1024; viewport++) {
        const expected = atTwice(image, viewport);
        for (const dpr of HIGH_DPRS) {
          const where = `${image.width}×${image.height} at ${viewport} px, DPR ${dpr}`;
          expect(load(image, viewport, dpr).url, where).toBe(expected.url);
          expect(load(image, viewport, dpr, pickChromium).url, where).toBe(expected.url);
        }
      }
    }
  });

  it('loads s on DPR-3 and DPR-2.625 phones whose cards s covers twice, m only where it must', () => {
    const { s, m } = LANDSCAPE.urls;
    for (const pick of [pickCovering, pickChromium]) {
      // iPhone 12–16 (390/393 px, DPR 3), Galaxy S (360/384 px, DPR 3/2.8125), Pixel 5 (393 px, DPR 2.75).
      expect(load(LANDSCAPE, 390, 3, pick).url).toBe(s);
      expect(load(LANDSCAPE, 393, 3, pick).url).toBe(s);
      expect(load(LANDSCAPE, 360, 3, pick).url).toBe(s);
      expect(load(LANDSCAPE, 384, 2.8125, pick).url).toBe(s);
      expect(load(LANDSCAPE, 393, 2.75, pick).url).toBe(s);
      expect(load(LANDSCAPE, 393, 2.625, pick).url).toBe(s);
      expect(load(LANDSCAPE, 400, 3, pick).url).toBe(s);
      // Cards wider than 360 px need more than s at 2×: Pixel 7 (412 px, DPR 2.625), iPhone Pro Max.
      expect(load(LANDSCAPE, 412, 2.625, pick).url).toBe(m);
      expect(load(LANDSCAPE, 401, 3, pick).url).toBe(m);
      expect(load(LANDSCAPE, 430, 3, pick).url).toBe(m);
      // Two columns: phones in landscape and tablets.
      expect(load(LANDSCAPE, 776, 3, pick).url).toBe(s);
      expect(load(LANDSCAPE, 844, 3, pick).url).toBe(m);
      expect(load(LANDSCAPE, 768, 2, pick).url).toBe(s);
    }
  });

  it('loads s for small cards, compact rows (112 px) included', () => {
    const srcset = mediaSource(LANDSCAPE, 'card').srcset ?? '';
    expect(pickCovering(srcset, slotWidth(CARD_SIZES, 360), 2).width).toBe(IMAGE_VARIANTS.s.width);
    expect(pickCovering(srcset, slotWidth('112px', 1024), 3).width).toBe(IMAGE_VARIANTS.s.width);
    expect(pickChromium(srcset, slotWidth('112px', 1024), 3).width).toBe(IMAGE_VARIANTS.s.width);
  });
});

describe('list cards use CARD_SIZES', () => {
  it('RecipeCard passes its optional sizes through instead of a default of its own', () => {
    // A literal default in RecipeCard used to override CARD_SIZES, so the 2× cap never reached the list.
    const card = fs.readFileSync(
      new URL('../../client/src/components/RecipeCard.svelte', import.meta.url),
      'utf8',
    );
    expect(card).not.toMatch(/sizes\s*=\s*['"`]/);
    expect(card).toMatch(/<RecipeMedia\b[^>]*\{sizes\}/);
    const media = fs.readFileSync(
      new URL('../../client/src/components/RecipeMedia.svelte', import.meta.url),
      'utf8',
    );
    expect(media).toMatch(/sizes = CARD_SIZES,/);
  });
});
