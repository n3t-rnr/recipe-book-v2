// CSP `style-src 'self'` blocks style attributes in markup (Kap. 7.8): no static or bound `style=` in .svelte
// files or index.html. Dynamic values go through the `style:` directive (CSSOM, allowed by the CSP).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'client', 'src');

// Attribute position: whitespace before `style`, then `=`; `style:color={…}` has a colon and does not match.
const STYLE_ATTRIBUTE = /\sstyle\s*=/gi;

/** Removes script and style element contents and HTML comments, so only markup remains. */
function markupOnly(source: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open: string, body: string, close: string) => {
      return open + blank(body) + close;
    })
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, body: string, close: string) => {
      return open + blank(body) + close;
    });
}

function findStyleAttributes(source: string): string[] {
  const markup = markupOnly(source);
  return [...markup.matchAll(STYLE_ATTRIBUTE)].map((m) => {
    const line = markup.slice(0, m.index).split('\n').length;
    return `line ${line}`;
  });
}

function markupFiles(): string[] {
  const svelte = fs
    .readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.svelte'))
    .map((e) => path.join(e.parentPath, e.name));
  return [...svelte, path.join(ROOT, 'client', 'index.html')];
}

describe('style attribute detector', () => {
  it('finds static and bound style attributes', () => {
    expect(findStyleAttributes('<div style="color: red"></div>')).toEqual(['line 1']);
    expect(findStyleAttributes('<div\n  style={css}></div>')).toEqual(['line 2']);
    expect(findStyleAttributes("<span class='a' STYLE = 'x'></span>")).toEqual(['line 1']);
  });

  it('allows style: directives, style elements, scripts and comments', () => {
    expect(findStyleAttributes('<div style:width={w} style:--x="1px"></div>')).toEqual([]);
    expect(findStyleAttributes('<style>\n.a { color: var(--color-text); }\n</style>')).toEqual([]);
    expect(
      findStyleAttributes('<script lang="ts">\n  el.style = x; const a = { style = 1 };\n</script>'),
    ).toEqual([]);
    expect(findStyleAttributes('<!-- never use style="" here -->')).toEqual([]);
  });
});

describe('client markup (CSP)', () => {
  const files = markupFiles();

  it('scans App.svelte and index.html', () => {
    const names = files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(names).toContain('client/src/App.svelte');
    expect(names).toContain('client/index.html');
  });

  it('contains no style attributes', () => {
    const violations = files.flatMap((file) =>
      findStyleAttributes(fs.readFileSync(file, 'utf8')).map(
        (hit) => `${path.relative(ROOT, file).split(path.sep).join('/')} ${hit}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
