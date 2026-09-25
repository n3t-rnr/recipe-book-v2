// Helpers of tests/e2e/layout-theme.spec.ts: color math (WCAG), DOM scans for light surfaces, text
// contrast, horizontal overflow and tap target sizes, and screenshots with pixel statistics (sharp).
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

export type Rgb = readonly [number, number, number];

/** Palette values of tokens.css (NF-12) that the tests compare against. */
export const COLORS = {
  linen: [239, 230, 221],
  raisin: [35, 31, 32],
  surfaceDark: [47, 43, 44],
  surfaceRaisedDark: [55, 51, 52],
  moonstone: [126, 189, 194],
  vanilla: [243, 223, 162],
  placeholder3: [232, 183, 169],
  placeholder4: [220, 207, 194],
} as const satisfies Record<string, Rgb>;

/** --placeholder-(id mod 4 + 1) (F-16). */
export function placeholderColor(recipeId: number): Rgb {
  const colors = [COLORS.vanilla, COLORS.moonstone, COLORS.placeholder3, COLORS.placeholder4] as const;
  return colors[Math.abs(recipeId) % 4] ?? COLORS.vanilla;
}

/** WCAG 2 relative luminance of an sRGB color. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** "rgb(35, 31, 32)" / "rgba(…)" → [r, g, b]; null for anything else or a transparent color. */
export function parseRgb(css: string | null): Rgb | null {
  const match = css?.match(/rgba?\(([^)]+)\)/);
  if (!match?.[1]) return null;
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((p) => Number.parseFloat(p));
  if (parts.length < 3 || (parts[3] ?? 1) === 0) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function sameColor(a: Rgb | null, b: Rgb, tolerance = 2): boolean {
  if (a === null) return false;
  return a.every((c, i) => Math.abs(c - (b[i] ?? 0)) <= tolerance);
}

// ---------------------------------------------------------------------------------------------------
// In-page scans. Each function passed to page.evaluate must be self-contained (it runs in the browser).
// ---------------------------------------------------------------------------------------------------

export interface Surface {
  /** Tag, classes (without Svelte hashes) and label or text of the element. */
  what: string;
  /** Background color. */
  color: string;
  /** Text color of the element (computed `color`), to tell chips with dark text from other surfaces. */
  text: string;
  luminance: number;
}

export interface ScanOptions {
  /** Scan the whole document instead of the viewport only (long pages such as the editor on a phone). */
  wholePage?: boolean;
}

/** Every visible element (and ::before/::after) whose own background is light (luminance ≥ 0.4). */
export function lightSurfaces(page: Page, options: ScanOptions = {}): Promise<Surface[]> {
  return page.evaluate(
    ({ min, wholePage }) => {
      const lum = (r: number, g: number, b: number): number => {
        const lin = (c: number): number => {
          const s = c / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const parse = (css: string): number[] | null => {
        const m = css.match(/rgba?\(([^)]+)\)/);
        if (!m?.[1]) return null;
        const p = m[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map((x) => Number.parseFloat(x));
        return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
      };
      const describe = (el: Element, pseudo: string): string => {
        const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).join('.');
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${pseudo}${label ? ` "${label}"` : ''}`;
      };
      const found: { what: string; color: string; text: string; luminance: number }[] = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!(el instanceof HTMLElement)) continue;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const outside =
          rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth;
        if (outside && !wholePage) continue;
        for (const pseudo of ['', '::before', '::after']) {
          const style = getComputedStyle(el, pseudo || null);
          if (pseudo && (style.content === 'none' || style.content === 'normal')) continue;
          const color = parse(style.backgroundColor);
          if (!color || (color[3] ?? 1) < 0.5) continue;
          const l = lum(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0);
          if (l >= min) {
            found.push({
              what: describe(el, pseudo),
              color: style.backgroundColor,
              text: style.color,
              luminance: l,
            });
          }
        }
      }
      return found;
    },
    { min: 0.4, wholePage: options.wholePage ?? false },
  );
}

export interface TextContrast {
  what: string;
  color: string;
  background: string;
  ratio: number;
  required: number;
}

/**
 * Text contrast of every visible element with its own text, and of the value or (when empty) the
 * placeholder of every text field: text color against the backgrounds of the element and its
 * ancestors, composited from the page background up. Text on photos (background images, <img>) is
 * skipped; disabled controls are exempt (WCAG 1.4.3).
 */
export function lowContrastTexts(page: Page, options: ScanOptions = {}): Promise<TextContrast[]> {
  return page.evaluate((wholePage) => {
    const lum = (c: number[]): number => {
      const lin = (v: number): number => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
    };
    const parse = (css: string): number[] | null => {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m?.[1]) return null;
      const p = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map((x) => Number.parseFloat(x));
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    const over = (top: number[], below: number[]): number[] => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (below[i] ?? 0) * (1 - a)).concat(1);
    };
    const hasPhotoBehind = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (getComputedStyle(node).backgroundImage !== 'none') return true;
        if (node.parentElement?.querySelector(':scope > img, :scope > picture')) return true;
      }
      return false;
    };
    const rootBg = parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    const background = (el: Element): number[] => {
      const chain: number[][] = [];
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && (c[3] ?? 1) > 0) chain.push(c);
        if (c && (c[3] ?? 1) >= 1) break;
      }
      return chain.reverse().reduce((acc, c) => over(c, acc), rootBg);
    };
    const found: {
      what: string;
      color: string;
      background: string;
      ratio: number;
      required: number;
    }[] = [];
    const textTypes = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);
    for (const el of document.querySelectorAll('body *')) {
      if (!(el instanceof HTMLElement) || el.closest('[disabled], [aria-disabled="true"]')) continue;
      const style = getComputedStyle(el);
      let ownText = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      let textColor = style.color;
      const field =
        el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && textTypes.has(el.type));
      if (field) {
        // What the field shows: its value, or else the placeholder in the ::placeholder color.
        ownText = el.value.trim() || el.placeholder.trim();
        if (el.value.trim() === '') textColor = getComputedStyle(el, '::placeholder').color;
      }
      if (ownText === '') continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) continue;
      const outside =
        rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth;
      if (outside && !wholePage) continue;
      if (hasPhotoBehind(el)) continue;
      const fg = parse(textColor);
      if (!fg) continue;
      const bg = background(el);
      const text = over(fg, bg);
      const ratio = (Math.max(lum(text), lum(bg)) + 0.05) / (Math.min(lum(text), lum(bg)) + 0.05);
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const required = large ? 3 : 4.5;
      if (ratio + 0.005 < required) {
        const label = field ? `[${el.getAttribute('aria-label') ?? el.name}]` : '';
        found.push({
          what: `${el.tagName.toLowerCase()}${label} "${ownText.slice(0, 40)}"`,
          color: textColor,
          background: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`,
          ratio: Math.round(ratio * 100) / 100,
          required,
        });
      }
    }
    return found;
  }, options.wholePage ?? false);
}

export interface SkeletonTones {
  /** Visible skeleton blocks (translucent surfaces inside an aria-busy container). */
  blocks: number;
  /** Blocks that do not stand out from their background (contrast < 1.1): invisible skeletons. */
  faint: string[];
  /** Blocks that end up light (luminance ≥ 0.4). */
  light: string[];
}

/**
 * The skeleton blocks of every visible aria-busy container, composited over what lies behind them. In
 * dark mode they need their own dark tone (Kap. 6.5): lighter than their background, but not light.
 */
export function skeletonTones(page: Page): Promise<SkeletonTones> {
  return page.evaluate(() => {
    const lum = (c: number[]): number => {
      const lin = (v: number): number => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
    };
    const parse = (css: string): number[] | null => {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m?.[1]) return null;
      const p = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map((x) => Number.parseFloat(x));
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    const over = (top: number[], below: number[]): number[] => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (below[i] ?? 0) * (1 - a)).concat(1);
    };
    const backdrop = (el: Element | null): number[] => {
      const chain: number[][] = [];
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && (c[3] ?? 1) > 0) chain.push(c);
        if (c && (c[3] ?? 1) >= 1) break;
      }
      return chain.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]);
    };
    const result = { blocks: 0, faint: [] as string[], light: [] as string[] };
    for (const el of document.querySelectorAll('[aria-busy="true"] *')) {
      if (!(el instanceof HTMLElement) || !el.checkVisibility({ visibilityProperty: true })) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const own = parse(getComputedStyle(el).backgroundColor);
      if (!own || (own[3] ?? 1) === 0 || (own[3] ?? 1) >= 1) continue;
      result.blocks += 1;
      const behind = backdrop(el.parentElement);
      const block = over(own, behind);
      const [hi, lo] = [lum(block), lum(behind)].sort((a, b) => b - a) as [number, number];
      const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).join('.');
      const what = `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} rgb(${block.slice(0, 3).map(Math.round).join(', ')})`;
      if ((hi + 0.05) / (lo + 0.05) < 1.1) result.faint.push(what);
      if (lum(block) >= 0.4) result.light.push(what);
    }
    return result;
  });
}

// ---------------------------------------------------------------------------------------------------
// Startup recorder (NF-14): what the page shows in every animation frame while the app starts.
// ---------------------------------------------------------------------------------------------------

export interface StartupRecord {
  /** Animation frames sampled so far. */
  frames: number;
  /** State at the first animation frame (the browser runs it right before painting). */
  first: { body: string | null; theme: string | null; appChildren: number } | null;
  /** State at the moment the app inserted its first element. */
  mount: { body: string | null; theme: string | null } | null;
  /** Light surfaces seen at any sample point in any frame (first occurrence each). */
  light: (Surface & { frame: number })[];
}

/**
 * Installs, before any page script of every following navigation, a recorder that samples a 7 × 12 grid
 * of the viewport in every animation frame: the surface under each point is the first element from the
 * hit element up that has an opaque background (the page canvas if none). Light ones are kept.
 */
export async function recordStartup(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: {
      frames: number;
      first: unknown;
      mount: unknown;
      light: Record<string, unknown>;
      stopped: boolean;
    } = { frames: 0, first: null, mount: null, light: {}, stopped: false };
    (window as unknown as { __startup?: typeof record }).__startup = record;
    const lum = (c: number[]): number => {
      const lin = (v: number): number => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
    };
    const parse = (css: string): number[] | null => {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m?.[1]) return null;
      const p = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map((x) => Number.parseFloat(x));
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    const describe = (el: Element): string => {
      const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).join('.');
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${label ? ` "${label}"` : ''}`;
    };
    const bodyBg = (): string | null =>
      document.body ? getComputedStyle(document.body).backgroundColor : null;
    const theme = (): string | null => document.documentElement.dataset.theme ?? null;
    const sample = (): void => {
      for (let col = 0; col < 7; col++) {
        for (let row = 0; row < 12; row++) {
          const hit = document.elementFromPoint(
            ((col + 0.5) * innerWidth) / 7,
            ((row + 0.5) * innerHeight) / 12,
          );
          let surface: { what: string; color: string; text: string; luminance: number } | null = null;
          for (let node = hit; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            const c = parse(style.backgroundColor);
            if (c && (c[3] ?? 1) >= 0.5) {
              surface = {
                what: describe(node),
                color: style.backgroundColor,
                text: style.color,
                luminance: lum(c),
              };
              break;
            }
          }
          if (!surface) {
            // No background anywhere: the browser paints its canvas, dark only with a dark color-scheme.
            const scheme = getComputedStyle(document.documentElement).colorScheme;
            const dark =
              scheme === 'dark' ||
              (scheme.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches);
            surface = {
              what: 'Leinwand ohne Hintergrund',
              color: 'canvas',
              text: '',
              luminance: dark ? 0 : 1,
            };
          }
          const key = `${surface.what}|${surface.color}`;
          if (surface.luminance >= 0.4 && !(key in record.light)) {
            record.light[key] = { ...surface, frame: record.frames };
          }
        }
      }
    };
    const tick = (): void => {
      if (record.stopped || record.frames >= 3000) return;
      if (record.frames === 0) {
        record.first = {
          body: bodyBg(),
          theme: theme(),
          appChildren: document.getElementById('app')?.childElementCount ?? -1,
        };
      }
      sample();
      record.frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const observer = new MutationObserver(() => {
      const app = document.getElementById('app');
      if (!app || app.childElementCount === 0) return;
      record.mount = { body: bodyBg(), theme: theme() };
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

/** Stops the recorder of the current document and returns what it saw. */
export async function stopStartup(page: Page): Promise<StartupRecord> {
  return page.evaluate(() => {
    const record = (
      window as unknown as {
        __startup?: {
          frames: number;
          first: unknown;
          mount: unknown;
          light: Record<string, unknown>;
          stopped: boolean;
        };
      }
    ).__startup;
    if (!record) throw new Error('recordStartup() fehlt');
    record.stopped = true;
    return {
      frames: record.frames,
      first: record.first,
      mount: record.mount,
      light: Object.values(record.light),
    } as StartupRecord;
  });
}

export interface Overflow {
  scrollWidth: number;
  innerWidth: number;
  /** Visible elements that reach past the right edge of the viewport. */
  culprits: string[];
}

export function horizontalOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const culprits: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!(el instanceof HTMLElement) || !el.checkVisibility()) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right > width + 0.5 && rect.width > 0) {
        const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).join('.');
        culprits.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} right=${Math.round(rect.right)}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: width,
      culprits: culprits.slice(0, 8),
    };
  });
}

export interface TapTarget {
  what: string;
  width: number;
  height: number;
}

/**
 * Hit areas of all visible buttons, links, form controls and ARIA widgets (NF-07). The hit area is the
 * border box, widened by an absolutely positioned ::before/::after (the card link covers its card that
 * way) or, for a visually hidden input, by its label. Links inside running text are skipped.
 */
export function tapTargets(page: Page): Promise<TapTarget[]> {
  return page.evaluate(() => {
    const selector = [
      'a[href]',
      'button',
      'summary',
      'select',
      'textarea',
      'input:not([type="hidden"])',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="radio"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="option"]',
    ].join(',');
    const describe = (el: Element): string => {
      const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).join('.');
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      const type = el instanceof HTMLInputElement ? `[type=${el.type}]` : '';
      return `${el.tagName.toLowerCase()}${type}${cls ? `.${cls}` : ''}${label ? ` "${label}"` : ''}`;
    };
    const inRunningText = (el: Element): boolean => {
      if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
      const parent = el.parentElement;
      if (!parent) return false;
      const own = (el.textContent ?? '').trim();
      return (parent.textContent ?? '').trim().length > own.length;
    };
    const pseudoBox = (el: Element): { width: number; height: number } => {
      let width = 0;
      let height = 0;
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(el, pseudo);
        if (style.content === 'none' || style.content === 'normal' || style.pointerEvents === 'none')
          continue;
        if (style.position !== 'absolute' && style.position !== 'fixed') continue;
        width = Math.max(width, Number.parseFloat(style.width) || 0);
        height = Math.max(height, Number.parseFloat(style.height) || 0);
      }
      return { width, height };
    };
    const result: { what: string; width: number; height: number }[] = [];
    for (const el of document.querySelectorAll(selector)) {
      if (!(el instanceof HTMLElement) || inRunningText(el)) continue;
      let rect = el.getBoundingClientRect();
      const hidden = rect.width <= 1 || rect.height <= 1 || !el.checkVisibility({ visibilityProperty: true });
      if (hidden) {
        // Visually hidden input: its label is the hit area.
        const label = el instanceof HTMLInputElement ? el.labels?.[0] : undefined;
        if (!label?.checkVisibility({ visibilityProperty: true })) continue;
        rect = label.getBoundingClientRect();
      }
      const extra = pseudoBox(el);
      result.push({
        what: describe(el),
        width: Math.round(Math.max(rect.width, extra.width) * 10) / 10,
        height: Math.round(Math.max(rect.height, extra.height) * 10) / 10,
      });
    }
    return result;
  });
}

export interface ClippedText {
  what: string;
  text: string;
  /** Scroll width with the text in the field and the field's client width, in CSS px. */
  needed: number;
  available: number;
}

/**
 * Visible empty single-line inputs whose placeholder (the only visible label of some fields) does not
 * fit. The placeholder goes into the field for a moment (no input event, so the app state stays): an
 * input whose text overflows has a scrollWidth above its clientWidth. This also counts the space that
 * Chromium keeps for the datalist arrow.
 */
export function clippedPlaceholders(page: Page): Promise<ClippedText[]> {
  return page.evaluate(() => {
    const found: { what: string; text: string; needed: number; available: number }[] = [];
    for (const el of document.querySelectorAll('input[placeholder]')) {
      if (!(el instanceof HTMLInputElement) || el.value !== '') continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      const available = el.clientWidth;
      el.value = el.placeholder;
      const needed = el.scrollWidth;
      el.value = '';
      if (needed > available) {
        found.push({
          what: el.getAttribute('aria-label') ?? el.name,
          text: el.placeholder,
          needed,
          available,
        });
      }
    }
    return found;
  });
}

/** Visible inputs with one of the given labels whose current value is wider than the field. */
export function clippedValues(page: Page, labels: readonly string[]): Promise<ClippedText[]> {
  return page.evaluate((names) => {
    const found: { what: string; text: string; needed: number; available: number }[] = [];
    for (const el of document.querySelectorAll('input[aria-label]')) {
      if (!(el instanceof HTMLInputElement) || !names.includes(el.getAttribute('aria-label') ?? '')) continue;
      if (el.value === '' || !el.checkVisibility({ visibilityProperty: true })) continue;
      if (el.scrollWidth > el.clientWidth) {
        found.push({
          what: el.getAttribute('aria-label') ?? '',
          text: el.value,
          needed: el.scrollWidth,
          available: el.clientWidth,
        });
      }
    }
    return found;
  }, labels);
}

/**
 * Visible inputs with one of the given labels whose value (or, when empty, placeholder) does not fit while
 * the field has the focus: focus styles may change border and padding. Each field is focused in turn
 * without scrolling; the focus is removed at the end.
 */
export function clippedFocused(page: Page, labels: readonly string[]): Promise<ClippedText[]> {
  return page.evaluate((names) => {
    const found: { what: string; text: string; needed: number; available: number }[] = [];
    for (const el of document.querySelectorAll('input[aria-label]')) {
      if (!(el instanceof HTMLInputElement) || !names.includes(el.getAttribute('aria-label') ?? '')) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      el.focus({ preventScroll: true });
      const empty = el.value === '';
      if (empty) el.value = el.placeholder;
      const text = el.value;
      const needed = el.scrollWidth;
      const available = el.clientWidth;
      if (empty) el.value = '';
      if (text !== '' && needed > available) {
        found.push({ what: el.getAttribute('aria-label') ?? '', text, needed, available });
      }
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return found;
  }, labels);
}

/** Waits for fonts, finite animations (sheet, dialog, toast) and smooth scrolling to finish. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const y = scrollY;
              const running = document
                .getAnimations()
                .some((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(!running && scrollY === y)));
            }),
        ),
      { message: 'Animationen und Scrollen abgeschlossen' },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------------------------------

/** Screenshots go to E2E_SHOTS_DIR (for a look by hand) or else into the test's output folder. */
export function shotPath(info: TestInfo, name: string): string {
  const dir = process.env.E2E_SHOTS_DIR;
  const file = `${info.project.name}-${name}.png`.replace(/[^\w.-]+/g, '-');
  if (!dir) return info.outputPath(file);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

export interface PixelStats {
  /** Share of pixels with a relative luminance ≥ 0.4 (a light surface). */
  lightShare: number;
  meanLuminance: number;
  /** Share of pixels within ±12 per channel of `color`. */
  share(color: Rgb): number;
}

export async function pixelStats(png: Buffer): Promise<PixelStats> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const s = i / 255;
    table[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  let light = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 3) {
    const l =
      0.2126 * (table[data[i] ?? 0] ?? 0) +
      0.7152 * (table[data[i + 1] ?? 0] ?? 0) +
      0.0722 * (table[data[i + 2] ?? 0] ?? 0);
    sum += l;
    if (l >= 0.4) light++;
  }
  return {
    lightShare: light / pixels,
    meanLuminance: sum / pixels,
    share(color) {
      let hits = 0;
      for (let i = 0; i < data.length; i += 3) {
        if (
          Math.abs((data[i] ?? 0) - color[0]) <= 12 &&
          Math.abs((data[i + 1] ?? 0) - color[1]) <= 12 &&
          Math.abs((data[i + 2] ?? 0) - color[2]) <= 12
        ) {
          hits++;
        }
      }
      return hits / pixels;
    },
  };
}
