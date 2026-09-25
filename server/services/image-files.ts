import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IMAGE_VARIANTS } from '../../shared/constants.ts';
import type { AppDeps } from '../types.ts';

/**
 * File layout of the image store (Kap. 4.6): DATA_DIR/images/<file_key>-{s,m,l}.webp, flat, plus
 * images/.trash/ for files that lost their row (F-16). Everything that turns a file key into a path
 * lives here, so no other module builds image paths by hand.
 */

export type ImageVariant = keyof typeof IMAGE_VARIANTS;

/** Order in which variants are written and moved; l first, so a partial write never leaves only small files. */
export const VARIANT_NAMES: readonly ImageVariant[] = ['l', 'm', 's'];

/** file_key = 16 lower-case hex characters from crypto.randomBytes(8) (Kap. 4.6). */
export const FILE_KEY_PATTERN = /^[0-9a-f]{16}$/;

/** The only file names /media delivers (NF-21). */
export const MEDIA_FILE_PATTERN = /^[0-9a-f]{16}-(s|m|l)\.webp$/;

/** A fresh key per upload: URLs never change their content, so they may be cached as immutable. */
export function newFileKey(): string {
  return randomBytes(8).toString('hex');
}

export function variantFileName(fileKey: string, variant: ImageVariant): string {
  return `${fileKey}-${variant}.webp`;
}

/** Public URL of one image variant (Kap. 7.5, served by /media). */
export function mediaUrl(fileKey: string, variant: ImageVariant): string {
  return `/media/${variantFileName(fileKey, variant)}`;
}

export function mediaUrls(fileKey: string): { s: string; m: string; l: string } {
  return { s: mediaUrl(fileKey, 's'), m: mediaUrl(fileKey, 'm'), l: mediaUrl(fileKey, 'l') };
}

/** Deletes a file and ignores every error: used for temp files, whose leftovers the maintenance removes. */
export function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // e.g. EBUSY on Windows while a virus scanner holds the file; tmp/ is cleaned hourly (Kap. 4.6).
  }
}

export interface FileMove {
  from: string;
  to: string;
}

/**
 * Renames all files or none (F-15: "atomar schreiben"). Synchronous on purpose: together with the
 * DB insert that follows it runs in one tick, so no maintenance run can see the files without their
 * row and move them to .trash as orphans. Targets must not exist yet (fresh file key); on a failure
 * the already moved files are removed again and the error is rethrown.
 */
export function moveAllOrNothing(moves: readonly FileMove[]): void {
  const done: string[] = [];
  try {
    for (const move of moves) {
      fs.renameSync(move.from, move.to);
      done.push(move.to);
    }
  } catch (err) {
    for (const file of done) removeQuietly(file);
    throw err;
  }
}

/**
 * Moves <file_key>-{s,m,l}.webp from images/ to images/.trash/ (Kap. 4.6, F-16). Runs after the
 * commit that removed the rows: missing files are skipped, other failures are only logged, because
 * the database change already happened and the weekly cleanup moves leftovers. The modification
 * time is set to now so the 14-day retention in .trash starts here. Returns the number of moved files.
 */
export function moveImageFilesToTrash(
  deps: Pick<AppDeps, 'paths' | 'log' | 'now'>,
  fileKeys: readonly string[],
): number {
  if (fileKeys.length === 0) return 0;
  const { paths, log } = deps;
  try {
    fs.mkdirSync(paths.imagesTrash, { recursive: true });
  } catch (err) {
    log.warn('image trash folder not writable', { dir: paths.imagesTrash, err });
    return 0;
  }
  const now = deps.now();
  let moved = 0;
  for (const key of fileKeys) {
    // Anything else never becomes part of a path.
    if (!FILE_KEY_PATTERN.test(key)) {
      log.warn('image file key skipped', { fileKey: key });
      continue;
    }
    for (const variant of VARIANT_NAMES) {
      const file = variantFileName(key, variant);
      const target = path.join(paths.imagesTrash, file);
      try {
        fs.renameSync(path.join(paths.images, file), target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
          log.warn('image file move failed', { file, err });
        continue;
      }
      moved++;
      try {
        fs.utimesSync(target, now, now);
      } catch {
        // The retention then counts from the upload time, which only shortens it.
      }
    }
  }
  if (moved > 0) log.info('image files moved to trash', { files: moved });
  return moved;
}
