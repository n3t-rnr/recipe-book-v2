import { type Context, Hono } from 'hono';
import { computeInitials } from '../../shared/initials.ts';
import { normalize } from '../../shared/normalize.ts';
import { AVATARS, type AvatarToken, ProfileInput, ProfilePatch } from '../../shared/schemas.ts';
import type { Profile, ProfilesResponse } from '../../shared/types.ts';
import { toValidationDetails } from '../../shared/validation.ts';
import {
  countProfiles,
  deleteProfile,
  findByNameKey,
  getProfile,
  insertProfile,
  listAvatars,
  listProfiles,
  updateProfile,
} from '../db/repos/profiles.ts';
import type { DB } from '../db/types.ts';
import { AppError } from '../errors.ts';
import { parseId } from '../middleware/profile.ts';
import type { AppDeps, AppEnv } from '../types.ts';

const NAME_EXISTS_MESSAGE = 'Name bereits vergeben';
const NOT_FOUND_MESSAGE = 'Profil nicht gefunden';

function isAvatar(value: string): value is AvatarToken {
  return (AVATARS as readonly string[]).includes(value);
}

/** Default color of a new profile: the first unused token, otherwise round robin by profile count. */
export function defaultAvatar(used: readonly string[]): AvatarToken {
  const free = AVATARS.find((token) => !used.includes(token));
  return free ?? AVATARS[used.length % AVATARS.length] ?? AVATARS[0];
}

/** All profiles as API objects; initials are computed over the complete list (F-03). */
function loadProfiles(db: DB): Profile[] {
  const rows = listProfiles(db);
  const initials = computeInitials(rows);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    avatar: isAvatar(row.avatar) ? row.avatar : AVATARS[0],
    initials: initials.get(row.id) ?? '',
    ratingCount: row.ratingCount,
    favoriteCount: row.favoriteCount,
  }));
}

function loadProfile(db: DB, id: number): Profile {
  const profile = loadProfiles(db).find((p) => p.id === id);
  if (!profile) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return profile;
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError('BAD_REQUEST', 'Ungültiger JSON-Inhalt');
  }
}

function validationError(issues: Parameters<typeof toValidationDetails>[0]): AppError {
  const details = toValidationDetails(issues);
  return new AppError('VALIDATION', details[0]?.message ?? 'Ungültige Eingabe', details);
}

function pathId(c: Context<AppEnv>): number {
  const id = parseId(c.req.param('id'));
  if (id === null) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
  return id;
}

/**
 * Profile management (Kap. 7.3, F-01 … F-04). Works without an active profile (Kap. 7.1 exception),
 * but an unknown X-Profile-Id is still rejected by profileContext.
 */
export function profilesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = deps;

  app.get('/profiles', (c) => {
    const body: ProfilesResponse = { profiles: loadProfiles(db) };
    return c.json(body);
  });

  app.post('/profiles', async (c) => {
    const parsed = ProfileInput.safeParse(await readJson(c));
    if (!parsed.success) throw validationError(parsed.error.issues);
    const { name, avatar } = parsed.data;
    const nameKey = normalize(name);

    const id = db.transaction(() => {
      if (findByNameKey(db, nameKey)) throw new AppError('NAME_EXISTS', NAME_EXISTS_MESSAGE);
      return insertProfile(db, {
        name,
        nameKey,
        avatar: avatar ?? defaultAvatar(listAvatars(db)),
        createdAt: deps.now().toISOString(),
      });
    })();

    return c.json({ profile: loadProfile(db, id) }, 201);
  });

  app.patch('/profiles/:id', async (c) => {
    const id = pathId(c);
    const parsed = ProfilePatch.safeParse(await readJson(c));
    if (!parsed.success) throw validationError(parsed.error.issues);
    const patch = parsed.data;

    db.transaction(() => {
      const current = getProfile(db, id);
      if (!current) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
      const name = patch.name ?? current.name;
      const nameKey = patch.name === undefined ? current.nameKey : normalize(patch.name);
      const owner = findByNameKey(db, nameKey);
      if (owner && owner.id !== id) throw new AppError('NAME_EXISTS', NAME_EXISTS_MESSAGE);
      updateProfile(db, id, { name, nameKey, avatar: patch.avatar ?? current.avatar });
    })();

    return c.json({ profile: loadProfile(db, id) });
  });

  app.delete('/profiles/:id', (c) => {
    const id = pathId(c);
    db.transaction(() => {
      if (!getProfile(db, id)) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
      if (countProfiles(db) <= 1) {
        throw new AppError('LAST_PROFILE', 'Das letzte Profil kann nicht gelöscht werden');
      }
      deleteProfile(db, id);
    })();
    return c.body(null, 204);
  });

  return app;
}
