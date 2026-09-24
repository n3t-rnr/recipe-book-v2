import type { Context, MiddlewareHandler } from 'hono';
import { PROFILE_HEADER } from '../../shared/constants.ts';
import type { PersonRef } from '../../shared/types.ts';
import { getProfile } from '../db/repos/profiles.ts';
import { AppError } from '../errors.ts';
import type { AppDeps, AppEnv } from '../types.ts';

const ID_PATTERN = /^[1-9][0-9]{0,15}$/;

/** Parses a positive integer id (header or path parameter); anything else, including "007", is null. */
export function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !ID_PATTERN.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Acting profile from X-Profile-Id, the only source of identity (F-05).
 * No header → profile null (reads work without a profile). A header that is present but malformed or
 * names a profile that does not exist (any more) → 401 PROFILE_UNKNOWN, on reads too (Kap. 7.1).
 */
export function profileContext(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.header(PROFILE_HEADER);
    if (raw === undefined) {
      c.set('profile', null);
      return next();
    }

    const id = parseId(raw);
    if (id === null) throw new AppError('PROFILE_UNKNOWN', 'Unbekanntes Profil');

    let row: ReturnType<typeof getProfile>;
    try {
      row = getProfile(deps.db, id);
    } catch (err) {
      // Read-only mode (NF-19): a damaged profiles table must not take health, revision and reads down.
      // Writes are already refused by the client guard, so no identity is ever needed here.
      if (deps.state.db !== 'corrupt') throw err;
      deps.log.warn('profile lookup failed in read-only mode', { requestId: c.get('requestId'), err });
      c.set('profile', null);
      return next();
    }
    if (!row) throw new AppError('PROFILE_UNKNOWN', 'Profil nicht mehr vorhanden');

    c.set('profile', { id: row.id, name: row.name });
    return next();
  };
}

/** Returns the acting profile or throws 401 PROFILE_REQUIRED (F-05). */
export function requireProfile(c: Context<AppEnv>): PersonRef {
  const profile = c.get('profile');
  if (!profile) throw new AppError('PROFILE_REQUIRED', 'Bitte zuerst ein Profil wählen');
  return profile;
}
