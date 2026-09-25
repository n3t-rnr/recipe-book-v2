// Playwright fixtures: a real server process per worker (and on demand per test) on a free port with a
// temporary DATA_DIR, optionally filled by the seed CLI (1,000 recipes, NF-04), API helpers for test data,
// and a guard that fails every test on a CSP violation or an uncaught browser error (NF-29).
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';
import type { z } from 'zod/mini';
import { normalize } from '../../shared/normalize.ts';
import type { RecipeCreateInput } from '../../shared/schemas.ts';
import type {
  ImageUploadResponse,
  Profile,
  RecipeDetail,
  RecipeListPage,
  TagCount,
  TagResponse,
  TagsResponse,
} from '../../shared/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Working directory of the server: it serves <cwd>/dist/client. E2E_APP_CWD points at a frozen build copy. */
const APP_CWD = process.env.E2E_APP_CWD ? path.resolve(process.env.E2E_APP_CWD) : ROOT;

export type RecipeSeed = Omit<z.input<typeof RecipeCreateInput>, 'createKey'>;

export interface RequestOptions {
  profileId?: number;
  json?: unknown;
  body?: Buffer;
  contentType?: string;
}

export interface Api {
  /** Any API call with the client header set; `path` starts with /api/v1. */
  request(method: string, apiPath: string, options?: RequestOptions): Promise<Response>;
  createProfile(name: string, avatar?: string): Promise<Profile>;
  createRecipe(profileId: number, recipe: RecipeSeed): Promise<RecipeDetail>;
  uploadImage(profileId: number, body: Buffer, contentType?: string): Promise<ImageUploadResponse>;
  /** GET /tags: all tags with counts in server order. */
  tags(): Promise<TagCount[]>;
  /** Id of the tag with this name (any spelling of its key, F-17); throws when there is none. */
  tagIdByName(name: string): Promise<number>;
  /** POST /tags; an existing key answers with that tag (200) instead of a new one (201). */
  createTag(profileId: number, name: string): Promise<TagCount>;
  /** DELETE /tags/:id. */
  deleteTag(profileId: number, id: number): Promise<void>;
  /** GET /recipes with a query string such as 'q=suppe&tags=3,7' (a leading "?" is fine). */
  list(query: string): Promise<RecipeListPage>;
}

export interface AppServer {
  url: string;
  port: number;
  dataDir: string;
  api: Api;
  /** Server output so far (stdout and stderr), for failure messages. */
  output(): string;
  /** Stops the process (as a crash would); the data dir stays until dispose(). */
  stop(): Promise<void>;
  /** Starts the process again on the same port and data dir. */
  restart(): Promise<void>;
  dispose(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function createApi(url: string): Api {
  const request: Api['request'] = (method, apiPath, options = {}) => {
    const headers: Record<string, string> = { 'X-Rezepte-Client': '1' };
    if (options.profileId !== undefined) headers['X-Profile-Id'] = String(options.profileId);
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.body) {
      headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
      body = new Uint8Array(options.body);
    }
    return fetch(url + apiPath, { method, headers, ...(body === undefined ? {} : { body }) });
  };
  const expectStatus = async (res: Response, status: number | number[], what: string): Promise<unknown> => {
    const text = await res.text();
    const ok = Array.isArray(status) ? status.includes(res.status) : res.status === status;
    if (!ok) throw new Error(`${what}: HTTP ${res.status} ${text}`);
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  };
  const tags = async (): Promise<TagCount[]> => {
    const data = await expectStatus(await request('GET', '/api/v1/tags'), 200, 'Tags laden');
    return (data as TagsResponse).tags;
  };
  return {
    request,
    async createProfile(name, avatar = 'avatar-1') {
      const data = await expectStatus(
        await request('POST', '/api/v1/profiles', { json: { name, avatar } }),
        201,
        'Profil anlegen',
      );
      return (data as { profile: Profile }).profile;
    },
    async createRecipe(profileId, recipe) {
      const data = await expectStatus(
        await request('POST', '/api/v1/recipes', {
          profileId,
          json: { ...recipe, createKey: randomUUID().replaceAll('-', '') },
        }),
        201,
        'Rezept anlegen',
      );
      return (data as { recipe: RecipeDetail }).recipe;
    },
    async uploadImage(profileId, body, contentType = 'image/jpeg') {
      const data = await expectStatus(
        await request('POST', '/api/v1/images', { profileId, body, contentType }),
        201,
        'Bild hochladen',
      );
      return data as ImageUploadResponse;
    },
    tags,
    async tagIdByName(name) {
      const key = normalize(name);
      const found = (await tags()).find((t) => normalize(t.name) === key);
      if (!found) throw new Error(`Tag „${name}“ gibt es nicht`);
      return found.id;
    },
    async createTag(profileId, name) {
      const data = await expectStatus(
        await request('POST', '/api/v1/tags', { profileId, json: { name } }),
        [200, 201],
        'Tag anlegen',
      );
      return (data as TagResponse).tag;
    },
    async deleteTag(profileId, id) {
      await expectStatus(await request('DELETE', `/api/v1/tags/${id}`, { profileId }), 204, 'Tag löschen');
    },
    async list(query) {
      const q = query.replace(/^\?/, '');
      const data = await expectStatus(
        await request('GET', `/api/v1/recipes${q === '' ? '' : `?${q}`}`),
        200,
        'Rezepte laden',
      );
      return data as RecipeListPage;
    },
  };
}

async function waitForHealth(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server beendet (Exit ${child.exitCode}):\n${output()}`);
    try {
      const res = await fetch(`${url}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`Server nach 15 s nicht bereit:\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Fills an empty data dir with `count` recipes of the seed CLI (Kap. 9.3); it also sets meta.seeded. */
function seedDataDir(dataDir: string, count: number): void {
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      'tests/seed.ts',
      '--data-dir',
      dataDir,
      '--count',
      String(count),
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 120_000 },
  );
  if (result.status !== 0) {
    const reason = result.error ? String(result.error) : `Exit ${result.status ?? result.signal}`;
    throw new Error(`Testdaten anlegen fehlgeschlagen (${reason}):\n${result.stdout}${result.stderr}`);
  }
}

export interface StartOptions {
  /** Number of seed recipes (tests/seed.ts) created before the server starts; none by default. */
  seed?: number;
}

/** Starts `node server/main.ts` against dist/client, like `pnpm start`, on a free port. */
export async function startServer(
  env: Record<string, string> = {},
  options: StartOptions = {},
): Promise<AppServer> {
  if (!fs.existsSync(path.join(APP_CWD, 'dist', 'client', 'index.html'))) {
    throw new Error(`${APP_CWD}/dist/client fehlt – zuerst "pnpm build" (oder "pnpm e2e") ausführen.`);
  }
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-e2e-'));
  if (options.seed !== undefined) {
    try {
      seedDataDir(dataDir, options.seed);
    } catch (err) {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      throw err;
    }
  }
  const url = `http://127.0.0.1:${port}`;
  let log = '';
  let child: ChildProcess;

  const launch = async (): Promise<void> => {
    child = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'main.ts')],
      {
        cwd: APP_CWD,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: String(port),
          HOST: '127.0.0.1',
          DATA_DIR: dataDir,
          LOG_LEVEL: 'warn',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      log += chunk.toString();
    });
    await waitForHealth(url, child, () => log);
  };
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  };

  await launch();
  return {
    url,
    port,
    dataDir,
    api: createApi(url),
    output: () => log,
    stop,
    restart: launch,
    async dispose() {
      await stop();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

/**
 * Remembers `profileId` on the device before the app starts (F-02), once per browser tab: later reloads
 * keep whatever the app itself stored, so switching or deleting profiles behaves as on a real device.
 */
export async function useProfile(page: Page, profileId: number): Promise<void> {
  await page.addInitScript((id) => {
    try {
      if (!sessionStorage.getItem('e2e-profile')) {
        localStorage.setItem('profileId', String(id));
        sessionStorage.setItem('e2e-profile', '1');
      }
    } catch {
      // storage blocked: the app shows the profile choice
    }
  }, profileId);
}

interface TestFixtures {
  /** A server with an empty database only for this test. */
  freshServer: AppServer;
  guard: undefined;
}

interface WorkerFixtures {
  /** A server shared by all tests of one worker; tests create their own profiles and recipes. */
  server: AppServer;
  /**
   * A server with the 1,000 seed recipes (tests/seed.ts: profiles, tags, ratings), shared by the tests of
   * one worker. Read only: tests must not change its data. It gets no start tags (meta.seeded is set).
   */
  seededServer: AppServer;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
    async ({}, use) => {
      const server = await startServer();
      await use(server);
      await server.dispose();
    },
    { scope: 'worker' },
  ],
  seededServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
    async ({}, use) => {
      const server = await startServer({}, { seed: 1000 });
      await use(server);
      await server.dispose();
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
  freshServer: async ({}, use) => {
    const server = await startServer();
    await use(server);
    await server.dispose();
  },
  // Note: in WebKit, page.screenshot() itself triggers a style-src report under the app's CSP, so the guard
  // would fail such a test; take screenshots only in Chromium projects (WebKit gets DOM checks instead).
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(`Fehler im Browser: ${error.message}`));
      await page.exposeFunction('__e2eReportCsp', (text: string) => problems.push(`CSP-Verstoß: ${text}`));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const w = window as unknown as { __e2eReportCsp?: (text: string) => void };
          w.__e2eReportCsp?.(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}`);
        });
      });
      await use(undefined);
      expect(problems, 'CSP-Verstöße und Fehler im Browser').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
