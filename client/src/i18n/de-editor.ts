/**
 * German texts of the recipe editor (NF-10): informal "du", short and neutral labels. Kept apart from
 * de.ts so they load with the lazy editor chunk only (NF-01); tests/unit/editor-texts.test.ts applies
 * the same wording rules as the de.ts test.
 */

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export const deEditor = {
  titleNew: 'Neues Rezept',
  titleEdit: 'Rezept bearbeiten',
  documentTitle: (title: string) => `${title} bearbeiten`,
  back: 'Zurück',
  required: 'Pflichtfeld',
  save: 'Speichern',
  cancel: 'Abbrechen',

  title: {
    label: 'Titel',
    placeholder: 'z. B. Käsespätzle',
    missing: 'Bitte gib einen Titel ein.',
  },

  tags: {
    label: 'Tags',
    placeholder: 'Tag hinzufügen …',
    hint: 'Enter oder Komma fügt den Tag hinzu.',
    remove: (tag: string) => `${tag} entfernen`,
    removed: (tag: string) => `Tag „${tag}“ entfernt`,
    limit: (max: number) => `Höchstens ${max} Tags pro Rezept`,
    tooLong: (max: number) => `Ein Tag darf höchstens ${max} Zeichen lang sein.`,
  },

  ingredients: {
    heading: 'Zutaten',
    amount: 'Menge',
    unit: 'Einheit',
    name: 'Zutat',
    note: 'Notiz',
    row: (n: number) => `Zutat ${n}`,
    move: 'Zutat verschieben',
    menu: 'Zeilenmenü: verschieben, entfernen',
    groupMenu: 'Gruppenmenü: verschieben, entfernen',
    group: 'Gruppenname',
    groupPlaceholder: 'Gruppe, z. B. Für den Teig',
    addIngredient: 'Zutat',
    addIngredientLabel: 'Zutat hinzufügen',
    addGroup: 'Gruppe',
    addGroupLabel: 'Gruppe hinzufügen',
    removed: 'Zutat entfernt',
    groupRemoved: 'Gruppe entfernt',
    amountInvalid: 'Menge nicht lesbar – z. B. 200, 1,5, ½ oder 2–3',
    nameMissing: 'Bitte gib die Zutat ein.',
    limit: (max: number) => `Höchstens ${max} Zutaten pro Rezept`,
  },

  steps: {
    heading: 'Zubereitung',
    step: (n: number) => `Schritt ${n}`,
    placeholder: 'Beschreibe diesen Schritt …',
    menu: 'Schrittmenü: verschieben, entfernen',
    add: 'Schritt',
    addLabel: 'Schritt hinzufügen',
    removed: 'Schritt entfernt',
    limit: (max: number) => `Höchstens ${max} Schritte pro Rezept`,
  },

  menu: {
    ingredient: 'Zutat',
    group: 'Gruppe',
    step: (n: number) => `Schritt ${n}`,
    position: (pos: number, total: number) => `Position ${pos} von ${total}`,
    up: 'Nach oben',
    down: 'Nach unten',
    remove: 'Entfernen',
  },

  more: {
    heading: 'Weitere Angaben',
    summary: 'Portionen, Zeiten, Quelle, Beschreibung',
    servings: 'Portionen',
    servingsUnit: 'Einheit',
    prep: 'Vorbereitung (min)',
    cook: 'Koch-/Backzeit (min)',
    source: 'Quelle',
    sourcePlaceholder: 'z. B. Omas Kochbuch, S. 12',
    description: 'Beschreibung',
    servingsInvalid: 'Bitte gib eine Zahl wie 4 oder 1,5 ein.',
    minutesInvalid: 'Bitte gib ganze Minuten ein.',
    defaultServingsUnit: 'Portionen',
  },

  /** Unit suggestions of F-10 (datalist of the unit field). */
  unitSuggestions: [
    'g',
    'kg',
    'ml',
    'l',
    'EL',
    'TL',
    'Stück',
    'Prise',
    'Bund',
    'Zehe',
    'Dose',
    'Packung',
    'Tasse',
    'Scheibe',
    'Msp.',
  ],
  /** Servings unit suggestions of F-06. */
  servingsUnitSuggestions: ['Portionen', 'Stück', 'Personen'],

  saving: {
    failed: 'Speichern fehlgeschlagen',
    retry: 'Erneut versuchen',
  },

  discard: {
    title: 'Änderungen verwerfen?',
    text: 'Deine Eingaben gehen verloren.',
    confirm: 'Verwerfen',
    keep: 'Weiter bearbeiten',
  },

  draft: {
    title: (when: string) => `Entwurf ${when} wiederherstellen?`,
    text: 'Deine letzten Eingaben wurden automatisch gesichert.',
    restore: 'Wiederherstellen',
    discard: 'Verwerfen',
    today: (time: string) => `von heute, ${time}`,
    yesterday: (time: string) => `von gestern, ${time}`,
    date: (date: string, time: string) => `vom ${date}, ${time}`,
  },

  conflict: {
    title: (name: string | null) =>
      name === null ? 'Inzwischen auf einem anderen Gerät geändert' : `Inzwischen von ${name} geändert`,
    text: (name: string | null) =>
      `${name ?? 'Jemand'} hat das Rezept gespeichert, während du bearbeitet hast. Deine Eingaben bleiben erhalten.`,
    reload: 'Neu laden',
    force: 'Meine Version speichern',
    reloaded: 'Aktuelle Fassung geladen – deine Änderungen sind markiert.',
    mark: 'Du hattest das geändert:',
    takeOver: 'Meine Änderung übernehmen',
    empty: '(leer)',
    none: '(keine)',
    ingredients: (n: number) => `${n} ${plural(n, 'Zutat', 'Zutaten')}`,
    steps: (n: number) => `${n} ${plural(n, 'Schritt', 'Schritte')}`,
  },

  trash: {
    title: (name: string | null) =>
      name === null
        ? 'In den Papierkorb gelegt – wiederherstellen und speichern?'
        : `Von ${name} in den Papierkorb gelegt – wiederherstellen und speichern?`,
    text: 'Deine Eingaben bleiben erhalten.',
    confirm: 'Wiederherstellen und speichern',
    cancel: 'Abbrechen',
  },

  gone: {
    title: 'Rezept nicht mehr vorhanden',
    text: 'Es wurde endgültig gelöscht. Deine Eingaben sind noch da.',
    saveAsNew: 'Als neues Rezept speichern',
    cancel: 'Abbrechen',
  },

  load: {
    notFound: 'Rezept nicht gefunden',
    notFoundText: 'Vielleicht wurde es endgültig gelöscht.',
    toList: 'Zur Rezeptliste',
    inTrash: (name: string | null, when: string) =>
      name === null ? `Im Papierkorb (gelöscht ${when})` : `Im Papierkorb (gelöscht von ${name} ${when})`,
    restore: 'Wiederherstellen',
    failed: 'Das Rezept konnte nicht geladen werden.',
    retry: 'Erneut versuchen',
    busy: 'Rezept wird geladen …',
    on: (date: string) => `am ${date}`,
  },
} as const;
