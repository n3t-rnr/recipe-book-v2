/**
 * German texts of the filter sheet and the list without hits (NF-10), loaded with those lazy chunks only
 * (NF-01). Same rules as de.ts; quotes around a search term are ‚…‘ as in Kap. 6.6.
 */
export const df = {
  title: 'Filter',
  close: 'Filter schließen',
  hits: (n: number) => `${n.toLocaleString('de-DE')} Treffer`,
  tags: 'Tags',
  tagSearch: 'Tags durchsuchen',
  tagNone: 'Kein Tag gefunden',
  tagsEmpty: 'Noch keine Tags',
  mode: 'Tag-Verknüpfung',
  modes: { all: 'Alle müssen passen', any: 'Einer reicht' },
  sort: 'Sortierung',
  reset: 'Filter zurücksetzen',
  // Kap. 6.6 „Suche ohne Treffer“ (F-23, F-33).
  noHits: (q: string) => `Nichts gefunden für ‚${q}‘`,
  noHitsFiltered: 'Keine Rezepte mit diesen Filtern',
  didYouMean: 'Meintest du:',
  create: (q: string) => `Rezept ‚${q}‘ anlegen`,
} as const;
