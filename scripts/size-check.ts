// Bundle budget check (NF-01). Runs after `vite build` via `pnpm build`; no dependencies, gzip via node:zlib.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;

export const BUDGETS = {
  /** Raised from 35 KB for M4 and M5 (search, chips, hearts and stars on the first screen), ADR 0004. */
  initialJs: 38 * KB,
  /** Every lazily loaded JS chunk (editor, secondary pages); decided 2026-09-23, ADR 0002. */
  lazyChunkJs: 30 * KB,
  totalCss: 15 * KB,
  fontsTotal: 100 * KB,
  fontsPreloaded: 60 * KB,
  fontsPreloadedFiles: 1,
} as const;

export interface BudgetRow {
  label: string;
  bytes: number;
  limit: number;
  ok: boolean;
}

export interface BudgetResult {
  rows: BudgetRow[];
  violations: string[];
  /** Sum of all JS chunks (gzip) — reported for information, no longer a budget (ADR 0002). */
  totalJs: number;
}

function gzipBytes(file: string): number {
  return gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .flatMap((entry) => (entry.isFile() ? [path.join(entry.parentPath, entry.name)] : []));
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
}

/** URLs referenced by index.html, split by what the browser fetches for the first view. */
function referencedUrls(html: string): { scripts: string[]; fonts: string[] } {
  const scripts: string[] = [];
  const fonts: string[] = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(tag, 'src');
    if (src) scripts.push(src);
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    const href = attr(tag, 'href');
    if (!href) continue;
    if (rel.includes('modulepreload')) scripts.push(href);
    else if (rel.includes('preload') && (attr(tag, 'as') === 'font' || href.endsWith('.woff2')))
      fonts.push(href);
  }
  return { scripts: [...new Set(scripts)], fonts: [...new Set(fonts)] };
}

/** Maps a root-relative URL from index.html to a file in distDir; undefined for foreign origins. */
function resolveUrl(distDir: string, url: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) return undefined;
  const clean = url.split(/[?#]/)[0] ?? '';
  return path.join(distDir, clean.replace(/^\.?\//, ''));
}

function kb(bytes: number): string {
  return `${(bytes / KB).toFixed(1).replace('.', ',')} KB`;
}

export function checkBudgets(distDir: string): BudgetResult {
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) throw new Error(`${indexFile} fehlt – zuerst "vite build" ausführen.`);
  const html = fs.readFileSync(indexFile, 'utf8');
  const violations: string[] = [];
  const refs = referencedUrls(html);

  const resolveAll = (urls: string[]): string[] =>
    urls.flatMap((url) => {
      const file = resolveUrl(distDir, url);
      if (!file) {
        violations.push(`Fremde Ressource in index.html: ${url} (nur der eigene Server ist erlaubt)`);
        return [];
      }
      if (!fs.existsSync(file)) {
        violations.push(`index.html verweist auf eine fehlende Datei: ${url}`);
        return [];
      }
      return [file];
    });

  const assetFiles = listFiles(path.join(distDir, 'assets'));
  const initialFiles = resolveAll(refs.scripts);
  const initialJs = initialFiles.reduce((sum, file) => sum + gzipBytes(file), 0);
  const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));
  const totalJs = jsFiles.reduce((sum, f) => sum + gzipBytes(f), 0);
  const initialSet = new Set(initialFiles.map((f) => path.resolve(f)));
  const lazyChunks = jsFiles
    .filter((f) => !initialSet.has(path.resolve(f)))
    .map((f) => ({ name: path.basename(f), bytes: gzipBytes(f) }))
    .sort((a, b) => b.bytes - a.bytes);
  const largestLazy = lazyChunks[0] ?? { name: '–', bytes: 0 };
  for (const chunk of lazyChunks.slice(1)) {
    if (chunk.bytes > BUDGETS.lazyChunkJs) {
      violations.push(`Nachgeladener Chunk ${chunk.name}: ${kb(chunk.bytes)} > ${kb(BUDGETS.lazyChunkJs)}`);
    }
  }
  const totalCss = assetFiles.filter((f) => f.endsWith('.css')).reduce((sum, f) => sum + gzipBytes(f), 0);
  // WOFF2 is already compressed, so fonts count with their raw size.
  const fontsTotal = listFiles(distDir)
    .filter((f) => f.endsWith('.woff2'))
    .reduce((sum, f) => sum + fs.statSync(f).size, 0);
  const preloaded = resolveAll(refs.fonts);
  const fontsPreloaded = preloaded.reduce((sum, f) => sum + fs.statSync(f).size, 0);

  const row = (label: string, bytes: number, limit: number, extraOk = true): BudgetRow => {
    const ok = bytes <= limit && extraOk;
    if (bytes > limit) violations.push(`${label}: ${kb(bytes)} > ${kb(limit)}`);
    return { label, bytes, limit, ok };
  };

  const preloadCountOk = preloaded.length <= BUDGETS.fontsPreloadedFiles;
  if (!preloadCountOk) {
    violations.push(
      `Vorgeladene Schriften: ${fileCount(preloaded.length)} > ${fileCount(BUDGETS.fontsPreloadedFiles)} (Kap. 6.7: höchstens 1 Datei per preload)`,
    );
  }

  const rows = [
    row('JS initial (gzip)', initialJs, BUDGETS.initialJs),
    row(`JS größter nachgeladener Chunk (${largestLazy.name})`, largestLazy.bytes, BUDGETS.lazyChunkJs),
    row('CSS gesamt (gzip)', totalCss, BUDGETS.totalCss),
    row('Schriften gesamt (WOFF2)', fontsTotal, BUDGETS.fontsTotal),
    row(
      `Schriften vorgeladen (WOFF2, ${fileCount(preloaded.length)})`,
      fontsPreloaded,
      BUDGETS.fontsPreloaded,
      preloadCountOk,
    ),
  ];
  return { rows, violations, totalJs };
}

function printTable(rows: BudgetRow[]): void {
  const width = Math.max(...rows.map((r) => r.label.length), 'Budget'.length);
  const line = (a: string, b: string, c: string, d: string): string =>
    `${a.padEnd(width)}  ${b.padStart(10)}  ${c.padStart(10)}  ${d}`;
  console.log(line('Budget', 'Größe', 'Grenze', 'Status'));
  console.log('-'.repeat(width + 32));
  for (const r of rows) console.log(line(r.label, kb(r.bytes), kb(r.limit), r.ok ? 'ok' : 'ÜBERSCHRITTEN'));
}

function main(): void {
  const distDir = path.resolve(process.argv[2] ?? 'dist/client');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error(
      `Size-Check: ${distDir} enthält keinen Build (index.html fehlt). Zuerst "vite build" ausführen.`,
    );
    process.exitCode = 1;
    return;
  }
  const { rows, violations, totalJs } = checkBudgets(distDir);
  console.log(`Size-Check für ${distDir}`);
  printTable(rows);
  console.log(`\nJS gesamt (gzip, nur zur Information): ${kb(totalJs)}`);
  if (violations.length > 0) {
    console.error('\nBudget überschritten (NF-01):');
    for (const v of violations) console.error(`- ${v}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAlle Budgets eingehalten.');
}

const isMain =
  import.meta.main === true ||
  (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) main();

function fileCount(n: number): string {
  return `${n} ${n === 1 ? 'Datei' : 'Dateien'}`;
}
