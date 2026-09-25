/**
 * German texts of the screens in the entry chunk (NF-10): recipe list and favorites. Same rules as de.ts
 * (informal "du", typographic dashes). Texts of lazily loaded screens are in de-screens-lazy.ts (and the
 * filter sheet's in de-screens-filter.ts), so the entry chunk only carries what the first view needs (NF-01).
 */
const count = (n: number): string => n.toLocaleString('de-DE');

export const ds = {
  list: {
    count: (n: number) => `${count(n)} ${n === 1 ? 'Rezept' : 'Rezepte'}`,
    /** Filtered list (F-24, artboard Main): „14 von 38 Rezepten“. */
    countOf: (n: number, all: number) => `${count(n)} von ${count(all)} ${all === 1 ? 'Rezept' : 'Rezepten'}`,
    emptyTitle: 'Noch keine Rezepte',
    emptyText: 'Leg dein erstes Rezept an. Mit Foto geht es am schnellsten.',
    emptyAction: 'Erstes Rezept anlegen',
    // Search row (Kap. 6.3, artboard Main): field, clear icon, filter button with the number of filters.
    search: 'Suchen',
    searchPlaceholder: 'Rezepte, Zutaten, Tags suchen',
    clearSearch: 'Suchbegriff löschen',
    filter: (n: number) => (n > 0 ? `Filter, ${n} aktiv` : 'Filter'),
    chips: 'Nach Tags filtern',
    allTags: 'Alle Tags …',
    /** Visually hidden before the sort name of the sort button: „Sortierung: Neueste“. */
    sortPrefix: 'Sortierung: ',
    sorts: { relevance: 'Relevanz', newest: 'Neueste', title: 'Titel A–Z' },
  },

  favorites: {
    empty: 'Noch keine Favoriten – tippe bei einem Rezept auf das Herz',
  },
} as const;
