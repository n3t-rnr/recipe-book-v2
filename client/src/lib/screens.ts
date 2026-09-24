/**
 * Pure helpers of the lazily loaded screens (detail, trash, status): texts built from API data. No DOM
 * and no network, so tests/unit/screens-helpers.test.ts runs them in Node.
 */
import type { IngredientDetail, InTrashDetails, PersonRef, RecipeDetail } from '../../../shared/types.ts';
import { dl } from '../i18n/de-screens-lazy.ts';
import { formatDate } from './format.ts';

const DAY_MS = 86_400_000;

/** Name of a person reference; "unbekannt" when the profile was deleted (F-29, F-04). */
export function personName(ref: PersonRef | null): string {
  return ref?.name ?? dl.person.unknown;
}

/**
 * Date in running text (NF-10): "am 12.03.2026", or the relative form alone within 7 days
 * ("heute", "gestern", "vor 3 Tagen"), so no "am heute" appears.
 */
export function onDate(iso: string, now: Date = new Date()): string {
  const text = formatDate(iso, now);
  return /^\d/.test(text) ? dl.person.on(text) : text;
}

/** "Angelegt von Sebastian am 12.03.2026 · geändert von Anna vor 3 Tagen" (F-29); unchanged recipes omit the second part. */
export function footerText(
  recipe: Pick<RecipeDetail, 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>,
  now: Date = new Date(),
): string {
  const created = dl.detail.created(personName(recipe.createdBy), onDate(recipe.createdAt, now));
  if (recipe.updatedAt === recipe.createdAt) return created;
  return `${created} · ${dl.detail.updated(personName(recipe.updatedBy), onDate(recipe.updatedAt, now))}`;
}

/** Whole days until the automatic purge, rounded up; 0 when it is due (F-08 "Resttage"). */
export function remainingDays(purgeAt: string, now: Date = new Date()): number {
  const ms = Date.parse(purgeAt) - now.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

export interface IngredientGroup {
  /** Group heading; "" for ingredients without a group (no heading, F-29). */
  group: string;
  items: IngredientDetail[];
}

/** Consecutive ingredients with the same group form one section; the order stays as stored (F-10). */
export function groupIngredients(ingredients: readonly IngredientDetail[]): IngredientGroup[] {
  const groups: IngredientGroup[] = [];
  for (const item of ingredients) {
    const group = item.group.trim();
    const last = groups.at(-1);
    if (last && last.group === group) last.items.push(item);
    else groups.push({ group, items: [item] });
  }
  return groups;
}

/** The source as a link target only when it starts with http:// or https:// (F-29, NF-21); else null. */
export function sourceHref(source: string): string | null {
  const value = source.trim();
  if (!/^https?:\/\/[^\s]/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** details of a 410 IN_TRASH answer (Kap. 7.2), checked instead of cast; null when malformed. */
export function parseInTrash(details: unknown): InTrashDetails | null {
  if (typeof details !== 'object' || details === null) return null;
  const { deletedAt, deletedBy } = details as Record<string, unknown>;
  if (typeof deletedAt !== 'string') return null;
  if (deletedBy === null) return { deletedAt, deletedBy: null };
  if (typeof deletedBy !== 'object' || deletedBy === undefined) return null;
  const { id, name } = deletedBy as Record<string, unknown>;
  if (typeof id !== 'number' || typeof name !== 'string') return null;
  return { deletedAt, deletedBy: { id, name } };
}

/** Server uptime for the status page: "unter 1 min", "12 min", "3 h 5 min", "2 Tage 4 h". */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return dl.status.lessThanMinute;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return dl.status.days(days, hours % 24);
  return hours > 0 ? dl.status.hours(hours, minutes % 60) : dl.status.minutes(minutes);
}
