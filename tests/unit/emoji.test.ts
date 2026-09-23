// NF-15: no emoji as icons or decoration. Icons come from the SVG sprite; UI texts live in .svelte and .ts
// files under client/src (later i18n/de.ts), so both are scanned together with index.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'client', 'src');
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu;

function findEmoji(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, i) => [...line.matchAll(PICTOGRAPHIC)].map((m) => `${i + 1}: ${m[0]}`));
}

function files(): string[] {
  const src = fs
    .readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(svelte|ts)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
  return [...src, path.join(ROOT, 'client', 'index.html')];
}

describe('emoji detector', () => {
  it('finds pictographic code points', () => {
    expect(findEmoji('Lecker \u{1F60B}')).toHaveLength(1);
    expect(findEmoji('Favorit ❤️')).toHaveLength(1);
    expect(findEmoji('Zeit ⏱')).toHaveLength(1);
  });

  it('accepts German typography', () => {
    expect(findEmoji('Käse – „Spätzle“ … ½ € ß → 2,4')).toEqual([]);
  });
});

describe('client sources (NF-15)', () => {
  const scanned = files();

  it('include the .svelte files', () => {
    expect(scanned.some((f) => f.endsWith('.svelte'))).toBe(true);
  });

  it('contain no emoji', () => {
    const violations = scanned.flatMap((file) =>
      findEmoji(fs.readFileSync(file, 'utf8')).map(
        (hit) => `${path.relative(ROOT, file).split(path.sep).join('/')}:${hit}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
