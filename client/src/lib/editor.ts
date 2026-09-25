/**
 * Form model of the recipe editor (F-06, F-07, F-09, F-10, F-11) as pure functions: form to API input
 * and back, validation with the shared zod/mini schemas (NF-28), dirty tracking, the field diff of the
 * conflict merge, tag handling, reordering helpers and the draft payload. No DOM access, so tests run
 * in Node.
 * Together with shared/schemas.ts this is the only client module importing zod/mini; it is reachable
 * from the lazy editor chunk only (NF-02, NF-01).
 */
import * as z from 'zod/mini';
import { LIMITS } from '../../../shared/constants.ts';
import type { ValidationDetail } from '../../../shared/error-codes.ts';
import { normalize } from '../../../shared/normalize.ts';
import { RecipeCreateInput, RecipeUpdateInput } from '../../../shared/schemas.ts';
import type { DetailImage, RecipeDetail } from '../../../shared/types.ts';
import { toValidationDetails } from '../../../shared/validation.ts';
import { deEditor } from '../i18n/de-editor.ts';
import { formatAbsoluteDate, formatDate, formatDecimal, formatMinutes, parseAmount } from './format.ts';

// zod compiles object parsers with `new Function` when it may; the probe alone is reported as a CSP
// violation (script-src without 'unsafe-eval', Kap. 7.8). jitless skips probe and compiler.
z.config({ jitless: true });

// ---------------------------------------------------------------- form model

export interface IngredientItem {
  kind: 'ingredient';
  /** Stable key for {#each} and error mapping; never sent to the server. */
  key: string;
  /** Raw text as typed: "1,5", "1/2", "½", "2–3" (parsed on save, F-10). */
  amount: string;
  unit: string;
  name: string;
  note: string;
}

/** Group heading ("Für den Teig"); every following ingredient belongs to it (F-10). */
export interface GroupItem {
  kind: 'group';
  key: string;
  name: string;
}

export type ListItem = IngredientItem | GroupItem;

export interface StepItem {
  key: string;
  text: string;
}

export interface EditorForm {
  title: string;
  tags: string[];
  /** Ingredients and group headings in display order. */
  items: ListItem[];
  steps: StepItem[];
  servings: string;
  servingsUnit: string;
  prepMinutes: string;
  cookMinutes: string;
  source: string;
  description: string;
  /**
   * The photo (F-14): id plus URLs and size for the preview, so a draft shows it again (F-09); null = none.
   * Saving sends only the id (imageId); PUT replaces the recipe, so an unchanged photo is sent back.
   */
  image: DetailImage | null;
}

/** The fields compared in the conflict merge (F-07); lists count as one field each. */
export const FIELDS = [
  'image',
  'title',
  'tags',
  'ingredients',
  'steps',
  'servings',
  'servingsUnit',
  'prepMinutes',
  'cookMinutes',
  'source',
  'description',
] as const;
export type FieldName = (typeof FIELDS)[number];

let keySeq = 0;

/** Keys are unique within one page load; restored drafts get fresh keys (cloneForm with rekey). */
export function newKey(): string {
  keySeq += 1;
  return `k${keySeq}`;
}

export function emptyIngredient(): IngredientItem {
  return { kind: 'ingredient', key: newKey(), amount: '', unit: '', name: '', note: '' };
}

export function emptyGroup(name = ''): GroupItem {
  return { kind: 'group', key: newKey(), name };
}

export function emptyStep(text = ''): StepItem {
  return { key: newKey(), text };
}

/** A new recipe starts with one empty ingredient row and one empty step (quick entry). */
export function newForm(title = ''): EditorForm {
  return {
    title: title.trim().slice(0, LIMITS.recipeTitle),
    tags: [],
    items: [emptyIngredient()],
    steps: [emptyStep()],
    servings: '',
    servingsUnit: deEditor.more.defaultServingsUnit,
    prepMinutes: '',
    cookMinutes: '',
    source: '',
    description: '',
    image: null,
  };
}

function cloneImage(image: DetailImage | null): DetailImage | null {
  return image && { ...image, urls: { ...image.urls } };
}

/** Deep copy; `rekey` assigns fresh keys (drafts, taking over lists in the conflict merge). */
export function cloneForm(form: EditorForm, rekey = false): EditorForm {
  return {
    title: form.title,
    tags: [...form.tags],
    items: form.items.map((item) => ({ ...item, key: rekey ? newKey() : item.key })),
    steps: form.steps.map((step) => ({ key: rekey ? newKey() : step.key, text: step.text })),
    servings: form.servings,
    servingsUnit: form.servingsUnit,
    prepMinutes: form.prepMinutes,
    cookMinutes: form.cookMinutes,
    source: form.source,
    description: form.description,
    image: cloneImage(form.image),
  };
}

// ---------------------------------------------------------------- numbers as editable text

/** Fractions shown as glyphs in the editor, only when the value is exact (no rounding on save). */
const EDIT_FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];
const EXACT = 1e-9;

/** Shortest decimal text with a comma; parseAmount reads it back to the same number. */
function plainNumber(n: number): string {
  const text = String(n);
  return /e/i.test(text) ? formatDecimal(n, 6) : text.replace('.', ',');
}

/**
 * Editable text for a stored amount: exact ¼ ⅓ ½ ⅔ ¾ as glyphs ("1 ½"), everything else as a decimal
 * with a comma. Unlike formatAmount (display, ±0.01) this never rounds, so an untouched row keeps its
 * value when the recipe is saved again.
 */
export function amountText(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  for (const [value, glyph] of EDIT_FRACTIONS) {
    if (Math.abs(frac - value) < EXACT) return whole > 0 ? `${whole} ${glyph}` : glyph;
  }
  return plainNumber(n);
}

/** "2–3" for a range, "" without an amount. */
export function amountRangeText(amount: number | null, amountMax: number | null): string {
  if (amount === null) return '';
  return amountMax === null ? amountText(amount) : `${amountText(amount)}–${amountText(amountMax)}`;
}

/** Form values of a loaded recipe (edit mode, "Neu laden" in the conflict dialog). */
export function formFromDetail(detail: RecipeDetail): EditorForm {
  const items: ListItem[] = [];
  let group = '';
  for (const ing of detail.ingredients) {
    if (ing.group !== group) {
      items.push(emptyGroup(ing.group));
      group = ing.group;
    }
    items.push({
      kind: 'ingredient',
      key: newKey(),
      amount: amountRangeText(ing.amount, ing.amountMax),
      unit: ing.unit,
      name: ing.name,
      note: ing.note,
    });
  }
  if (!items.some((item) => item.kind === 'ingredient')) items.push(emptyIngredient());
  const steps = detail.steps.map((step) => emptyStep(step.text));
  return {
    title: detail.title,
    tags: detail.tags.map((tag) => tag.name),
    items,
    steps: steps.length > 0 ? steps : [emptyStep()],
    servings: detail.servings === null ? '' : plainNumber(detail.servings),
    servingsUnit: detail.servingsUnit,
    prepMinutes: detail.prepMinutes === null ? '' : String(detail.prepMinutes),
    cookMinutes: detail.cookMinutes === null ? '' : String(detail.cookMinutes),
    source: detail.source,
    description: detail.description,
    image: cloneImage(detail.image),
  };
}

// ---------------------------------------------------------------- dirty tracking and conflict diff

export function isBlankIngredient(item: IngredientItem): boolean {
  return (
    item.amount.trim() === '' && item.unit.trim() === '' && item.name.trim() === '' && item.note.trim() === ''
  );
}

export function countIngredients(items: readonly ListItem[]): number {
  return items.reduce((n, item) => (item.kind === 'ingredient' ? n + 1 : n), 0);
}

/** "1,5", "1 ½" and "1.5" are the same amount; unreadable text compares as text. */
function canonicalAmount(text: string): unknown {
  const parsed = parseAmount(text);
  return parsed ? [parsed.amount, parsed.amountMax] : text.trim();
}

/** "020" and "20" are the same minutes; unreadable text compares as text. */
function canonicalMinutes(text: string): unknown {
  const t = text.trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : t;
}

/**
 * Tags as the server keeps them: a set by normalize() (F-17). The server returns them in its own order
 * and keeps the display name of an existing tag ("vegetarisch" comes back as "Vegetarisch").
 */
function canonicalTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => normalize(tag)).filter((key) => key !== ''))].sort();
}

/**
 * What would be saved, per field: trimmed texts, parsed amounts, the tag set, without empty rows,
 * empty steps and group headings without ingredients. Adding an empty row, retyping "1,5" as "1 ½" or
 * reordering tags is no change.
 */
function canonicalFields(form: EditorForm): Record<FieldName, unknown> {
  const ingredients: unknown[] = [];
  let group = '';
  for (const item of form.items) {
    if (item.kind === 'group') {
      group = item.name.trim();
      continue;
    }
    if (isBlankIngredient(item)) continue;
    ingredients.push([
      group,
      canonicalAmount(item.amount),
      item.unit.trim(),
      item.name.trim(),
      item.note.trim(),
    ]);
  }
  return {
    image: form.image?.id ?? null,
    title: form.title.trim(),
    tags: canonicalTags(form.tags),
    ingredients,
    steps: form.steps.map((step) => step.text.trim()).filter((text) => text !== ''),
    servings: canonicalAmount(form.servings),
    servingsUnit: form.servingsUnit.trim() || deEditor.more.defaultServingsUnit,
    prepMinutes: canonicalMinutes(form.prepMinutes),
    cookMinutes: canonicalMinutes(form.cookMinutes),
    source: form.source.trim(),
    description: form.description.trim(),
  };
}

/** Comparable fingerprint of the form; dirty = fingerprint differs from the loaded state (F-09). */
export function formKey(form: EditorForm): string {
  return JSON.stringify(canonicalFields(form));
}

/** Fields whose saved value differs between `base` and `other` (F-07: the fields changed locally). */
export function diffFields(base: EditorForm, other: EditorForm): FieldName[] {
  const a = canonicalFields(base);
  const b = canonicalFields(other);
  return FIELDS.filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]));
}

/** "Meine Änderung übernehmen" (F-07): copies one field from `source` into `target` (mutates target). */
export function applyField(target: EditorForm, field: FieldName, source: EditorForm): void {
  switch (field) {
    case 'ingredients':
      target.items = source.items.map((item) => ({ ...item, key: newKey() }));
      break;
    case 'steps':
      target.steps = source.steps.map((step) => emptyStep(step.text));
      break;
    case 'tags':
      target.tags = [...source.tags];
      break;
    case 'image':
      target.image = cloneImage(source.image);
      break;
    default:
      target[field] = source[field];
  }
}

function shorten(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/gu, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine;
}

/** Short description of a field value for the conflict marks ("3 Zutaten", "Vegetarisch, Suppe"). */
export function fieldPreview(form: EditorForm, field: FieldName): string {
  switch (field) {
    case 'ingredients':
      return deEditor.conflict.ingredients(
        form.items.filter((i) => i.kind === 'ingredient' && !isBlankIngredient(i)).length,
      );
    case 'steps':
      return deEditor.conflict.steps(form.steps.filter((s) => s.text.trim() !== '').length);
    case 'tags':
      return form.tags.length > 0 ? shorten(form.tags.join(', ')) : deEditor.conflict.none;
    case 'image':
      return form.image ? deEditor.photo.otherPhoto : deEditor.photo.noPhoto;
    case 'prepMinutes':
    case 'cookMinutes': {
      const text = form[field].trim();
      if (text === '') return deEditor.conflict.empty;
      return /^\d+$/.test(text) ? formatMinutes(Number(text)) : shorten(text);
    }
    default: {
      const text = form[field].trim();
      return text === '' ? deEditor.conflict.empty : shorten(text);
    }
  }
}

// ---------------------------------------------------------------- tags

export interface TagAddResult {
  tags: string[];
  /** Parts that could not be added (too long, over the limit); the input keeps them. */
  rejected: string[];
  error: string | null;
}

/**
 * Invisible control characters other than whitespace (pasted text): a tag name may not contain any
 * (SINGLE_LINE in shared/schemas.ts), so the chip input drops them instead of keeping a name that saving
 * would refuse (NF-28). Tab and line breaks count as whitespace and become a space.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the regex exists to drop control characters
const TAG_CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F]/gu;

/**
 * Adds the comma-separated names of `raw` (Enter or comma in the chip input), or each name of an array
 * whole: a picked suggestion may contain a comma (F-17 allows punctuation, the tag page can create
 * "Salz, Pfeffer"), which must stay one tag. Whitespace is collapsed, control characters dropped,
 * duplicates by normalize() collapse into the existing chip ("süßspeise" = "Süssspeise", F-17), at most
 * 20 tags with 40 characters each. A name whose key is in `canonical` (key → display name of the tags on
 * the server, lib/tag-match.ts tagNamesByKey) shows that name at once: "süßspeise" becomes "Süßspeise",
 * as the server would keep it on saving.
 */
export function addTags(
  tags: readonly string[],
  raw: string | readonly string[],
  canonical?: ReadonlyMap<string, string>,
): TagAddResult {
  const next = [...tags];
  const keys = new Set(next.map((tag) => normalize(tag)));
  const rejected: string[] = [];
  let error: string | null = null;
  for (const part of typeof raw === 'string' ? raw.split(',') : raw) {
    const name = part.replace(TAG_CONTROL, '').replace(/\s+/gu, ' ').trim();
    if (name === '') continue;
    const key = normalize(name);
    if (key === '' || keys.has(key)) continue;
    if (name.length > LIMITS.tagName) {
      rejected.push(name);
      error = deEditor.tags.tooLong(LIMITS.tagName);
      continue;
    }
    if (next.length >= LIMITS.tagsPerRecipe) {
      rejected.push(name);
      error = deEditor.tags.limit(LIMITS.tagsPerRecipe);
      continue;
    }
    next.push(canonical?.get(key) ?? name);
    keys.add(key);
  }
  return { tags: next, rejected, error };
}

/** What a key does in the tag field (TagInput.svelte, a combobox with a suggestion list, F-18). */
export type TagKeyAction = 'next' | 'prev' | 'pick' | 'add' | 'close';

/** The parts of a KeyboardEvent that decide a TagKeyAction (no DOM types: the tests run in Node). */
export interface TagKey {
  key: string;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Key handling of the tag field (F-18, NF-11). No suggestion is marked until ArrowDown or ArrowUp, so
 * Enter adds the typed text ('add') unless one is marked ('pick'); a comma picks the marked suggestion,
 * otherwise it goes through the input like on a virtual keyboard. Escape closes the list. Ctrl/Cmd+Enter
 * and every key of a running input method stay null: the form saves (and commits the text itself).
 * The caller calls preventDefault for every non-null action.
 */
export function tagKeyAction(e: TagKey, expanded: boolean, active: number): TagKeyAction | null {
  if (e.isComposing) return null;
  const marked = expanded && active >= 0;
  switch (e.key) {
    case 'ArrowDown':
      return expanded ? 'next' : null;
    case 'ArrowUp':
      return expanded ? 'prev' : null;
    case 'Enter':
      if (e.ctrlKey || e.metaKey) return null;
      return marked ? 'pick' : 'add';
    case ',':
      return marked ? 'pick' : null;
    case 'Escape':
      return expanded ? 'close' : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- reordering

/** Moves one entry (mutates the list, also a Svelte $state proxy); false when nothing moved. */
export function moveItem<T>(list: T[], from: number, to: number): boolean {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  if (item === undefined) return false;
  list.splice(to, 0, item);
  return true;
}

export interface RowRect {
  top: number;
  height: number;
}

/**
 * Target index while dragging a row (NF-07: the drag handle; the row menu is the button alternative):
 * the dragged row passes another row once its center crosses that row's center.
 */
export function dropIndex(rects: readonly RowRect[], from: number, center: number): number {
  let to = from;
  for (let i = from + 1; i < rects.length; i++) {
    const r = rects[i];
    if (r && center > r.top + r.height / 2) to = i;
  }
  if (to !== from) return to;
  for (let i = from - 1; i >= 0; i--) {
    const r = rects[i];
    if (r && center < r.top + r.height / 2) to = i;
  }
  return to;
}

/** Offsets of the other rows while the dragged row hovers over index `to` (they make room). */
export function dragShift(index: number, from: number, to: number, distance: number): number {
  if (to > from && index > from && index <= to) return -distance;
  if (to < from && index >= to && index < from) return distance;
  return 0;
}

// ---------------------------------------------------------------- building the request

/** UI error keys: field names, "item:<key>:<part>", "step:<key>", "ingredients", "steps", "image", "form". */
export type FieldErrors = Record<string, string>;
export type ItemPart = 'amount' | 'unit' | 'name' | 'note' | 'group';

export const errorKey = {
  item: (key: string, part: ItemPart) => `item:${key}:${part}`,
  step: (key: string) => `step:${key}`,
};

/** Input index → form row, to map zod and server errors ("ingredients.2.name") back to fields. */
export interface FieldMap {
  ingredientKeys: string[];
  /** Key of the group heading each ingredient belongs to (its "group" value), or null. */
  groupKeys: Array<string | null>;
  stepKeys: string[];
}

export type SaveContext = { kind: 'create'; createKey: string } | { kind: 'update'; version: number };

export type BuildResult =
  | { ok: true; body: RecipeCreateInput | RecipeUpdateInput; map: FieldMap }
  | { ok: false; errors: FieldErrors; map: FieldMap };

/** Portionen: empty = not set; a single number, no range. undefined = unreadable. */
function parseServings(text: string): number | null | undefined {
  const parsed = parseAmount(text);
  if (parsed === null || parsed.amountMax !== null) return undefined;
  return parsed.amount;
}

/** Whole minutes; empty = not set; undefined = unreadable. The schema checks 1–1440. */
function parseMinutes(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  return /^\d{1,6}$/.test(t) ? Number(t) : undefined;
}

const SCALAR_FIELDS: ReadonlySet<string> = new Set(
  FIELDS.filter((f) => f !== 'ingredients' && f !== 'steps' && f !== 'image'),
);

function errorKeyForPath(field: string, map: FieldMap): string {
  const [head = '', index, part] = field.split('.');
  if (head === 'ingredients') {
    const i = index === undefined ? -1 : Number(index);
    const key = map.ingredientKeys[i];
    if (key === undefined) return 'ingredients';
    if (part === 'group') {
      const groupKey = map.groupKeys[i];
      return groupKey ? errorKey.item(groupKey, 'group') : 'ingredients';
    }
    if (part === 'amount' || part === 'amountMax') return errorKey.item(key, 'amount');
    if (part === 'unit' || part === 'note') return errorKey.item(key, part);
    return errorKey.item(key, 'name');
  }
  if (head === 'steps') {
    const key = index === undefined ? undefined : map.stepKeys[Number(index)];
    return key === undefined ? 'steps' : errorKey.step(key);
  }
  // Unknown or taken imageId (Kap. 4.6): the photo is gone, the editor drops it (F-09).
  if (head === 'imageId') return 'image';
  return SCALAR_FIELDS.has(head) ? head : 'form';
}

/** Maps validation details (local zod run or a server 400) to UI error keys; first message wins. */
export function mapDetails(details: readonly ValidationDetail[], map: FieldMap): FieldErrors {
  const errors: FieldErrors = {};
  for (const detail of details) {
    const key = errorKeyForPath(detail.field, map);
    if (!(key in errors)) errors[key] = detail.message;
  }
  return errors;
}

/** Reads `details` of a 400 VALIDATION response; anything unexpected gives []. */
export function validationDetails(details: unknown): ValidationDetail[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((d: unknown) => {
    if (typeof d !== 'object' || d === null) return [];
    const { field, message } = d as Record<string, unknown>;
    return typeof field === 'string' && typeof message === 'string' ? [{ field, message }] : [];
  });
}

/**
 * Builds the request body from the form and validates it with the shared schema (F-06, F-10, F-11):
 * empty ingredient rows and empty steps are dropped, amounts are parsed ("1,5", "½", "2–3"), group
 * headings become the ingredients' group. Errors come back per UI field with German messages.
 */
export function buildRequest(form: EditorForm, ctx: SaveContext): BuildResult {
  const errors: FieldErrors = {};
  const put = (key: string, message: string): void => {
    if (!(key in errors)) errors[key] = message;
  };
  const map: FieldMap = { ingredientKeys: [], groupKeys: [], stepKeys: [] };

  if (form.title.trim() === '') put('title', deEditor.title.missing);

  const ingredients: Array<Record<string, unknown>> = [];
  let group = '';
  let groupKey: string | null = null;
  for (const item of form.items) {
    if (item.kind === 'group') {
      group = item.name;
      groupKey = item.key;
      continue;
    }
    if (isBlankIngredient(item)) continue;
    const parsed = parseAmount(item.amount);
    if (parsed === null) put(errorKey.item(item.key, 'amount'), deEditor.ingredients.amountInvalid);
    if (item.name.trim() === '') put(errorKey.item(item.key, 'name'), deEditor.ingredients.nameMissing);
    ingredients.push({
      group,
      amount: parsed?.amount ?? null,
      amountMax: parsed?.amountMax ?? null,
      unit: item.unit,
      name: item.name,
      note: item.note,
    });
    map.ingredientKeys.push(item.key);
    map.groupKeys.push(groupKey);
  }

  const steps: Array<{ text: string }> = [];
  for (const step of form.steps) {
    if (step.text.trim() === '') continue;
    steps.push({ text: step.text });
    map.stepKeys.push(step.key);
  }

  const servings = parseServings(form.servings);
  if (servings === undefined) put('servings', deEditor.more.servingsInvalid);
  const prepMinutes = parseMinutes(form.prepMinutes);
  if (prepMinutes === undefined) put('prepMinutes', deEditor.more.minutesInvalid);
  const cookMinutes = parseMinutes(form.cookMinutes);
  if (cookMinutes === undefined) put('cookMinutes', deEditor.more.minutesInvalid);

  const fields = {
    title: form.title,
    description: form.description,
    servings: servings ?? null,
    servingsUnit: form.servingsUnit.trim() || deEditor.more.defaultServingsUnit,
    prepMinutes: prepMinutes ?? null,
    cookMinutes: cookMinutes ?? null,
    source: form.source,
    ingredients,
    steps,
    tags: form.tags,
    imageId: form.image?.id ?? null,
  };

  let body: RecipeCreateInput | RecipeUpdateInput | null = null;
  if (ctx.kind === 'create') {
    const result = RecipeCreateInput.safeParse({ ...fields, createKey: ctx.createKey });
    if (result.success) body = result.data;
    else
      for (const [k, m] of Object.entries(mapDetails(toValidationDetails(result.error.issues), map)))
        put(k, m);
  } else {
    const result = RecipeUpdateInput.safeParse({ ...fields, version: ctx.version });
    if (result.success) body = result.data;
    else
      for (const [k, m] of Object.entries(mapDetails(toValidationDetails(result.error.issues), map)))
        put(k, m);
  }

  if (body === null || Object.keys(errors).length > 0) return { ok: false, errors, map };
  return { ok: true, body, map };
}

// ---------------------------------------------------------------- createKey (NF-09)

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/**
 * Idempotency key of one editor session (NF-09): a retry after a network failure sends the same key,
 * so the server answers with the recipe it already created. crypto.randomUUID needs a secure context,
 * which plain HTTP in the LAN is not (NF-26); getRandomValues works everywhere.
 */
export function newCreateKey(
  crypto: CryptoLike | undefined = (globalThis as { crypto?: CryptoLike }).crypto,
): string {
  if (typeof crypto?.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Not allowed here: fall through to getRandomValues.
    }
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What the editor does after POST /recipes answered (NF-09, F-09 AK "alle Eingaben bleiben erhalten").
 * A reused createKey returns the recipe an earlier attempt created, whose answer got lost (timeout,
 * network), or the one a restored draft had already created. If the user edited on in the meantime, that
 * recipe lacks the later input:
 * - 'saved': the recipe holds what was sent; done.
 * - 'update': it holds an earlier state and nobody changed it since it was created (version 1); switch
 *   to update mode and PUT the current form on top of it.
 * - 'conflict': it holds an earlier state and was changed since (by another device): the conflict
 *   dialog (F-07) decides.
 */
export type CreateOutcome = 'saved' | 'update' | 'conflict';

export function createOutcome(sent: EditorForm, recipe: RecipeDetail): CreateOutcome {
  if (formKey(formFromDetail(recipe)) === formKey(sent)) return 'saved';
  return recipe.version <= 1 ? 'update' : 'conflict';
}

// ---------------------------------------------------------------- drafts (F-09)

const ItemSchema = z.union([
  z.object({
    kind: z.literal('ingredient'),
    key: z.string(),
    amount: z.string(),
    unit: z.string(),
    name: z.string(),
    note: z.string(),
  }),
  z.object({ kind: z.literal('group'), key: z.string(), name: z.string() }),
]);

const ImageSchema = z.object({
  id: z.int(),
  urls: z.object({ s: z.string(), m: z.string(), l: z.string() }),
  width: z.int(),
  height: z.int(),
});

const FormSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  items: z.array(ItemSchema),
  steps: z.array(z.object({ key: z.string(), text: z.string() })),
  servings: z.string(),
  servingsUnit: z.string(),
  prepMinutes: z.string(),
  cookMinutes: z.string(),
  source: z.string(),
  description: z.string(),
  image: z.optional(z.nullable(ImageSchema)),
  /** Drafts written before M3 kept only the id; one without a photo is still usable. */
  imageId: z.optional(z.nullable(z.int())),
});

type StoredForm = z.infer<typeof FormSchema>;

/** A stored form as EditorForm with fresh keys; null for a pre-M3 draft whose photo URLs are unknown. */
function storedForm(stored: StoredForm): EditorForm | null {
  const { image, imageId, ...rest } = stored;
  if (image === undefined && typeof imageId === 'number') return null;
  return cloneForm({ ...rest, image: image ?? null }, true);
}

const DraftSchema = z.object({
  form: FormSchema,
  /** The loaded version the edit started from (edit mode); the conflict diff compares against it. */
  base: z.nullable(FormSchema),
  version: z.nullable(z.int()),
  /** New recipes keep their createKey, so a retry after a restore cannot create a duplicate. */
  createKey: z.nullable(z.string()),
  /** Pending "Meine Änderung übernehmen" offers after "Neu laden" (F-07). */
  conflict: z.nullable(z.object({ mine: FormSchema, fields: z.array(z.enum(FIELDS)) })),
});

export interface EditorDraft {
  form: EditorForm;
  base: EditorForm | null;
  version: number | null;
  createKey: string | null;
  conflict: { mine: EditorForm; fields: FieldName[] } | null;
}

/** Parses a stored draft (localStorage is a boundary: zod, not a cast); keys are renewed. */
export function parseEditorDraft(data: unknown): EditorDraft | null {
  const result = DraftSchema.safeParse(data);
  if (!result.success) return null;
  const d = result.data;
  const form = storedForm(d.form);
  const base = d.base ? storedForm(d.base) : null;
  const mine = d.conflict ? storedForm(d.conflict.mine) : null;
  if (!form || (d.base && !base) || (d.conflict && !mine)) return null;
  return {
    form,
    base,
    version: d.version,
    createKey: d.createKey,
    conflict: d.conflict && mine ? { mine, fields: [...d.conflict.fields] } : null,
  };
}

/**
 * F-09 AK: a restored draft may point to a photo the server has deleted meanwhile (unassigned uploads
 * expire after 7 days). Only a photo the draft added is checked; the recipe's own photo (`base`) belongs
 * to the saved version, which the conflict check guards. When the server answers "missing" and the form
 * still shows that photo, it is dropped from the form; returns true then, so the editor can say so.
 */
export async function verifyDraftImage(
  form: EditorForm,
  base: EditorForm | null,
  state: (id: number) => Promise<'present' | 'missing' | 'unknown'>,
): Promise<boolean> {
  const id = form.image?.id;
  if (id === undefined || id === base?.image?.id) return false;
  if ((await state(id)) !== 'missing' || form.image?.id !== id) return false;
  form.image = null;
  return true;
}

/** Marks the photo section (ImagePicker's root carries the attribute `data-photo`). */
export const PHOTO_SECTION = '[data-photo]';

/**
 * Where a failed save scrolls to and puts the focus (NF-11): the first invalid field or error message in
 * form order, apart from the photo section's hints (expired photo, file too large, failed upload, F-14).
 * They are no errors of the save; the photo comes first in the form and would take the jump away from
 * the field that needs fixing.
 */
export function firstError<T extends { closest(selector: string): unknown }>(
  candidates: Iterable<T>,
): T | undefined {
  for (const candidate of candidates) {
    if (!candidate.closest(PHOTO_SECTION)) return candidate;
  }
  return undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function calendarDays(date: Date, now: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** "von heute, 14:05", "von gestern, 09:30", "vom 12.03.2026, 18:00" for the draft prompt. */
export function draftWhen(savedAt: string, now: Date = new Date()): string {
  const date = new Date(savedAt);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const days = calendarDays(date, now);
  if (days === 0) return deEditor.draft.today(time);
  if (days === 1) return deEditor.draft.yesterday(time);
  return deEditor.draft.date(formatAbsoluteDate(date), time);
}

/** "heute", "vor 3 Tagen" or "am 12.03.2026" (NF-10) for "Im Papierkorb (gelöscht von Anna …)". */
export function deletedWhen(deletedAt: string, now: Date = new Date()): string {
  const text = formatDate(deletedAt, now);
  return /^\d{2}\.\d{2}\.\d{4}$/.test(text) ? deEditor.load.on(text) : text;
}
