/**
 * Pure helpers of the tag page /tags (F-19): the client check of a tag name, guards for error details
 * of the tag API and the focus target after a row disappears (NF-11). No DOM, so tests run in Node.
 * Hand-written guards instead of zod: zod stays in the editor chunk (NF-02).
 */
import { LIMITS } from '../../../shared/constants.ts';
import type { TagExistsDetails } from '../../../shared/types.ts';
import { dt } from '../i18n/de-screens-tags.ts';

export type TagNameCheck = { name: string } | { error: string };

/**
 * Collapses whitespace and trims like the editor's tag input (addTags), then checks length 1–max
 * (F-17: 1–40 characters, counted like the server's schema). Other rules (control characters, a name
 * without letters or digits) stay with the server, whose message the form shows inline.
 */
export function checkTagName(raw: string, max: number = LIMITS.tagName): TagNameCheck {
  const name = raw.replace(/\s+/gu, ' ').trim();
  if (name === '') return { error: dt.nameMissing };
  if (name.length > max) return { error: dt.nameTooLong(max) };
  return { name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** details of 409 TAG_EXISTS (PATCH /tags/:id), or null when they are missing or malformed. */
export function readTagExists(details: unknown): TagExistsDetails | null {
  if (!isRecord(details)) return null;
  const { targetId, targetName, affectedRecipes } = details;
  if (!isCount(targetId) || targetId < 1) return null;
  if (typeof targetName !== 'string' || targetName.trim() === '') return null;
  if (!isCount(affectedRecipes)) return null;
  return { targetId, targetName, affectedRecipes };
}

/**
 * Message for the name field after 400 VALIDATION: the first detail's message (Kap. 7.2:
 * details = [{ field, message }]), else `fallback` (the error's own message).
 */
export function fieldMessage(details: unknown, fallback: string): string {
  const first: unknown = Array.isArray(details) ? details[0] : undefined;
  if (isRecord(first) && typeof first.message === 'string' && first.message.trim() !== '') {
    return first.message;
  }
  return fallback;
}

/**
 * The row that takes the focus when the row `id` disappears (delete, merge): the next one, else the
 * previous one; null when `id` was the only row (then the search field takes it) or is not in `rows`.
 */
export function neighbourId(rows: ReadonlyArray<{ id: number }>, id: number): number | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return null;
  return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
}
