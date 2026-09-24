// NF-15: the inline SVG sprite in client/index.html is generated from client/src/lib/icons.ts;
// this test keeps both identical and checks that every icon a component names exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FILLED_ICONS, ICONS, type IconName } from '../../client/src/lib/icons.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');

function spriteSymbols(html: string): Map<string, string> {
  const symbols = new Map<string, string>();
  for (const m of html.matchAll(/<symbol id="i-([A-Za-z]+)" viewBox="0 0 24 24">([\s\S]*?)<\/symbol>/g)) {
    symbols.set(m[1] ?? '', m[2] ?? '');
  }
  return symbols;
}

function expectedMarkup(name: IconName): string {
  const paths = ICONS[name];
  return FILLED_ICONS.has(name) ? `<g fill="currentColor" stroke="none">${paths}</g>` : paths;
}

describe('icon sprite (NF-15)', () => {
  const symbols = spriteSymbols(INDEX_HTML);

  it('contains exactly the icons of lib/icons.ts with the same markup', () => {
    expect([...symbols.keys()].sort()).toEqual(Object.keys(ICONS).sort());
    for (const name of Object.keys(ICONS) as IconName[]) {
      expect(symbols.get(name), name).toBe(expectedMarkup(name));
    }
  });

  it('draws with currentColor only', () => {
    const sprite = INDEX_HTML.slice(INDEX_HTML.indexOf('<svg class="icon-sprite"'));
    expect(sprite).not.toMatch(/(?:fill|stroke)="(?!none|currentColor)[^"]*"/);
  });

  it('knows every icon name used in the client sources', () => {
    const src = path.join(ROOT, 'client', 'src');
    const files = fs
      .readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.svelte'))
      .map((e) => path.join(e.parentPath, e.name));
    const used = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(?:name|icon|actionIcon|trailingIcon)="([A-Za-z]+)"/g))
        used.add(m[1] ?? '');
    }
    expect([...used].filter((name) => !(name in ICONS))).toEqual([]);
  });
});
