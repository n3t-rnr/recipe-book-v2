/**
 * German texts of the tag page /tags (NF-10, F-19, F-20, Kap. 6.3 „Tags“): list, search, „Neuer Tag“,
 * row menu, rename, merge and delete. Same rules as de.ts (informal "du", typographic dashes and quotes);
 * names in texts stand in ‚…‘ as in the F-19 AKs. Only the lazily loaded tag page imports this file (NF-01).
 */

/** "1 Rezept", "7 Rezepte"; `many` also for the dative plural („Von 4 Rezepten“). */
function recipes(n: number, many = 'Rezepte'): string {
  return `${n} ${n === 1 ? 'Rezept' : many}`;
}

export const dt = {
  search: 'Tags durchsuchen',
  newTag: 'Neuer Tag',
  list: 'Tags mit Anzahl der Rezepte',
  /** Accessible name of a row's ⋮ button. */
  menu: (name: string) => `Aktionen für ‚${name}‘`,
  /** Meta line of the row menu. */
  recipes: (count: number) => (count === 0 ? 'Kein Rezept' : recipes(count)),
  rename: 'Umbenennen',
  merge: 'Zusammenführen mit …',
  delete: 'Löschen',
  /** Accessible name of the name field (rename and „Neuer Tag“). */
  name: 'Name des Tags',
  create: 'Anlegen',
  nameMissing: 'Bitte gib einen Namen ein.',
  nameTooLong: (max: number) => `Ein Tag darf höchstens ${max} Zeichen lang sein.`,
  renamed: (from: string, to: string) => `‚${from}‘ heißt jetzt ‚${to}‘`,
  mergeTitle: (name: string) => `‚${name}‘ zusammenführen mit …`,
  /** F-19 AK: „‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte betroffen“ (title plus affected()). */
  mergeQuestion: (from: string, into: string) => `‚${from}‘ in ‚${into}‘ zusammenführen?`,
  affected: (count: number) => (count === 0 ? 'Kein Rezept betroffen' : `${recipes(count)} betroffen`),
  mergeConfirm: 'Zusammenführen',
  merged: (from: string, into: string) => `‚${from}‘ mit ‚${into}‘ zusammengeführt`,
  deleteTitle: (name: string) => `‚${name}‘ löschen?`,
  /** F-19 AK: „Von 4 Rezepten entfernen?“ – only the links go, the recipes stay. */
  deleteText: (count: number) =>
    count === 0
      ? 'Kein Rezept verwendet diesen Tag.'
      : `Von ${recipes(count, 'Rezepten')} entfernen? Die Rezepte bleiben erhalten.`,
  deleted: (name: string) => `Tag ‚${name}‘ gelöscht`,
  created: (name: string) => `Tag ‚${name}‘ angelegt`,
  exists: (name: string) => `‚${name}‘ gibt es schon`,
  noMatch: (q: string) => `Kein Tag gefunden für ‚${q}‘`,
  createNamed: (q: string) => `Tag ‚${q}‘ anlegen`,
  emptyTitle: 'Noch keine Tags',
  emptyText: 'Leg einen Tag an oder vergib Tags beim Bearbeiten eines Rezepts.',
  loading: 'Tags werden geladen',
  gone: 'Diesen Tag gibt es nicht mehr.',
} as const;
