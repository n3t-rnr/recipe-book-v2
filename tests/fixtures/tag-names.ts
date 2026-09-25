/**
 * Tag names shared by the editor tests and the tag API tests (F-17, NF-28): a name the editor accepts
 * never gets a 400 from the server, and a name the server refuses never reaches it from the editor.
 * Control characters and the combining mark are written as \u escapes so they stay visible in the source.
 */

/** Accepted by TagInput and by the editor; each has a non-empty normalized key (Kap. 4.4). */
export const VALID_TAG_NAMES: readonly string[] = [
  'Süßspeise',
  'Schnell & einfach',
  'Für Gäste',
  'Low-Carb',
  '3-Gänge-Menü',
  'Omas Klassiker',
  'x'.repeat(40),
];

/**
 * Refused with 400 VALIDATION, field 'name'. All but the last fail the schema (empty, only spaces,
 * 41 characters, tab, line feed, BEL). The last one, a lone combining acute accent, passes the schema
 * but normalizes to an empty key, so the server refuses it after normalize.
 */
export const INVALID_TAG_NAMES: readonly string[] = [
  '',
  '   ',
  'x'.repeat(41),
  'Tab\u0009Tag',
  'Zeile\u000AUmbruch',
  '\u0007',
  '́',
];
