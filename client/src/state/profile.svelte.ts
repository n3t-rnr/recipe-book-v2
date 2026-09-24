/**
 * Active profile (F-02, F-03): the id lives in localStorage "profileId" per device; the list comes from
 * GET /profiles. Every API request carries the id as X-Profile-Id (lib/api.ts reads it through a hook).
 * A server-side deleted profile (401 PROFILE_UNKNOWN) leaves the list at once, the list reloads, and the
 * active one leads back to the profile choice with a notice.
 */
import type { Profile, ProfilesResponse } from '../../../shared/types.ts';
import { de } from '../i18n/de.ts';
import { ApiError, get, setProfileSource, setProfileUnknownHandler } from '../lib/api.ts';
import { router } from '../lib/router.svelte.ts';
import { paths, safeNext } from '../lib/routes.ts';
import { connection } from './connection.svelte.ts';

const STORAGE_KEY = 'profileId';

function readStoredId(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const id = raw === null ? Number.NaN : Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function writeStoredId(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // Storage blocked: the choice holds until the page reloads.
  }
}

class ProfileState {
  /** Remembered profile id; null = no profile chosen on this device. */
  id = $state<number | null>(readStoredId());
  /** All profiles, sorted by the server. */
  list = $state.raw<Profile[]>([]);
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  error = $state.raw<ApiError | null>(null);
  /** One-time hint for the profile choice, e.g. "Profil nicht mehr vorhanden" (F-02). */
  notice = $state<string | null>(null);
  /** The active profile once the list is loaded. */
  current = $derived(this.list.find((p) => p.id === this.id) ?? null);

  /** Number of the newest load; an older answer arriving later is outdated and dropped. */
  #loads = 0;

  /**
   * True when the list never loaded or its last load failed (e.g. offline). A loaded list is never
   * older than the last 401 PROFILE_UNKNOWN: rejected() reloads, and older answers are dropped.
   */
  get stale(): boolean {
    return this.status === 'idle' || this.status === 'error';
  }

  /** Loads all profiles; drops a remembered id that no longer exists. Only the newest answer counts. */
  async load(): Promise<void> {
    const load = ++this.#loads;
    this.status = 'loading';
    try {
      // Without X-Profile-Id: a stale id must not turn this request into a 401.
      const res = await get<ProfilesResponse>('/profiles', { profile: false });
      if (load !== this.#loads) return;
      this.list = res.profiles;
      this.error = null;
      this.status = 'ready';
      if (this.id !== null && !res.profiles.some((p) => p.id === this.id)) this.forget(de.profile.gone);
    } catch (err) {
      if (load !== this.#loads) return;
      this.error = err instanceof ApiError ? err : new ApiError('INTERNAL', de.toast.actionFailed);
      this.status = 'error';
    }
  }

  /** Switches the active profile (F-03); views read `profile.id` and reload their per-profile data. */
  select(id: number): void {
    this.id = id;
    this.notice = null;
    writeStoredId(id);
  }

  /** Adds or replaces a profile after POST/PATCH /profiles. */
  upsert(p: Profile): void {
    const exists = this.list.some((x) => x.id === p.id);
    this.list = exists ? this.list.map((x) => (x.id === p.id ? p : x)) : [...this.list, p];
  }

  /** Removes a profile after DELETE /profiles/:id; forgets it when it was the active one. */
  remove(id: number): void {
    this.list = this.list.filter((p) => p.id !== id);
    if (this.id === id) this.forget();
  }

  /**
   * The server answered 401 PROFILE_UNKNOWN for `id` (F-02): deleted on another device. It leaves the
   * list at once and the list reloads; only the active profile leads back to the profile choice (a
   * request of the profile used before a switch must not drop the new one).
   */
  rejected(id: number): void {
    if (this.id === id) this.forget(de.profile.gone);
    this.remove(id);
    void this.load();
  }

  /** Forgets the active profile and opens the profile choice, keeping the current page as target. */
  forget(notice: string | null = null): void {
    this.id = null;
    this.notice = notice;
    writeStoredId(null);
    if (router.route.name !== 'profile') {
      router.navigate(paths.profile({ next: safeNext(router.url) }), { replace: true });
    }
  }
}

export const profile = new ProfileState();

setProfileSource(() => profile.id);
setProfileUnknownHandler((id) => profile.rejected(id));
// NF-09: a list that failed while the server was away (or went stale) loads again once it answers.
connection.onReconnect(() => {
  if (profile.stale) void profile.load();
});
