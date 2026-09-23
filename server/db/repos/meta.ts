import type { DB } from '../types.ts';

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function getDataRevision(db: DB): number {
  return Number(getMeta(db, 'data_revision') ?? '0');
}

/** Increments meta.data_revision after a successful write (F-36) and returns the new value. */
export function bumpDataRevision(db: DB): number {
  const row = db
    .prepare(
      "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'data_revision' RETURNING value",
    )
    .get() as { value: string } | undefined;
  if (row) return Number(row.value);
  setMeta(db, 'data_revision', '1');
  return 1;
}
