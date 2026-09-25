import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataRevision, getMeta, setMeta } from '../../server/db/repos/meta.ts';
import { ensureStartTags, START_TAGS } from '../../server/services/tags.ts';
import { normalize } from '../../shared/normalize.ts';
import { TagInput } from '../../shared/schemas.ts';
import type { TagsResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';
import { MIGRATIONS_DIR } from '../helpers/db.ts';
import { insertProfile, insertRecipe, tagId } from '../helpers/recipes.ts';
import { seed } from '../seed.ts';

/** Start tags of a new installation (F-20): created once at server start, never again (meta.seeded). */

const API = 'http://localhost:8080/api/v1';
const NOW = new Date('2026-09-25T06:00:00.000Z');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

function db() {
  return ctx.deps.db;
}

function tagNamesById(): string[] {
  return db().prepare('SELECT name FROM tags ORDER BY id').pluck().all() as string[];
}

async function getTags(): Promise<{ body: TagsResponse; header: number }> {
  const res = await ctx.app.request(`${API}/tags`);
  expect(res.status).toBe(200);
  return { body: (await res.json()) as TagsResponse, header: Number(res.headers.get('X-Data-Revision')) };
}

describe('START_TAGS (F-20, A10)', () => {
  it('are the 10 names of F-20, each a valid tag name with its own key', () => {
    expect([...START_TAGS]).toEqual([
      'Vegetarisch',
      'Vegan',
      'Schnell',
      'Hauptgericht',
      'Beilage',
      'Suppe',
      'Salat',
      'Dessert',
      'Backen',
      'Frühstück',
    ]);
    for (const name of START_TAGS) expect(TagInput.safeParse({ name }).success, name).toBe(true);
    const keys = START_TAGS.map((name) => normalize(name));
    expect(new Set(keys).size).toBe(START_TAGS.length);
    expect(keys.every((key) => key !== '')).toBe(true);
  });
});

describe('ensureStartTags (F-20)', () => {
  it('gives an empty database the 10 start tags with count 0, sets meta.seeded and bumps the revision', async () => {
    const revision = getDataRevision(db());

    expect(ensureStartTags(db(), NOW)).toBe(10);

    expect(tagNamesById()).toEqual([...START_TAGS]);
    expect(getMeta(db(), 'seeded')).toBe(NOW.toISOString());
    expect(getDataRevision(db())).toBe(revision + 1);

    // F-20 AK1: the tag page (GET /tags) shows all 10 with count 0, ordered by name_key.
    const { body, header } = await getTags();
    const byKey = [...START_TAGS].sort((a, b) => (normalize(a) < normalize(b) ? -1 : 1));
    expect(body.tags.map((t) => t.name)).toEqual(byKey);
    expect(body.tags.every((t) => t.count === 0)).toBe(true);
    expect(body.revision).toBe(revision + 1);
    expect(header).toBe(revision + 1);
  });

  it('creates nothing on a second call', () => {
    expect(ensureStartTags(db(), NOW)).toBe(10);
    const revision = getDataRevision(db());

    expect(ensureStartTags(db(), new Date('2026-10-01T06:00:00.000Z'))).toBe(0);
    expect(tagNamesById()).toEqual([...START_TAGS]);
    expect(getMeta(db(), 'seeded')).toBe(NOW.toISOString());
    expect(getDataRevision(db())).toBe(revision);
  });

  it('does not bring back a deleted start tag (F-20 AK2)', async () => {
    const profileId = insertProfile(db(), 'Sebastian');
    ensureStartTags(db(), NOW);

    const res = await ctx.app.request(`${API}/tags/${tagId(db(), 'Vegan')}`, {
      method: 'DELETE',
      headers: { ...CLIENT_HEADERS, 'X-Profile-Id': String(profileId) },
    });
    expect(res.status).toBe(204);

    expect(ensureStartTags(db(), NOW)).toBe(0);
    const names = (await getTags()).body.tags.map((t) => t.name);
    expect(names).toHaveLength(9);
    expect(names).not.toContain('Vegan');
  });

  it('adds none to a database that already has tags, but marks it as seeded', () => {
    insertRecipe(db(), { title: 'Spaghetti', tags: ['Pasta'] });
    const revision = getDataRevision(db());

    expect(ensureStartTags(db(), NOW)).toBe(0);
    expect(tagNamesById()).toEqual(['Pasta']);
    expect(getMeta(db(), 'seeded')).toBe(NOW.toISOString());
    expect(getDataRevision(db())).toBe(revision);
  });

  it('adds none when meta.seeded is already set, e.g. by pnpm seed', () => {
    setMeta(db(), 'seeded', '2026-01-01T00:00:00.000Z');
    expect(ensureStartTags(db(), NOW)).toBe(0);
    expect(tagNamesById()).toEqual([]);
    expect(getMeta(db(), 'seeded')).toBe('2026-01-01T00:00:00.000Z');

    const seeded = createTestContext();
    try {
      seed(seeded.deps.db, { count: 5, now: NOW });
      const tags = seeded.deps.db.prepare('SELECT count(*) FROM tags').pluck().get();
      expect(ensureStartTags(seeded.deps.db, NOW)).toBe(0);
      expect(seeded.deps.db.prepare('SELECT count(*) FROM tags').pluck().get()).toBe(tags);
    } finally {
      seeded.cleanup();
    }
  });

  it('leaves a read-only database alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-start-tags-'));
    const file = path.join(dir, 'rezepte.sqlite');
    try {
      const writable = new Database(file);
      for (const migration of fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        writable.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, migration), 'utf8'));
      }
      writable.close();

      const readonly = new Database(file, { readonly: true });
      expect(ensureStartTags(readonly, NOW)).toBe(0);
      readonly.close();

      const check = new Database(file, { readonly: true });
      expect(check.prepare('SELECT count(*) FROM tags').pluck().get()).toBe(0);
      expect(getMeta(check, 'seeded')).toBeNull();
      expect(getDataRevision(check)).toBe(0);
      check.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The real server start (server/main.ts)

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

interface Server {
  url: string;
  stop: () => Promise<void>;
}

/** Starts `node server/main.ts` like `pnpm start` with its own DATA_DIR; no client build is needed. */
async function startServer(dataDir: string): Promise<Server> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = '';
  const child: ChildProcess = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'main.ts')],
    {
      cwd: dataDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
        LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  };

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server beendet (Exit ${child.exitCode}):\n${output}`);
    try {
      if ((await fetch(`${url}/api/v1/health`)).ok) return { url, stop };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`Server nach 20 s nicht bereit:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function serverTags(server: Server): Promise<string[]> {
  const res = await fetch(`${server.url}/api/v1/tags`);
  expect(res.status).toBe(200);
  return ((await res.json()) as TagsResponse).tags.map((t) => t.name);
}

describe('server start (F-20)', () => {
  it('creates the start tags at the first start and not again after a restart', {
    timeout: 60_000,
  }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezepte-start-tags-'));
    let server: Server | null = null;
    try {
      server = await startServer(dataDir);
      expect((await serverTags(server)).sort()).toEqual([...START_TAGS].sort());

      const headers = { 'X-Rezepte-Client': '1', 'Content-Type': 'application/json' };
      const created = await fetch(`${server.url}/api/v1/profiles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Sebastian' }),
      });
      expect(created.status).toBe(201);
      const profileId = ((await created.json()) as { profile: { id: number } }).profile.id;
      const tags = (await (await fetch(`${server.url}/api/v1/tags`)).json()) as TagsResponse;
      const vegan = tags.tags.find((t) => t.name === 'Vegan');
      const deleted = await fetch(`${server.url}/api/v1/tags/${vegan?.id ?? 0}`, {
        method: 'DELETE',
        headers: { ...headers, 'X-Profile-Id': String(profileId) },
      });
      expect(deleted.status).toBe(204);
      await server.stop();

      server = await startServer(dataDir);
      const names = await serverTags(server);
      expect(names).toHaveLength(9);
      expect(names).not.toContain('Vegan');
      await server.stop();
      server = null;

      const logged = fs
        .readFileSync(path.join(dataDir, 'logs', 'app.log'), 'utf8')
        .split('\n')
        .filter((line) => line.includes('"start tags created"'))
        .map((line) => (JSON.parse(line) as { count: number }).count);
      expect(logged).toEqual([10]);
    } finally {
      await server?.stop();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});
