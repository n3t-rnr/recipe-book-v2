// NF-10 wording rules for the screen text files next to de.ts (client/src/i18n/de-screens*.ts):
// informal "du", typographic dashes and ellipses, no text literals hidden in the screen components.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = ['client/src/i18n/de-screens.ts', 'client/src/i18n/de-screens-lazy.ts'];

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('screen texts (NF-10)', () => {
  for (const file of FILES) {
    const source = read(file);

    it(`${file} never uses the formal address`, () => {
      const hits = source
        .split(/\r?\n/)
        .flatMap((line, i) =>
          /\bSie\b|\bIhre[nmrs]?\b|\bIhnen\b|\bMeinten\b/.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
        );
      expect(hits).toEqual([]);
    });

    it(`${file} uses typographic dashes and ellipses`, () => {
      const strings = [...source.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '');
      expect(strings.filter((s) => s.includes('...'))).toEqual([]);
      expect(strings.filter((s) => / - /.test(s))).toEqual([]);
    });
  }

  it('screen components take their German texts from the text files', () => {
    const routes = [
      'ProfilePick',
      'RecipeList',
      'RecipeDetail',
      'Favorites',
      'Tags',
      'More',
      'Trash',
      'Connect',
      'Status',
      'NotFound',
    ];
    const files = [
      ...routes.map((name) => `client/src/routes/${name}.svelte`),
      ...fs
        .readdirSync(path.join(ROOT, 'client/src/components/screens'))
        .filter((name) => name.endsWith('.svelte'))
        .map((name) => `client/src/components/screens/${name}`),
    ];
    // Markup text between tags with at least two letters (expressions removed) would be a literal text.
    const hits = files.flatMap((file) => {
      const markup = read(file)
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{[^{}]*\}/g, '');
      return [...markup.matchAll(/>([^<>]*[A-Za-zÄÖÜäöüß]{2,}[^<>]*)</g)].map(
        (m) => `${file}: ${m[1]?.trim()}`,
      );
    });
    expect(hits).toEqual([]);
  });
});
