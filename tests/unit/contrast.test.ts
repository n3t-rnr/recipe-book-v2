// NF-12 / NF-13: WCAG contrast of the design tokens in both color schemes.
// The pair list is generated from the token names in tokens.css, not declared per value.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOKENS_CSS = fs.readFileSync(new URL('../../client/src/styles/tokens.css', import.meta.url), 'utf8');

type Tokens = Map<string, string>;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Returns the body of the first `{ … }` block that follows `selector` (brace-balanced). */
function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Selector not found in tokens.css: ${selector}`);
  const open = css.indexOf('{', start + selector.length);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Unbalanced block after ${selector}`);
}

function declarations(block: string): Tokens {
  const tokens: Tokens = new Map();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name && value) tokens.set(name, value.trim());
  }
  return tokens;
}

/** Resolves var(--x) references within one scheme so aliases like --color-danger-text get checked too. */
function resolve(tokens: Tokens, value: string, seen: string[] = []): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!ref) return value;
  const target = tokens.get(ref);
  if (target === undefined || seen.includes(ref)) throw new Error(`Unresolvable token reference ${value}`);
  return resolve(tokens, target, [...seen, ref]);
}

function withResolved(tokens: Tokens): Tokens {
  return new Map([...tokens].map(([name, value]) => [name, resolve(tokens, value)]));
}

// Quotes are normalized because the formatter may switch between ' and " in attribute selectors.
const css = stripComments(TOKENS_CSS).replaceAll('"', "'");
const lightBlock = declarations(blockAfter(css.replace(/@media[\s\S]*$/, ''), ':root'));
const mediaDark = declarations(
  blockAfter(blockAfter(css, '@media (prefers-color-scheme: dark)'), ":root:not([data-theme='light'])"),
);
const attrDark = declarations(blockAfter(css, ":root[data-theme='dark']"));

const MODES: Record<'light' | 'dark', Tokens> = {
  light: withResolved(lightBlock),
  // Dark mode inherits every token it does not override.
  dark: withResolved(new Map([...lightBlock, ...attrDark])),
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] {
  const full =
    hex.length === 4
      ? hex
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG 2.x relative luminance (sRGB). */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

interface Rule {
  why: string;
  fg: RegExp;
  /** Background token names: a pattern, or derived from the foreground name (avatar-N-fg → avatar-N). */
  bg: RegExp | ((fg: string) => string);
  min: number;
}

const PAGE_SURFACES = /^--color-(bg|surface|surface-raised|input-bg)$/;

const RULES: Rule[] = [
  {
    why: 'normal text on page surfaces',
    fg: /^--color-(text|text-muted|primary-text|danger-text)$/,
    bg: PAGE_SURFACES,
    min: 4.5,
  },
  { why: 'text on primary buttons', fg: /^--color-on-primary$/, bg: /^--color-primary$/, min: 4.5 },
  {
    why: 'text on Moonstone, Vanilla and placeholder surfaces',
    fg: /^--color-ink$/,
    bg: /^--(color-secondary|color-highlight|placeholder-\d+)$/,
    min: 4.5,
  },
  { why: 'white text on the dark avatar colors', fg: /^--color-on-dark$/, bg: /^--avatar-[56]$/, min: 4.5 },
  { why: 'navigation labels', fg: /^--color-nav-text$/, bg: /^--color-nav$/, min: 4.5 },
  { why: 'active navigation icon', fg: /^--color-nav-active-icon$/, bg: /^--color-nav-active$/, min: 3 },
  { why: 'toast text', fg: /^--color-toast-text$/, bg: /^--color-toast-bg$/, min: 4.5 },
  { why: 'avatar initials', fg: /^--avatar-\d+-fg$/, bg: (fg) => fg.replace(/-fg$/, ''), min: 4.5 },
  { why: 'UI borders', fg: /^--color-border-strong$/, bg: PAGE_SURFACES, min: 3 },
  { why: 'primary as icon, indicator and large text', fg: /^--color-primary$/, bg: PAGE_SURFACES, min: 3 },
  { why: 'empty star outline', fg: /^--color-star-empty$/, bg: /^--color-(bg|surface)$/, min: 3 },
  { why: 'filled star outline', fg: /^--color-star-stroke$/, bg: /^--color-(bg|surface)$/, min: 3 },
  { why: 'heart on its round card surface', fg: /^--color-heart$/, bg: /^--color-surface$/, min: 3 },
  { why: 'focus ring', fg: /^--color-focus$/, bg: PAGE_SURFACES, min: 3 },
];

interface Pair {
  rule: Rule;
  fg: string;
  bg: string;
}

function pairsFor(tokens: Tokens): Pair[] {
  const names = [...tokens.keys()];
  const isHex = (name: string): boolean => HEX.test(tokens.get(name) ?? '');
  return RULES.flatMap((rule) =>
    names
      .filter((fg) => rule.fg.test(fg) && isHex(fg))
      .flatMap((fg) => {
        const { bg } = rule;
        const bgs = typeof bg === 'function' ? [bg(fg)] : names.filter((n) => bg.test(n));
        return bgs.filter(isHex).map((b) => ({ rule, fg, bg: b }));
      }),
  );
}

describe('tokens.css structure', () => {
  it('defines the dark scheme identically for the media query and data-theme="dark"', () => {
    expect(mediaDark.size).toBeGreaterThan(0);
    expect(Object.fromEntries(mediaDark)).toEqual(Object.fromEntries(attrDark));
  });

  it('only overrides tokens in dark mode that exist in light mode', () => {
    const unknown = [...attrDark.keys()].filter((name) => !lightBlock.has(name));
    expect(unknown).toEqual([]);
  });

  it('contains the approved base palette exactly (NF-12)', () => {
    const light = MODES.light;
    const dark = MODES.dark;
    expect(light.get('--color-bg')).toBe('#EFE6DD');
    expect(light.get('--color-text')).toBe('#231F20');
    expect(light.get('--color-primary')).toBe('#BB4430');
    expect(light.get('--color-secondary')).toBe('#7EBDC2');
    expect(light.get('--color-highlight')).toBe('#F3DFA2');
    expect(light.get('--color-on-primary')).toBe('#FFFFFF');
    expect(dark.get('--color-bg')).toBe('#231F20');
    expect(dark.get('--color-text')).toBe('#EFE6DD');
    expect(dark.get('--color-primary')).toBe('#D9634F');
    expect(dark.get('--color-secondary')).toBe('#7EBDC2');
    expect(dark.get('--color-highlight')).toBe('#F3DFA2');
  });

  it('keeps --color-danger-text equal to --color-primary-text in both modes', () => {
    for (const tokens of Object.values(MODES)) {
      expect(tokens.get('--color-danger-text')).toBe(tokens.get('--color-primary-text'));
    }
  });
});

describe.each(Object.entries(MODES))('contrast in %s mode (NF-13)', (_mode, tokens) => {
  const pairs = pairsFor(tokens);

  it('generates pairs for every rule', () => {
    const empty = RULES.filter((rule) => !pairs.some((p) => p.rule === rule)).map((rule) => rule.why);
    expect(empty).toEqual([]);
  });

  it('covers every solid color token in at least one pair', () => {
    const covered = new Set(pairs.flatMap((p) => [p.fg, p.bg]));
    const colorToken = /^--(color|avatar|placeholder)-/;
    const uncovered = [...tokens]
      .filter(([name, value]) => colorToken.test(name) && HEX.test(value) && !covered.has(name))
      .map(([name]) => name);
    expect(uncovered).toEqual([]);
  });

  it('meets the WCAG minimum for every pair', () => {
    const failures = pairs
      .map((p) => ({ ...p, ratio: contrast(tokens.get(p.fg) ?? '', tokens.get(p.bg) ?? '') }))
      .filter((p) => p.ratio < p.rule.min)
      .map(
        (p) =>
          `${p.fg} ${tokens.get(p.fg)} on ${p.bg} ${tokens.get(p.bg)}: ${p.ratio.toFixed(2)} < ${p.rule.min} (${p.rule.why})`,
      );
    expect(failures).toEqual([]);
  });
});

describe('contrast formula', () => {
  it('matches the reference values of the palette', () => {
    expect(contrast('#231F20', '#EFE6DD')).toBeCloseTo(13.22, 2);
    expect(contrast('#FFFFFF', '#BB4430')).toBeCloseTo(5.27, 2);
    expect(contrast('#231F20', '#D9634F')).toBeCloseTo(4.54, 2);
    expect(contrast('#BB4430', '#EFE6DD')).toBeCloseTo(4.28, 2);
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
  });
});
