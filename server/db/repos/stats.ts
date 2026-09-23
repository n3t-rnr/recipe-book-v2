import type { DB } from '../types.ts';

export interface Counts {
  /** Active recipes (not in the trash). */
  recipes: number;
  trash: number;
  images: number;
  profiles: number;
  tags: number;
}

/** One statement for all counters shown by /health and the status page (F-42). */
export function getCounts(db: DB): Counts {
  return db
    .prepare(
      `SELECT
         (SELECT count(*) FROM recipes WHERE deleted_at IS NULL)     AS recipes,
         (SELECT count(*) FROM recipes WHERE deleted_at IS NOT NULL) AS trash,
         (SELECT count(*) FROM images)                               AS images,
         (SELECT count(*) FROM profiles)                             AS profiles,
         (SELECT count(*) FROM tags)                                 AS tags`,
    )
    .get() as Counts;
}
