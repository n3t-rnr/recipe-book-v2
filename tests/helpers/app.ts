import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { createMemoryLogger, type MemoryLogger } from '../../server/log.ts';
import { dataPaths, ensureDataDirs } from '../../server/paths.ts';
import type { AppDeps, NetInfo } from '../../server/types.ts';
import { createTestDb } from './db.ts';

/** Inline theme script of the fixture index.html; the CSP must allow exactly this script via its hash. */
export const FIXTURE_THEME_SCRIPT =
  "try{const t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch{}";

export const FIXTURE_INDEX_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Rezepte</title>
<script>${FIXTURE_THEME_SCRIPT}</script>
<script type="module" crossorigin src="/assets/index-abc123.js"></script>
</head>
<body><div id="app"></div></body>
</html>
`;

/** Creates a minimal built client (index.html, a hashed asset, manifest) in a temp dir. */
export function createClientFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-client-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), FIXTURE_INDEX_HTML);
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log("app");\n');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.css'), 'body{margin:0}\n');
  fs.writeFileSync(
    path.join(dir, 'manifest.webmanifest'),
    JSON.stringify({ name: 'Rezepte', short_name: 'Rezepte', start_url: '/', display: 'standalone' }),
  );
  fs.writeFileSync(path.join(dir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  return dir;
}

export const FAKE_NET_INFO: NetInfo = {
  hostname: 'kueche-pc',
  urls: [
    { url: 'http://192.168.178.20:8080', kind: 'ip' },
    { url: 'http://kueche-pc.local:8080', kind: 'mdns' },
  ],
  qrUrl: 'http://192.168.178.20:8080',
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
};

export interface TestContext {
  deps: AppDeps;
  log: MemoryLogger;
  app: ReturnType<typeof createApp>;
  cleanup: () => void;
}

/** Full app with in-memory DB, temp DATA_DIR, fixture client and memory logger. */
export function createTestContext(overrides: Partial<AppDeps> = {}): TestContext {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-data-'));
  const clientDir = createClientFixture();
  const config = loadConfig(
    { NODE_ENV: 'test', DATA_DIR: dataDir, ALLOWED_HOSTS: 'kueche-pc.fritz.box' },
    { cwd: dataDir, hostname: 'kueche-pc' },
  );
  const paths = dataPaths(dataDir);
  ensureDataDirs(paths);
  const log = createMemoryLogger();
  const deps: AppDeps = {
    config: { ...config, clientDir },
    db: createTestDb(),
    paths,
    state: { version: '0.1.0-test', startedAt: new Date('2026-09-23T10:00:00Z'), db: 'ok', images: 'ok' },
    log,
    clientDir,
    netInfo: () => FAKE_NET_INFO,
    now: () => new Date('2026-09-23T10:05:00Z'),
    ...overrides,
  };
  const app = createApp(deps);
  return {
    deps,
    log,
    app,
    cleanup: () => {
      deps.db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(clientDir, { recursive: true, force: true });
    },
  };
}

/** Default headers of the real client for write requests. */
export const CLIENT_HEADERS = {
  'X-Rezepte-Client': '1',
  'Content-Type': 'application/json',
  Host: 'localhost:8080',
};
