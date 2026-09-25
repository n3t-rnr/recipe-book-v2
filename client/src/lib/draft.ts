/**
 * Draft storage of the editor (F-09): the form is written to localStorage under "draft:new" or
 * "draft:<id>" together with a timestamp, and offered for restoration when the editor opens again.
 * Storage may be blocked or full (private mode, quota), so every access is guarded and failures only
 * cost the safety net, never the form. The payload is parsed by the caller (lib/editor.ts, zod), so
 * this module stays generic and DOM-free for the unit tests.
 */

/** The part of the Web Storage API the drafts need; tests pass an in-memory fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

export const DRAFT_PREFIX = 'draft:';
/** Drafts older than this are dropped silently (the images of drafts expire after 7 days, F-09/M3). */
export const DRAFT_MAX_AGE_MS = 30 * 86_400_000;
const FORMAT_VERSION = 1;

export interface StoredDraft<T> {
  /** ISO 8601 UTC time of the last write. */
  savedAt: string;
  data: T;
}

/** "draft:new" for a new recipe, "draft:<id>" while editing recipe <id> (F-09). */
export function draftKey(recipeId: number | null): string {
  return recipeId === null ? `${DRAFT_PREFIX}new` : `${DRAFT_PREFIX}${recipeId}`;
}

/** localStorage when the browser allows it, otherwise null (drafts are then simply not kept). */
export function browserStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

/** Writes a draft; returns false when storage is unavailable or full. */
export function writeDraft(storage: StorageLike | null, key: string, data: unknown, now: Date): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ v: FORMAT_VERSION, savedAt: now.toISOString(), data }));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage: nothing was stored either.
  }
}

function isExpired(savedAt: string, now: Date, maxAgeMs: number): boolean {
  const time = Date.parse(savedAt);
  return Number.isNaN(time) || now.getTime() - time > maxAgeMs;
}

/**
 * Reads a draft and parses its payload with `parse`. Unreadable, foreign or expired drafts are removed
 * and give null, so a broken entry never blocks the editor.
 */
export function readDraft<T>(
  storage: StorageLike | null,
  key: string,
  parse: (data: unknown) => T | null,
  now: Date,
  maxAgeMs: number = DRAFT_MAX_AGE_MS,
): StoredDraft<T> | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  const savedAt = record?.savedAt;
  if (!record || record.v !== FORMAT_VERSION || typeof savedAt !== 'string') {
    removeDraft(storage, key);
    return null;
  }
  if (isExpired(savedAt, now, maxAgeMs)) {
    removeDraft(storage, key);
    return null;
  }
  const data = parse(record.data);
  if (data === null) {
    removeDraft(storage, key);
    return null;
  }
  return { savedAt, data };
}

/** Keeps one editor's stored draft in step with its form (F-09); see draftSync. */
export interface DraftSync {
  /** The form differs from its start: writes the draft unless this payload was the last one written. */
  keep(data: unknown, now: Date): void;
  /** The form is back at its start: removes the draft, if one may be stored. */
  drop(): void;
  /**
   * A draft this sync did not write may be stored (a restored one, or one written for a form that was
   * replaced since): the next keep() rewrites it, the next drop() removes it.
   */
  adopt(): void;
}

/**
 * drop() touches the storage only when a draft may be there: one this sync wrote, or one it adopted.
 * Adopting matters for a restored draft that holds no change any more, e.g. once its expired photo left
 * the form (F-09 AK): without it, the draft would stay and be offered again on every visit.
 */
export function draftSync(storage: StorageLike | null, key: string): DraftSync {
  /** JSON of the last payload written; '' when an adopted draft may be stored; null when none is. */
  let last: string | null = null;
  return {
    keep(data, now) {
      const json = JSON.stringify(data);
      if (json !== last && writeDraft(storage, key, data, now)) last = json;
    },
    drop() {
      if (last === null) return;
      removeDraft(storage, key);
      last = null;
    },
    adopt() {
      last = '';
    },
  };
}

/** Removes expired drafts of other recipes (abandoned edits); returns the number removed. */
export function pruneDrafts(
  storage: StorageLike | null,
  now: Date,
  maxAgeMs: number = DRAFT_MAX_AGE_MS,
): number {
  if (!storage || typeof storage.key !== 'function' || typeof storage.length !== 'number') return 0;
  const expired: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(DRAFT_PREFIX)) continue;
      const raw = storage.getItem(key);
      let savedAt: unknown = null;
      try {
        savedAt = raw === null ? null : (JSON.parse(raw) as Record<string, unknown> | null)?.savedAt;
      } catch {
        savedAt = null;
      }
      if (typeof savedAt !== 'string' || isExpired(savedAt, now, maxAgeMs)) expired.push(key);
    }
  } catch {
    return 0;
  }
  for (const key of expired) removeDraft(storage, key);
  return expired.length;
}
