// NF-02: zod/mini stays in the editor chunk. client/src/lib/editor.ts is the only client module that may
// import zod/mini or shared/schemas.ts as a value; every other client file uses `import type`, which the
// build erases. With verbatimModuleSyntax, `import { type X }` keeps a side-effect import of the module,
// so it counts as a value import. A shared/ module that value-imports zod or the schemas carries zod along
// and counts like shared/schemas.ts. Full zod ('zod', 'zod/v4', …) never reaches the client, not even
// through editor.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'client', 'src');
const SHARED = path.join(ROOT, 'shared');
const ALLOWED = 'client/src/lib/editor.ts';

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
  line: number;
}

interface SourceFile {
  file: string;
  text: string;
}

/** The <script> blocks of a Svelte file, or the whole text of a TS file, with the lines before them. */
function scripts(text: string, file: string): Array<{ code: string; lineOffset: number }> {
  if (!file.endsWith('.svelte')) return [{ code: text, lineOffset: 0 }];
  // Quoted attribute values may contain ">" (generics="T extends Array<string>").
  return [...text.matchAll(/(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/script>/g)].map((m) => ({
    code: m[2] ?? '',
    lineOffset: text.slice(0, m.index + (m[1]?.length ?? 0)).split('\n').length - 1,
  }));
}

/** Static imports, re-exports and dynamic imports of one script. */
function importsOf(code: string): ImportRef[] {
  const source = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const refs: ImportRef[] = [];
  const add = (node: ts.Node, specifier: ts.Node | undefined, typeOnly: boolean): void => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    refs.push({ specifier: specifier.text, typeOnly, line });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // `import type …` only; `import { type X }` and `import 'x'` stay in the output.
      add(node, node.moduleSpecifier, node.importClause?.isTypeOnly === true);
    } else if (ts.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node, node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

function isZodPackage(specifier: string): boolean {
  return specifier === 'zod' || specifier.startsWith('zod/');
}

/**
 * File names of the shared/ modules that load zod when imported as a value: those that value-import zod
 * or another such module (shared/ is flat and imports its siblings as "./name.ts").
 */
function zodSharedModules(files: readonly SourceFile[]): Set<string> {
  const values = files.map(({ file, text }) => ({
    name: path.posix.basename(file),
    specifiers: importsOf(text)
      .filter((ref) => !ref.typeOnly)
      .map((ref) => ref.specifier),
  }));
  const loaded = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const { name, specifiers } of values) {
      if (loaded.has(name)) continue;
      if (specifiers.some((s) => isZodPackage(s) || loaded.has(path.posix.basename(s)))) {
        loaded.add(name);
        grew = true;
      }
    }
  }
  return loaded;
}

function sourceFiles(dir: string, pattern: RegExp): SourceFile[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && pattern.test(e.name))
    .map((e) => {
      const full = path.join(e.parentPath, e.name);
      return {
        file: path.relative(ROOT, full).split(path.sep).join('/'),
        text: fs.readFileSync(full, 'utf8'),
      };
    });
}

const clientFiles = (): SourceFile[] => sourceFiles(SRC, /\.(m?[jt]s|svelte)$/);
const repoZodShared = (): Set<string> => zodSharedModules(sourceFiles(SHARED, /\.ts$/));

function isZodScoped(specifier: string, zodShared: ReadonlySet<string>): boolean {
  if (isZodPackage(specifier)) return true;
  const shared = /\/shared\/([^/]+)$/.exec(specifier)?.[1];
  return shared !== undefined && zodShared.has(shared);
}

/**
 * "file:line specifier" for every forbidden value import: zod or a zod-loading shared/ module outside
 * editor.ts, and any zod entry point other than zod/mini in editor.ts.
 */
function zodValueImports(files: readonly SourceFile[], zodShared: ReadonlySet<string>): string[] {
  return files.flatMap(({ file, text }) =>
    scripts(text, file).flatMap(({ code, lineOffset }) =>
      importsOf(code)
        .filter(
          (ref) =>
            !ref.typeOnly &&
            (file === ALLOWED
              ? isZodPackage(ref.specifier) && ref.specifier !== 'zod/mini'
              : isZodScoped(ref.specifier, zodShared)),
        )
        .map((ref) => `${file}:${lineOffset + ref.line} ${ref.specifier}`),
    ),
  );
}

describe('zod import detector', () => {
  const SCHEMAS = new Set(['schemas.ts']);
  const at = (file: string, text: string) => zodValueImports([{ file, text }], SCHEMAS);

  it('accepts type-only imports and re-exports', () => {
    expect(at('client/src/a.ts', "import type { AvatarToken } from '../../shared/schemas.ts';")).toEqual([]);
    expect(at('client/src/a.ts', "import type * as z from 'zod/mini';")).toEqual([]);
    expect(at('client/src/a.ts', "export type { TagInput } from '../../shared/schemas.ts';")).toEqual([]);
  });

  it('flags value, inline-type, side-effect, re-export and dynamic imports', () => {
    const text = [
      "import * as z from 'zod/mini';",
      "import { type AvatarToken } from '../../shared/schemas.ts';",
      "import '../../shared/schemas.ts';",
      "export { TagInput } from '../../shared/schemas.ts';",
      "const lazy = () => import('../../shared/schemas.ts');",
      "import {\n  AVATARS,\n  type AvatarToken,\n} from '../../../shared/schemas.ts';",
      "import { z as full } from 'zod';",
    ].join('\n');
    expect(at('client/src/lib/tag-page.ts', text)).toEqual([
      'client/src/lib/tag-page.ts:1 zod/mini',
      'client/src/lib/tag-page.ts:2 ../../shared/schemas.ts',
      'client/src/lib/tag-page.ts:3 ../../shared/schemas.ts',
      'client/src/lib/tag-page.ts:4 ../../shared/schemas.ts',
      'client/src/lib/tag-page.ts:5 ../../shared/schemas.ts',
      'client/src/lib/tag-page.ts:6 ../../../shared/schemas.ts',
      'client/src/lib/tag-page.ts:10 zod',
    ]);
  });

  it('reads the script blocks of Svelte files and ignores the markup', () => {
    const svelte = [
      '<script module lang="ts">',
      "  import type { AvatarToken } from '../../shared/schemas.ts';",
      '</script>',
      '<script lang="ts" generics="T extends Array<string>">',
      "  import { TagInput } from '../../shared/schemas.ts';",
      '</script>',
      "<p>import {'{'} z {'}'} from 'zod/mini'</p>",
    ].join('\n');
    expect(at('client/src/routes/Tags.svelte', svelte)).toEqual([
      'client/src/routes/Tags.svelte:5 ../../shared/schemas.ts',
    ]);
  });

  it('ignores other modules and comments', () => {
    const text = [
      '// import * as z from "zod/mini";',
      "import { normalize } from '../../shared/normalize.ts';",
      "import { LIMITS } from '../../shared/constants.ts';",
    ].join('\n');
    expect(at('client/src/lib/tag-match.ts', text)).toEqual([]);
  });

  it('allows zod/mini and the schemas as values in client/src/lib/editor.ts only, never full zod', () => {
    const text =
      "import * as z from 'zod/mini';\nimport { RecipeCreateInput } from '../../../shared/schemas.ts';";
    expect(at(ALLOWED, text)).toEqual([]);
    expect(at('client/src/lib/editor-page.ts', text)).toHaveLength(2);
    expect(at(ALLOWED, "import { z } from 'zod';\nimport * as v4 from 'zod/v4';")).toEqual([
      `${ALLOWED}:1 zod`,
      `${ALLOWED}:2 zod/v4`,
    ]);
  });

  it('counts a shared module that value-imports zod or the schemas like the schemas', () => {
    const shared = zodSharedModules([
      { file: 'shared/schemas.ts', text: "import * as z from 'zod/mini';" },
      { file: 'shared/types.ts', text: "import type { AvatarToken } from './schemas.ts';" },
      { file: 'shared/tag-rules.ts', text: "import { TagInput } from './schemas.ts';" },
      { file: 'shared/tag-names.ts', text: "export { tagRule } from './tag-rules.ts';" },
      { file: 'shared/normalize.ts', text: "import { LIMITS } from './constants.ts';" },
    ]);
    expect([...shared].sort()).toEqual(['schemas.ts', 'tag-names.ts', 'tag-rules.ts']);
    const client = "import { tagRule } from '../../../shared/tag-names.ts';";
    expect(zodValueImports([{ file: 'client/src/lib/tags.ts', text: client }], shared)).toEqual([
      'client/src/lib/tags.ts:1 ../../../shared/tag-names.ts',
    ]);
  });
});

describe('zod/mini only in the editor chunk (NF-02)', () => {
  it('only shared/schemas.ts-like modules count as zod-loading, and schemas.ts is one of them', () => {
    const shared = repoZodShared();
    expect(shared.has('schemas.ts')).toBe(true);
    // types.ts and validation.ts import the schemas as types only.
    expect(shared.has('types.ts')).toBe(false);
    expect(shared.has('validation.ts')).toBe(false);
  });

  it('no client file except client/src/lib/editor.ts imports zod or a zod-loading shared module as a value', () => {
    const files = clientFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(zodValueImports(files, repoZodShared())).toEqual([]);
  });

  it('editor.ts still imports both as values, so the scan reads the real imports', () => {
    const editor = clientFiles().find((f) => f.file === ALLOWED);
    expect(editor).toBeDefined();
    const values = importsOf(editor?.text ?? '')
      .filter((ref) => !ref.typeOnly && isZodScoped(ref.specifier, repoZodShared()))
      .map((ref) => ref.specifier);
    expect(values).toContain('zod/mini');
    expect(values.some((specifier) => specifier.endsWith('/shared/schemas.ts'))).toBe(true);
  });
});
