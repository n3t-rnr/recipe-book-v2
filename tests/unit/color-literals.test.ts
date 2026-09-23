// NF-12: colors only as tokens. Color literals are allowed exclusively in tokens.css, print.css and the
// <meta name="theme-color"> tags of index.html (manifest and generated icons live outside the scanned tree).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'client', 'src');
const ALLOWED_FILES = new Set(['client/src/styles/tokens.css', 'client/src/styles/print.css']);
const SCANNED = /\.(svelte|ts|css|svg)$/;

// `(?<![&\w])` skips HTML entities such as &#8211; and identifiers; `{#each}` never matches (h is not hex).
const HEX_LITERAL = /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
// Moonstone and Vanilla are surfaces only, never text color (NF-12 AK 3).
const SURFACE_AS_TEXT = /(?<![\w-])color\s*:\s*var\(\s*--color-(?:secondary|highlight)\s*\)/gi;

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function sourceFiles(): string[] {
  const files = fs
    .readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && SCANNED.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
  return [...files, path.join(ROOT, 'client', 'index.html')];
}

/** Returns "line: match" findings; theme-color meta lines are the only exception inside index.html. */
function findColorLiterals(text: string, isIndexHtml = false): string[] {
  return text.split(/\r?\n/).flatMap((line, i) => {
    if (isIndexHtml && /<meta\s+name=["']theme-color["']/i.test(line)) return [];
    const hits = [...line.matchAll(HEX_LITERAL), ...line.matchAll(COLOR_FUNCTION)].map((m) => m[0]);
    return hits.map((hit) => `${i + 1}: ${hit}`);
  });
}

describe('color literal detector', () => {
  it('finds hex literals and color functions', () => {
    expect(findColorLiterals('.a { color: #BB4430; }')).toEqual(['1: #BB4430']);
    expect(findColorLiterals('fill="#fff"')).toEqual(['1: #fff']);
    expect(findColorLiterals('background: #231f2080;')).toEqual(['1: #231f2080']);
    expect(findColorLiterals('box-shadow: 0 0 4px rgba(0, 0, 0, 0.2)')).toEqual(['1: rgba(']);
    expect(findColorLiterals('color: rgb(1 2 3)')).toEqual(['1: rgb(']);
    expect(findColorLiterals('color: hsl(10 20% 30%)')).toEqual(['1: hsl(']);
    expect(findColorLiterals('color: oklch(0.5 0.1 30)')).toEqual(['1: oklch(']);
  });

  it('ignores Svelte blocks, entities, ids and tokens', () => {
    expect(findColorLiterals('{#each items as item}{#if a}{#await p}')).toEqual([]);
    expect(findColorLiterals('&#8211; &#x2013;')).toEqual([]);
    expect(findColorLiterals('color: var(--color-text); #app { margin: 0 }')).toEqual([]);
    expect(findColorLiterals("const label = 'Farbe'; background(); getRgb()")).toEqual([]);
  });

  it('allows only the theme-color meta lines in index.html', () => {
    const html = '<meta name="theme-color" content="#EFE6DD" />\n<body class="x" data-c="#EFE6DD">';
    expect(findColorLiterals(html, true)).toEqual(['2: #EFE6DD']);
  });
});

describe('client sources (NF-12)', () => {
  const files = sourceFiles();

  it('scans the client sources', () => {
    expect(files.map(relative)).toContain('client/src/App.svelte');
    expect(files.map(relative)).toContain('client/index.html');
  });

  it('contain no color literals outside the allowed files', () => {
    const violations = files
      .filter((file) => !ALLOWED_FILES.has(relative(file)))
      .flatMap((file) => {
        const isIndex = relative(file) === 'client/index.html';
        return findColorLiterals(fs.readFileSync(file, 'utf8'), isIndex).map((f) => `${relative(file)}:${f}`);
      });
    expect(violations).toEqual([]);
  });

  it('never use Moonstone or Vanilla as text color', () => {
    const violations = files.flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(SURFACE_AS_TEXT)].map((m) => `${relative(file)}: ${m[0]}`),
    );
    expect(violations).toEqual([]);
  });
});
