import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUDGETS, checkBudgets } from '../../scripts/size-check.ts';

const dirs: string[] = [];

/** Builds a fake dist/client with the given files (paths relative to the dist root). */
function fixture(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-size-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

/** Random bytes as text do not compress well, so `kb` of them stay far above `kb * 0.7` after gzip. */
function incompressible(kb: number): string {
  return `export const blob = "${randomBytes(kb * 1024).toString('base64')}";\n`;
}

function indexHtml(head: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${head}</head><body><div id="app"></div></body></html>`;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('checkBudgets (NF-01)', () => {
  it('passes a small build and reports every budget', () => {
    const dir = fixture({
      'index.html': indexHtml(
        '<script type="module" crossorigin src="/assets/index-a1.js"></script>' +
          '<link rel="modulepreload" crossorigin href="/assets/vendor-b2.js">' +
          '<link rel="stylesheet" href="/assets/index-c3.css">',
      ),
      'assets/index-a1.js': 'import "./vendor-b2.js";\nconsole.log("app");\n',
      'assets/vendor-b2.js': 'export const x = 1;\n',
      'assets/editor-d4.js': 'export const editor = true;\n',
      'assets/index-c3.css': 'body{margin:0}\n',
    });
    const { rows, violations } = checkBudgets(dir);
    expect(violations).toEqual([]);
    expect(rows.map((r) => r.label)).toEqual([
      'JS initial (gzip)',
      'JS gesamt (gzip)',
      'CSS gesamt (gzip)',
      'Schriften gesamt (WOFF2)',
      'Schriften vorgeladen (WOFF2, 0 Dateien)',
    ]);
    expect(rows.every((r) => r.ok)).toBe(true);
    const [initial, total] = rows;
    expect(initial?.bytes).toBeGreaterThan(0);
    // The lazy editor chunk counts for the total, not for the initial route.
    expect(total?.bytes).toBeGreaterThan(initial?.bytes ?? 0);
    expect(initial?.limit).toBe(35 * 1024);
  });

  it('flags an initial script over 35 KB gzip', () => {
    const dir = fixture({
      'index.html': indexHtml('<script type="module" src="/assets/index-big.js"></script>'),
      'assets/index-big.js': incompressible(40),
    });
    const { rows, violations } = checkBudgets(dir);
    const initial = rows.find((r) => r.label === 'JS initial (gzip)');
    expect(initial?.bytes).toBeGreaterThan(BUDGETS.initialJs);
    expect(initial?.ok).toBe(false);
    expect(violations.some((v) => v.startsWith('JS initial'))).toBe(true);
  });

  it('counts modulepreload chunks as initial JS', () => {
    const dir = fixture({
      'index.html': indexHtml(
        '<script type="module" src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/big.js">',
      ),
      'assets/index-a.js': 'import "./big.js";\n',
      'assets/big.js': incompressible(40),
    });
    expect(checkBudgets(dir).violations.some((v) => v.startsWith('JS initial'))).toBe(true);
  });

  it('flags lazy chunks only against the total JS budget', () => {
    const dir = fixture({
      'index.html': indexHtml('<script type="module" src="/assets/index-a.js"></script>'),
      'assets/index-a.js': 'export {};\n',
      'assets/editor-1.js': incompressible(40),
      'assets/tags-2.js': incompressible(40),
    });
    const { violations } = checkBudgets(dir);
    expect(violations.some((v) => v.startsWith('JS gesamt'))).toBe(true);
    expect(violations.some((v) => v.startsWith('JS initial'))).toBe(false);
  });

  it('flags CSS over 15 KB gzip', () => {
    const dir = fixture({
      'index.html': indexHtml(''),
      'assets/index.css': `/* ${randomBytes(20 * 1024).toString('base64')} */\n`,
    });
    expect(checkBudgets(dir).violations.some((v) => v.startsWith('CSS gesamt'))).toBe(true);
  });

  it('flags font budgets: total size, preloaded size and preloaded file count', () => {
    const font = (kb: number): Buffer => randomBytes(kb * 1024);
    const preload = (name: string): string =>
      `<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/${name}">`;
    const dir = fixture({
      'index.html': indexHtml(preload('a.woff2') + preload('b.woff2') + preload('c.woff2')),
      'assets/a.woff2': font(25),
      'assets/b.woff2': font(25),
      'assets/c.woff2': font(25),
      'assets/d.woff2': font(30),
    });
    const { rows, violations } = checkBudgets(dir);
    expect(violations.some((v) => v.startsWith('Schriften gesamt'))).toBe(true);
    expect(violations.some((v) => v.startsWith('Schriften vorgeladen'))).toBe(true);
    expect(violations.some((v) => v.includes('3 Dateien > 1 Datei'))).toBe(true);
    expect(rows.find((r) => r.label.startsWith('Schriften vorgeladen'))?.ok).toBe(false);
  });

  it('flags missing files and foreign origins referenced by index.html', () => {
    const dir = fixture({
      'index.html': indexHtml(
        '<script type="module" src="/assets/gone.js"></script><script src="https://cdn.example.com/x.js"></script>',
      ),
    });
    const { violations } = checkBudgets(dir);
    expect(violations.some((v) => v.includes('/assets/gone.js'))).toBe(true);
    expect(violations.some((v) => v.includes('https://cdn.example.com/x.js'))).toBe(true);
  });

  it('throws a clear error when the build is missing', () => {
    const dir = fixture({});
    expect(() => checkBudgets(dir)).toThrow(/index\.html fehlt/);
  });
});
