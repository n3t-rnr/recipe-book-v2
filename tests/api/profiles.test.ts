import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataRevision } from '../../server/db/repos/meta.ts';
import type { ErrorBody } from '../../server/errors.ts';
import { errorHandler } from '../../server/middleware/error.ts';
import { requireProfile } from '../../server/middleware/profile.ts';
import { defaultAvatar } from '../../server/routes/profiles.ts';
import type { AppEnv } from '../../server/types.ts';
import type { Profile, ProfilesResponse } from '../../shared/types.ts';
import { CLIENT_HEADERS, createTestContext, type TestContext } from '../helpers/app.ts';

const API = 'http://localhost:8080/api/v1';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

interface Call {
  method?: string;
  body?: unknown;
  profileId?: string | number;
  headers?: Record<string, string>;
}

async function call(
  path: string,
  { method = 'GET', body, profileId, headers = {} }: Call = {},
): Promise<Response> {
  const all: Record<string, string> = { ...CLIENT_HEADERS, ...headers };
  if (profileId !== undefined) all['X-Profile-Id'] = String(profileId);
  const init: RequestInit = { method, headers: all };
  if (body !== undefined) init.body = JSON.stringify(body);
  return await ctx.app.request(`${API}${path}`, init);
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

async function create(name: string, avatar?: string): Promise<Profile> {
  const res = await call('/profiles', { method: 'POST', body: avatar ? { name, avatar } : { name } });
  expect(res.status, `create ${name}`).toBe(201);
  return ((await res.json()) as { profile: Profile }).profile;
}

async function list(): Promise<Profile[]> {
  const res = await call('/profiles');
  expect(res.status).toBe(200);
  return ((await res.json()) as ProfilesResponse).profiles;
}

function profileRowCount(): number {
  return (ctx.deps.db.prepare('SELECT count(*) AS n FROM profiles').get() as { n: number }).n;
}

/** A bare recipe row, enough for FK behavior; the recipe API is not needed here. */
function insertRecipe(title: string, createdBy: number): number {
  const result = ctx.deps.db
    .prepare(
      'INSERT INTO recipes (title, title_key, created_by, updated_by, deleted_by) VALUES (?, ?, ?, ?, ?)',
    )
    .run(title, title.toLowerCase(), createdBy, createdBy, createdBy);
  return Number(result.lastInsertRowid);
}

describe('GET /profiles', () => {
  it('answers an empty list on a fresh database', async () => {
    const res = await call('/profiles');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ profiles: [] });
  });

  it('lists profiles in creation order with initials and counts', async () => {
    const anna = await create('Anna', 'avatar-3');
    const andreas = await create('Andreas');
    const jorg = await create('Jörg Müller');
    const recipe = insertRecipe('Suppe', anna.id);
    ctx.deps.db
      .prepare('INSERT INTO ratings (profile_id, recipe_id, stars) VALUES (?, ?, 4)')
      .run(anna.id, recipe);
    ctx.deps.db.prepare('INSERT INTO favorites (profile_id, recipe_id) VALUES (?, ?)').run(anna.id, recipe);

    expect(await list()).toEqual([
      { id: anna.id, name: 'Anna', avatar: 'avatar-3', initials: 'An', ratingCount: 1, favoriteCount: 1 },
      {
        id: andreas.id,
        name: 'Andreas',
        avatar: 'avatar-1',
        initials: 'Ad',
        ratingCount: 0,
        favoriteCount: 0,
      },
      {
        id: jorg.id,
        name: 'Jörg Müller',
        avatar: 'avatar-2',
        initials: 'J',
        ratingCount: 0,
        favoriteCount: 0,
      },
    ]);
  });
});

describe('POST /profiles (F-01)', () => {
  it('creates "Jörg Müller" unchanged with the chosen color', async () => {
    const res = await call('/profiles', {
      method: 'POST',
      body: { name: 'Jörg Müller', avatar: 'avatar-4' },
    });
    expect(res.status).toBe(201);
    const { profile } = (await res.json()) as { profile: Profile };
    expect(profile).toEqual({
      id: expect.any(Number),
      name: 'Jörg Müller',
      avatar: 'avatar-4',
      initials: 'J',
      ratingCount: 0,
      favoriteCount: 0,
    });
    expect(await list()).toEqual([profile]);
    const row = ctx.deps.db.prepare('SELECT name, name_key, created_at FROM profiles').get();
    expect(row).toEqual({
      name: 'Jörg Müller',
      name_key: 'jorg muller',
      created_at: '2026-09-23T10:05:00.000Z',
    });
  });

  it('trims the name', async () => {
    const profile = await create('  Anna  ');
    expect(profile.name).toBe('Anna');
  });

  it('picks the first unused color, then cycles by count', async () => {
    await create('A1', 'avatar-1');
    await create('A2', 'avatar-3');
    expect((await create('A3')).avatar).toBe('avatar-2');
    expect((await create('A4')).avatar).toBe('avatar-4');
    expect((await create('A5')).avatar).toBe('avatar-5');
    expect((await create('A6')).avatar).toBe('avatar-6');
    expect((await create('A7')).avatar).toBe('avatar-1');
    expect((await create('A8')).avatar).toBe('avatar-2');
  });

  it('computes the default color without I/O', () => {
    expect(defaultAvatar([])).toBe('avatar-1');
    expect(defaultAvatar(['avatar-2', 'avatar-1'])).toBe('avatar-3');
    const full = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'];
    expect(defaultAvatar(full)).toBe('avatar-1');
    expect(defaultAvatar([...full, 'avatar-1', 'avatar-2', 'avatar-3'])).toBe('avatar-4');
  });

  it('rejects "sebastian" and "SEBASTIAN" when "Sebastian" exists (409 NAME_EXISTS)', async () => {
    await create('Sebastian');
    for (const name of ['sebastian', 'SEBASTIAN', ' Sebastian ']) {
      const res = await call('/profiles', { method: 'POST', body: { name } });
      expect(res.status, name).toBe(409);
      const error = await errorOf(res);
      expect(error.code).toBe('NAME_EXISTS');
      expect(error.message).toBe('Name bereits vergeben');
    }
    expect(profileRowCount()).toBe(1);
  });

  it('treats names that normalize equally as duplicates', async () => {
    await create('Jörg');
    const res = await call('/profiles', { method: 'POST', body: { name: 'Jorg' } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('NAME_EXISTS');
  });

  it('rejects empty and blank names with 400 VALIDATION on field "name"', async () => {
    for (const name of ['', '   ', '\t']) {
      const res = await call('/profiles', { method: 'POST', body: { name } });
      expect(res.status, JSON.stringify(name)).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('VALIDATION');
      expect(error.message).toBe('Name darf nicht leer sein');
      const details = error.details as Array<{ field: string; message: string }>;
      expect(details[0]?.field).toBe('name');
    }
    expect(profileRowCount()).toBe(0);
  });

  it('accepts 40 characters and rejects 41', async () => {
    const ok = await call('/profiles', { method: 'POST', body: { name: 'x'.repeat(40) } });
    expect(ok.status).toBe(201);
    const res = await call('/profiles', { method: 'POST', body: { name: 'y'.repeat(41) } });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toEqual([{ field: 'name', message: 'Name darf höchstens 40 Zeichen lang sein' }]);
  });

  it('rejects a missing name, an unknown avatar and line breaks', async () => {
    const missing = await call('/profiles', { method: 'POST', body: {} });
    expect(missing.status).toBe(400);
    expect((await errorOf(missing)).details).toEqual([{ field: 'name', message: expect.any(String) }]);

    const avatar = await call('/profiles', { method: 'POST', body: { name: 'Anna', avatar: '#ff0000' } });
    expect(avatar.status).toBe(400);
    expect(((await errorOf(avatar)).details as Array<{ field: string }>)[0]?.field).toBe('avatar');

    const newline = await call('/profiles', { method: 'POST', body: { name: 'An\nna' } });
    expect(newline.status).toBe(400);
    expect(profileRowCount()).toBe(0);
  });

  it('answers malformed JSON with 400 BAD_REQUEST', async () => {
    const res = await ctx.app.request(`${API}/profiles`, {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: '{"name":',
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('BAD_REQUEST');
  });

  it('needs the client header like every write (NF-21)', async () => {
    const res = await ctx.app.request(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anna' }),
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('BAD_REQUEST');
    expect(profileRowCount()).toBe(0);
  });

  it('bumps the data revision once per successful create, not on failures', async () => {
    expect(getDataRevision(ctx.deps.db)).toBe(0);
    const res = await call('/profiles', { method: 'POST', body: { name: 'Anna' } });
    expect(res.status).toBe(201);
    expect(getDataRevision(ctx.deps.db)).toBe(1);
    expect(res.headers.get('x-data-revision')).toBe('1');

    await call('/profiles', { method: 'POST', body: { name: 'anna' } });
    await call('/profiles', { method: 'POST', body: { name: '' } });
    expect(getDataRevision(ctx.deps.db)).toBe(1);
  });

  it('works without X-Profile-Id, and with a valid one', async () => {
    const anna = await create('Anna');
    const res = await call('/profiles', { method: 'POST', body: { name: 'Bernd' }, profileId: anna.id });
    expect(res.status).toBe(201);
  });
});

describe('PATCH /profiles/:id (F-04)', () => {
  it('renames and recolors; the new name shows everywhere', async () => {
    const anna = await create('Anna', 'avatar-1');
    const res = await call(`/profiles/${anna.id}`, {
      method: 'PATCH',
      body: { name: 'Anna K.', avatar: 'avatar-5' },
    });
    expect(res.status).toBe(200);
    const { profile } = (await res.json()) as { profile: Profile };
    expect(profile).toMatchObject({ id: anna.id, name: 'Anna K.', avatar: 'avatar-5', initials: 'A' });
    expect((await list())[0]?.name).toBe('Anna K.');
    expect(ctx.deps.db.prepare('SELECT name_key FROM profiles').get()).toEqual({ name_key: 'anna k.' });
    expect(getDataRevision(ctx.deps.db)).toBe(2);
  });

  it('changes only the fields sent', async () => {
    const anna = await create('Anna', 'avatar-2');
    const color = await call(`/profiles/${anna.id}`, { method: 'PATCH', body: { avatar: 'avatar-6' } });
    expect(((await color.json()) as { profile: Profile }).profile).toMatchObject({
      name: 'Anna',
      avatar: 'avatar-6',
    });
    const name = await call(`/profiles/${anna.id}`, { method: 'PATCH', body: { name: 'Anni' } });
    expect(((await name.json()) as { profile: Profile }).profile).toMatchObject({
      name: 'Anni',
      avatar: 'avatar-6',
    });
  });

  it('allows changing only the spelling of the own name', async () => {
    const anna = await create('anna');
    const res = await call(`/profiles/${anna.id}`, { method: 'PATCH', body: { name: 'Anna' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { profile: Profile }).profile.name).toBe('Anna');
  });

  it('updates the initials of other profiles when a rename makes them collide', async () => {
    await create('Anna');
    const bernd = await create('Bernd');
    await call(`/profiles/${bernd.id}`, { method: 'PATCH', body: { name: 'Andreas' } });
    expect((await list()).map((p) => p.initials)).toEqual(['An', 'Ad']);
  });

  it('rejects a name another profile has (409 NAME_EXISTS)', async () => {
    await create('Sebastian');
    const anna = await create('Anna');
    const res = await call(`/profiles/${anna.id}`, { method: 'PATCH', body: { name: 'SEBASTIAN' } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('NAME_EXISTS');
    expect((await list()).map((p) => p.name)).toEqual(['Sebastian', 'Anna']);
  });

  it('answers 404 for unknown and invalid ids', async () => {
    await create('Anna');
    for (const id of ['999', 'abc', '0', '-1', '1.5']) {
      const res = await call(`/profiles/${id}`, { method: 'PATCH', body: { name: 'X' } });
      expect(res.status, id).toBe(404);
      expect((await errorOf(res)).code).toBe('NOT_FOUND');
    }
  });

  it('rejects a blank name with 400 VALIDATION', async () => {
    const anna = await create('Anna');
    const res = await call(`/profiles/${anna.id}`, { method: 'PATCH', body: { name: '  ' } });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe('VALIDATION');
    expect((error.details as Array<{ field: string }>)[0]?.field).toBe('name');
  });
});

describe('DELETE /profiles/:id (F-04)', () => {
  it('keeps recipes, clears their author fields and removes ratings and favorites', async () => {
    const anna = await create('Anna');
    const bernd = await create('Bernd');
    const recipe = insertRecipe('Gulasch', anna.id);
    const db = ctx.deps.db;
    db.prepare('INSERT INTO ratings (profile_id, recipe_id, stars) VALUES (?, ?, 5)').run(anna.id, recipe);
    db.prepare('INSERT INTO ratings (profile_id, recipe_id, stars) VALUES (?, ?, 3)').run(bernd.id, recipe);
    db.prepare('INSERT INTO favorites (profile_id, recipe_id) VALUES (?, ?)').run(anna.id, recipe);

    const before = await list();
    expect(before.find((p) => p.id === anna.id)).toMatchObject({ ratingCount: 1, favoriteCount: 1 });

    const res = await call(`/profiles/${anna.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect(
      db.prepare('SELECT created_by, updated_by, deleted_by FROM recipes WHERE id = ?').get(recipe),
    ).toEqual({
      created_by: null,
      updated_by: null,
      deleted_by: null,
    });
    expect(db.prepare('SELECT profile_id FROM ratings').all()).toEqual([{ profile_id: bernd.id }]);
    expect(db.prepare('SELECT count(*) AS n FROM favorites').get()).toEqual({ n: 0 });
    expect((await list()).map((p) => p.name)).toEqual(['Bernd']);
    expect(getDataRevision(db)).toBe(3);
  });

  it('refuses to delete the last profile (409 LAST_PROFILE)', async () => {
    const anna = await create('Anna');
    const res = await call(`/profiles/${anna.id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    const error = await errorOf(res);
    expect(error.code).toBe('LAST_PROFILE');
    expect(error.message).toBe('Das letzte Profil kann nicht gelöscht werden');
    expect(profileRowCount()).toBe(1);
  });

  it('answers 404 for unknown and invalid ids', async () => {
    await create('Anna');
    await create('Bernd');
    for (const id of ['999', 'abc']) {
      const res = await call(`/profiles/${id}`, { method: 'DELETE' });
      expect(res.status, id).toBe(404);
      expect((await errorOf(res)).code).toBe('NOT_FOUND');
    }
    expect(profileRowCount()).toBe(2);
  });

  it('lets a profile delete itself; its header is unknown afterwards (F-02)', async () => {
    const anna = await create('Anna');
    await create('Bernd');
    const res = await call(`/profiles/${anna.id}`, { method: 'DELETE', profileId: anna.id });
    expect(res.status).toBe(204);

    const read = await call('/profiles', { profileId: anna.id });
    expect(read.status).toBe(401);
    const error = await errorOf(read);
    expect(error.code).toBe('PROFILE_UNKNOWN');
    expect(read.headers.get('x-request-id')).toBe(error.requestId);
  });
});

describe('profile ids are never reused (F-02, F-05)', () => {
  it('gives a new profile a fresh id after the newest one was deleted', async () => {
    const anna = await create('Anna');
    const bernd = await create('Bernd');
    expect((await call(`/profiles/${bernd.id}`, { method: 'DELETE' })).status).toBe(204);

    const clara = await create('Clara');
    expect(clara.id).not.toBe(bernd.id);
    expect(clara.id).toBeGreaterThan(bernd.id);

    // A device that still remembers Bernd must not act as Clara.
    const stale = await call('/profiles', { profileId: bernd.id });
    expect(stale.status).toBe(401);
    expect((await errorOf(stale)).code).toBe('PROFILE_UNKNOWN');
    const write = await call('/profiles', { method: 'POST', body: { name: 'Dora' }, profileId: bernd.id });
    expect(write.status).toBe(401);
    expect((await list()).map((p) => p.id)).toEqual([anna.id, clara.id]);

    // And again in a second round.
    expect((await call(`/profiles/${clara.id}`, { method: 'DELETE' })).status).toBe(204);
    const dora = await create('Dora');
    expect([anna.id, bernd.id, clara.id]).not.toContain(dora.id);
  });

  it('also keeps ids reserved that were inserted without the counter (older databases)', async () => {
    const db = ctx.deps.db;
    const insert = db.prepare('INSERT INTO profiles(name, name_key) VALUES (?, ?)');
    const anna = Number(insert.run('Anna', 'anna').lastInsertRowid);
    const bernd = Number(insert.run('Bernd', 'bernd').lastInsertRowid);
    expect((await call(`/profiles/${bernd}`, { method: 'DELETE' })).status).toBe(204);

    const clara = await create('Clara');
    expect([anna, bernd]).not.toContain(clara.id);
    const stale = await call('/profiles', { profileId: bernd });
    expect(stale.status).toBe(401);
    expect((await errorOf(stale)).code).toBe('PROFILE_UNKNOWN');
  });

  it('continues after the highest id of rows inserted directly; a rejected create uses up no id', async () => {
    const db = ctx.deps.db;
    db.prepare("INSERT INTO profiles(id, name, name_key) VALUES (41, 'Anna', 'anna')").run();
    expect((await create('Bernd')).id).toBe(42);

    expect((await call('/profiles', { method: 'POST', body: { name: 'bernd' } })).status).toBe(409);
    expect((await create('Clara')).id).toBe(43);
  });
});

describe('X-Profile-Id (F-05)', () => {
  it('lets reads without the header through', async () => {
    await create('Anna');
    const res = await call('/profiles');
    expect(res.status).toBe(200);
  });

  it('accepts a known profile id', async () => {
    const anna = await create('Anna');
    const res = await call('/profiles', { profileId: anna.id });
    expect(res.status).toBe(200);
  });

  it('answers 401 PROFILE_UNKNOWN for "abc", "999" and other malformed values, on reads too', async () => {
    await create('Anna');
    for (const value of ['abc', '999', '0', '-1', '1.0', '01', '1e2', '', ' ', '99999999999999999999']) {
      const res = await call('/profiles', { profileId: value });
      expect(res.status, JSON.stringify(value)).toBe(401);
      expect((await errorOf(res)).code).toBe('PROFILE_UNKNOWN');
    }
  });

  it('answers 401 PROFILE_UNKNOWN on writes before touching data', async () => {
    const anna = await create('Anna');
    const bernd = await create('Bernd');
    const post = await call('/profiles', { method: 'POST', body: { name: 'Clara' }, profileId: 999 });
    expect(post.status).toBe(401);
    const patch = await call(`/profiles/${anna.id}`, {
      method: 'PATCH',
      body: { name: 'X' },
      profileId: 999,
    });
    expect(patch.status).toBe(401);
    const del = await call(`/profiles/${bernd.id}`, { method: 'DELETE', profileId: 'abc' });
    expect(del.status).toBe(401);
    expect((await list()).map((p) => p.name)).toEqual(['Anna', 'Bernd']);
    expect(getDataRevision(ctx.deps.db)).toBe(2);
  });

  it('applies to every API path, e.g. /revision', async () => {
    const res = await call('/revision', { profileId: 999 });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('PROFILE_UNKNOWN');
  });

  it('degrades to "no profile" in read-only mode when profiles cannot be read (NF-19)', async () => {
    ctx.deps.state.db = 'corrupt';
    ctx.deps.db.exec('DROP TABLE ratings; DROP TABLE favorites; DROP TABLE profiles');
    const res = await call('/health', { profileId: 1 });
    expect(res.status).toBe(200);
    expect(ctx.log.entries.some((e) => e.msg === 'profile lookup failed in read-only mode')).toBe(true);
  });
});

describe('requireProfile (F-05)', () => {
  function tinyApp(profile: { id: number; name: string } | null): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('profile', profile);
      await next();
    });
    app.get('/api/v1/me', (c) => c.json(requireProfile(c)));
    app.onError(errorHandler(ctx.deps));
    return app;
  }

  it('throws 401 PROFILE_REQUIRED without a profile', async () => {
    const res = await tinyApp(null).request(`${API}/me`);
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('PROFILE_REQUIRED');
    expect(error.message).toBe('Bitte zuerst ein Profil wählen');
  });

  it('returns the acting profile', async () => {
    const res = await tinyApp({ id: 4, name: 'Anna' }).request(`${API}/me`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 4, name: 'Anna' });
  });
});
