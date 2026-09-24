import type { DB } from '../types.ts';
import { setMeta } from './meta.ts';

/** One row of `profiles` (Kap. 4.3). `avatar` is a token name; the route checks it against AVATARS. */
export interface ProfileRow {
  id: number;
  name: string;
  nameKey: string;
  avatar: string;
  createdAt: string;
}

/** Profile plus the numbers the delete confirmation shows (F-04). */
export interface ProfileWithCounts extends ProfileRow {
  ratingCount: number;
  favoriteCount: number;
}

export interface NewProfile {
  name: string;
  nameKey: string;
  avatar: string;
  createdAt: string;
}

export interface ProfileChanges {
  name: string;
  nameKey: string;
  avatar: string;
}

const COLUMNS = 'id, name, name_key AS nameKey, avatar, created_at AS createdAt';

/** All profiles in tile order (created_at, id) with their rating and favorite counts, in one statement. */
export function listProfiles(db: DB): ProfileWithCounts[] {
  return db
    .prepare(
      `SELECT p.id, p.name, p.name_key AS nameKey, p.avatar, p.created_at AS createdAt,
              (SELECT count(*) FROM ratings r   WHERE r.profile_id = p.id) AS ratingCount,
              (SELECT count(*) FROM favorites f WHERE f.profile_id = p.id) AS favoriteCount
         FROM profiles p
        ORDER BY p.created_at, p.id`,
    )
    .all() as ProfileWithCounts[];
}

export function getProfile(db: DB, id: number): ProfileRow | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
  return row ?? null;
}

export function findByNameKey(db: DB, nameKey: string): ProfileRow | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM profiles WHERE name_key = ?`).get(nameKey) as
    | ProfileRow
    | undefined;
  return row ?? null;
}

export function countProfiles(db: DB): number {
  const row = db.prepare('SELECT count(*) AS n FROM profiles').get() as { n: number };
  return row.n;
}

/** Avatar tokens in use, for picking the default color of a new profile. */
export function listAvatars(db: DB): string[] {
  return (
    db.prepare('SELECT avatar FROM profiles ORDER BY created_at, id').all() as Array<{ avatar: string }>
  ).map((row) => row.avatar);
}

/**
 * Profile ids are never handed out twice (F-05): a device that still sends the id of a deleted
 * profile must get 401 PROFILE_UNKNOWN instead of acting as a newer profile. profiles.id is an
 * INTEGER PRIMARY KEY without AUTOINCREMENT (migration 001), so SQLite alone would hand out
 * max(id) + 1 again after the newest profile was deleted. meta.profile_id_max remembers the
 * highest id ever used instead; max(id) covers rows inserted around the counter (older databases,
 * direct inserts in tests).
 */
const ID_COUNTER = 'profile_id_max';

function highestUsedProfileId(db: DB): number {
  return db
    .prepare(
      `SELECT max(coalesce((SELECT CAST(value AS INTEGER) FROM meta WHERE key = ?), 0),
                  coalesce((SELECT max(id) FROM profiles), 0))`,
    )
    .pluck()
    .get(ID_COUNTER) as number;
}

/** Reserves the next profile id and raises the counter. Runs inside the caller's insert transaction. */
export function allocateProfileId(db: DB): number {
  const id = highestUsedProfileId(db) + 1;
  setMeta(db, ID_COUNTER, String(id));
  return id;
}

/** Inserts with an id from allocateProfileId, so a deleted profile's id never comes back. Returns the new id. */
export function insertProfile(db: DB, profile: NewProfile): number {
  const id = allocateProfileId(db);
  db.prepare('INSERT INTO profiles (id, name, name_key, avatar, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    profile.name,
    profile.nameKey,
    profile.avatar,
    profile.createdAt,
  );
  return id;
}

/** Returns false when the profile does not exist. */
export function updateProfile(db: DB, id: number, changes: ProfileChanges): boolean {
  const result = db
    .prepare('UPDATE profiles SET name = ?, name_key = ?, avatar = ? WHERE id = ?')
    .run(changes.name, changes.nameKey, changes.avatar, id);
  return result.changes > 0;
}

/**
 * Ratings and favorites go with the profile (ON DELETE CASCADE); recipes stay, their
 * created_by/updated_by/deleted_by become NULL (ON DELETE SET NULL). Needs PRAGMA foreign_keys = ON.
 * Returns false when the profile does not exist.
 *
 * The id counter is raised to the highest used id first, so the deleted id stays reserved even when
 * the row was inserted without allocateProfileId. Runs inside the caller's transaction.
 */
export function deleteProfile(db: DB, id: number): boolean {
  setMeta(db, ID_COUNTER, String(highestUsedProfileId(db)));
  return db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0;
}
