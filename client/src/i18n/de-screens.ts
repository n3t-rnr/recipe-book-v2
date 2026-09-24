/**
 * German texts of the screens in the entry chunk (NF-10): recipe list and favorites. Same rules as de.ts
 * (informal "du", typographic dashes). Texts of lazily loaded screens are in de-screens-lazy.ts, so the
 * entry chunk only carries what the first view needs (NF-01).
 */
export const ds = {
  list: {
    count: (n: number) => `${n.toLocaleString('de-DE')} ${n === 1 ? 'Rezept' : 'Rezepte'}`,
    emptyTitle: 'Noch keine Rezepte',
    emptyText: 'Leg dein erstes Rezept an. Mit Foto geht es am schnellsten.',
    emptyAction: 'Erstes Rezept anlegen',
  },

  favorites: {
    empty: 'Noch keine Favoriten – tippe bei einem Rezept auf das Herz',
  },
} as const;
