// NF-10 wording rules for the screen text files next to de.ts (client/src/i18n/de-screens*.ts, every one
// of them, also the ones M4 adds for the filter sheet and the tag page): informal "du", typographic dashes
// and ellipses, no text literals hidden in the screen components or the shared components.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = fs
  .readdirSync(path.join(ROOT, 'client/src/i18n'))
  .filter((name) => /^de-screens.*\.ts$/.test(name))
  .sort()
  .map((name) => `client/src/i18n/${name}`);

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('screen texts (NF-10)', () => {
  it('checks every screen text file', () => {
    expect(FILES).toContain('client/src/i18n/de-screens.ts');
    expect(FILES).toContain('client/src/i18n/de-screens-lazy.ts');
    expect(FILES).not.toContain('client/src/i18n/de.ts');
    expect(FILES).not.toContain('client/src/i18n/de-editor.ts');
  });

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
    const svelteFiles = (dir: string): string[] =>
      fs
        .readdirSync(path.join(ROOT, dir))
        .filter((name) => name.endsWith('.svelte'))
        .map((name) => `${dir}/${name}`);
    const files = [
      ...routes.map((name) => `client/src/routes/${name}.svelte`),
      ...svelteFiles('client/src/components/screens'),
      // Shared components (Chip, SearchField, Sheet …) get every text through props.
      ...svelteFiles('client/src/components'),
    ];
    expect(files).toContain('client/src/components/SearchField.svelte');
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
