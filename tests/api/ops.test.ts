import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setMeta } from '../../server/db/repos/meta.ts';
import type { Health } from '../../server/services/health.ts';
import { runMaintenance } from '../../server/services/maintenance.ts';
import type { AppDeps } from '../../server/types.ts';
import { CLIENT_HEADERS, createTestContext, FAKE_NET_INFO, type TestContext } from '../helpers/app.ts';

// A LAN IP host, like a phone would send it; IP literals always pass the host check (NF-21).
const BASE = 'http://192.168.178.99:8080/api/v1';

const HEALTH_KEYS = [
  'bytes',
  'counts',
  'dataRevision',
  'db',
  'freeDiskBytes',
  'images',
  'lastBackupAt',
  'lastBackupError',
  'ok',
  'status',
  'uptimeSec',
  'version',
];

let ctx: TestContext | undefined;

function setup(overrides: Partial<AppDeps> = {}): TestContext {
  ctx = createTestContext(overrides);
  return ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
  ctx?.cleanup();
  ctx = undefined;
});

async function getHealth(c: TestContext): Promise<Health> {
  const res = await c.app.request(`${BASE}/health`);
  expect(res.status).toBe(200);
  return (await res.json()) as Health;
}

describe('GET /api/v1/health', () => {
  it('reports a fresh installation as ok', async () => {
    const c = setup();
    const res = await c.app.request(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Health;

    expect(Object.keys(body).sort()).toEqual(HEALTH_KEYS);
    expect(body).toMatchObject({
      ok: true,
      status: 'ok',
      version: '0.1.0-test',
      uptimeSec: 300, // helper clock: started 10:00, now 10:05
      counts: { recipes: 0, trash: 0, images: 0, profiles: 0, tags: 0 },
      bytes: { db: 0, images: 0, backups: 0 }, // in-memory DB: no file on disk
      lastBackupAt: null,
      lastBackupError: null,
      images: 'ok',
      db: 'ok',
      dataRevision: 0,
    });
    expect(typeof body.freeDiskBytes).toBe('number');
    expect(body.freeDiskBytes).toBeGreaterThan(0);
  });

  it('counts active recipes and trash separately', async () => {
    const c = setup();
    c.deps.db.exec(`
      INSERT INTO profiles(id, name, name_key) VALUES (1, 'Anna', 'anna'), (2, 'Ben', 'ben');
      INSERT INTO recipes(id, title, title_key) VALUES (1, 'Apfelkuchen', 'apfelkuchen'), (2, 'Suppe', 'suppe');
      INSERT INTO recipes(id, title, title_key, deleted_at, deleted_by)
        VALUES (3, 'Alt', 'alt', '2026-09-01T00:00:00.000Z', 1);
      INSERT INTO tags(name, name_key) VALUES ('Kuchen', 'kuchen'), ('Vegan', 'vegan'), ('Schnell', 'schnell');
      INSERT INTO images(recipe_id, file_key, width, height, bytes_total)
        VALUES (1, '0123456789abcdef', 2048, 1365, 400000);
    `);
    const body = await getHealth(c);
    expect(body.counts).toEqual({ recipes: 2, trash: 1, images: 1, profiles: 2, tags: 3 });
  });

  it('is degraded while image processing is unavailable', async () => {
    const c = setup();
    c.deps.state.images = 'unavailable';
    const body = await getHealth(c);
    expect(body.status).toBe('degraded');
    expect(body.ok).toBe(false);
    expect(body.images).toBe('unavailable');
  });

  it('is read-only when the database is corrupt, even if images are unavailable too', async () => {
    const c = setup();
    c.deps.state.db = 'corrupt';
    c.deps.state.images = 'unavailable';
    const body = await getHealth(c);
    expect(body.status).toBe('read-only');
    expect(body.ok).toBe(false);
    expect(body.db).toBe('corrupt');
  });

  it('is degraded after a failed backup and echoes the error (F-40)', async () => {
    const c = setup();
    setMeta(c.deps.db, 'last_backup_at', '2026-09-22T01:00:00.000Z');
    setMeta(c.deps.db, 'last_backup_error', 'EACCES: Zugriff verweigert');
    const body = await getHealth(c);
    expect(body.status).toBe('degraded');
    expect(body.ok).toBe(false);
    expect(body.lastBackupAt).toBe('2026-09-22T01:00:00.000Z');
    expect(body.lastBackupError).toBe('EACCES: Zugriff verweigert');
  });

  it('treats a cleared backup error as no error', async () => {
    const c = setup();
    setMeta(c.deps.db, 'last_backup_error', '');
    const body = await getHealth(c);
    expect(body.lastBackupError).toBeNull();
    expect(body.status).toBe('ok');
  });

  it('sums the db files and backups, caching the backups sum', async () => {
    const c = setup();
    const { paths } = c.deps;
    fs.writeFileSync(paths.db, Buffer.alloc(4096));
    fs.writeFileSync(`${paths.db}-wal`, Buffer.alloc(1000));
    fs.writeFileSync(path.join(paths.backups, 'rezepte-2026-09-22.sqlite'), Buffer.alloc(2048));

    const first = await getHealth(c);
    expect(first.bytes).toEqual({ db: 5096, images: 0, backups: 2048 });

    // Within 30 s (the helper clock stands still) the folder sum comes from the cache.
    fs.writeFileSync(path.join(paths.backups, 'manual-2026-09-23.sqlite'), Buffer.alloc(10));
    const second = await getHealth(c);
    expect(second.bytes.backups).toBe(2048);
  });

  it('takes bytes.images from the image rows plus the trash size of the last maintenance run (NF-05)', async () => {
    const c = setup();
    const { db, paths } = c.deps;
    db.exec(`
      INSERT INTO images(file_key, width, height, bytes_total) VALUES ('aaaaaaaaaaaaaaaa', 2048, 1365, 400000);
      INSERT INTO images(file_key, width, height, bytes_total) VALUES ('cccccccccccccccc', 1200, 800, 250000);
    `);
    // The files in images/ are not read: their sizes are in the rows.
    fs.writeFileSync(path.join(paths.images, 'aaaaaaaaaaaaaaaa-s.webp'), Buffer.alloc(300));
    const trashFile = path.join(paths.imagesTrash, 'bbbbbbbbbbbbbbbb-l.webp');
    fs.writeFileSync(trashFile, Buffer.alloc(50));
    const recent = new Date('2026-09-23T09:00:00Z');
    fs.utimesSync(trashFile, recent, recent);

    // A request never lists or stats the image folders (15,000 files blocked it for about 1 s).
    const calls = [vi.spyOn(fs, 'readdirSync'), vi.spyOn(fs, 'statSync'), vi.spyOn(fs, 'lstatSync')];
    // images/.trash counts from the first maintenance run on (5 s after the start).
    expect((await getHealth(c)).bytes.images).toBe(650_000);
    const touched = calls.flatMap((spy) => spy.mock.calls.map((args) => String(args[0])));
    expect(touched.filter((file) => file.startsWith(paths.images))).toEqual([]);
    expect(touched).toContain(paths.backups);
    vi.restoreAllMocks();

    runMaintenance(c.deps);
    expect((await getHealth(c)).bytes.images).toBe(650_050);

    // The next run counts again: an expired file has left images/.trash.
    fs.utimesSync(trashFile, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'));
    runMaintenance(c.deps);
    expect(fs.existsSync(trashFile)).toBe(false);
    expect((await getHealth(c)).bytes.images).toBe(650_000);
  });

  it('still answers when the image rows cannot be summed', async () => {
    const c = setup();
    c.deps.db.exec('DROP TABLE images');
    const body = await getHealth(c);
    expect(body.bytes.images).toBe(0);
    expect(c.log.entries.some((e) => e.level === 'warn' && e.msg === 'health: image bytes unavailable')).toBe(
      true,
    );
  });

  it('recounts the folders once the cache is older than 30 s', async () => {
    let now = new Date('2026-09-23T10:05:00Z');
    const c = setup({ now: () => now });
    await getHealth(c);
    fs.writeFileSync(path.join(c.deps.paths.backups, 'manual-2026-09-23.sqlite'), Buffer.alloc(10));
    now = new Date('2026-09-23T10:05:31Z');
    const body = await getHealth(c);
    expect(body.bytes.backups).toBe(10);
    expect(body.uptimeSec).toBe(331);
  });

  it('still answers with counts null when a table cannot be read', async () => {
    const c = setup();
    c.deps.db.exec('DROP TABLE images');
    const body = await getHealth(c);
    expect(body.counts).toBeNull();
    expect(body.dataRevision).toBe(0);
    expect(c.log.entries.some((e) => e.level === 'warn' && e.msg.includes('counts'))).toBe(true);
  });

  it('still answers 200 with null meta values when meta cannot be read', async () => {
    const c = setup();
    c.deps.db.exec('DROP TABLE meta');
    const res = await c.app.request(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dataRevision: unknown; lastBackupAt: unknown };
    expect(body.dataRevision).toBeNull();
    expect(body.lastBackupAt).toBeNull();
    expect(c.log.entries.some((e) => e.level === 'warn' && e.msg.includes('meta'))).toBe(true);
  });

  it('is read-only: other methods fall through to 404', async () => {
    const c = setup();
    const res = await c.app.request(`${BASE}/health`, { method: 'POST', headers: CLIENT_HEADERS });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/revision', () => {
  it('returns meta.data_revision', async () => {
    const c = setup();
    setMeta(c.deps.db, 'data_revision', '42');
    const res = await c.app.request(`${BASE}/revision`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dataRevision: 42 });
  });

  it('answers { dataRevision: null } instead of 500 when the revision cannot be read', async () => {
    const c = setup();
    c.deps.db.exec('DROP TABLE meta');
    const res = await c.app.request(`${BASE}/revision`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dataRevision: null });
  });
});

describe('GET /api/v1/server-info', () => {
  it('returns the injected network info', async () => {
    const c = setup();
    const res = await c.app.request(`${BASE}/server-info`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FAKE_NET_INFO);
  });

  it('asks for the addresses on every request (IP change without restart, F-39)', async () => {
    let calls = 0;
    const c = setup({
      netInfo: () => {
        calls++;
        return { ...FAKE_NET_INFO, qrUrl: `http://192.168.178.${20 + calls}:8080` };
      },
    });
    await c.app.request(`${BASE}/server-info`);
    const res = await c.app.request(`${BASE}/server-info`);
    expect(calls).toBe(2);
    expect(((await res.json()) as { qrUrl: string }).qrUrl).toBe('http://192.168.178.22:8080');
  });

  it('answers 500 INTERNAL when address discovery fails', async () => {
    const c = setup({
      netInfo: () => {
        throw new Error('network interfaces unavailable');
      },
    });
    const res = await c.app.request(`${BASE}/server-info`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL');
  });
});
