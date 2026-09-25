/**
 * German texts of the lazily loaded screens (NF-10): profile choice, recipe detail, trash, "Mehr",
 * connect, status. The tag page has its own file (de-screens-tags.ts). Same rules as de.ts (informal
 * "du", typographic dashes and quotes). Functions build texts with numbers, names or dates.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const dl = {
  profilePick: {
    lead: 'Tippe auf deinen Namen.',
    leadEmpty: 'Leg zuerst dein Profil an.',
    name: 'Name',
    color: 'Farbe',
    colorLabel: (n: number) => `Farbe ${n}`,
    create: 'Profil anlegen',
  },

  person: {
    unknown: 'unbekannt',
    /** Prefix for an absolute date; relative dates ("heute", "vor 3 Tagen") stand alone. */
    on: (date: string) => `am ${date}`,
  },

  detail: {
    backToList: 'Zurück zu Rezepte',
    /** The photo opens full screen (F-29). */
    zoom: 'Foto vergrößern',
    prep: 'Vorbereitung',
    cook: 'Kochen',
    servings: 'Portionen',
    facts: 'Zeiten und Portionen',
    tags: 'Tags',
    ingredients: 'Zutaten',
    forServings: (amount: string, unit: string) => `für ${amount} ${unit}`,
    steps: 'Zubereitung',
    step: (n: number) => `Schritt ${n}`,
    /** Recipe without steps (F-11 AK), with a link to the editor. */
    stepsEmpty: 'Noch keine Zubereitung erfasst',
    stepsEmptyAction: 'Zubereitung ergänzen',
    source: 'Quelle',
    created: (name: string, when: string) => `Angelegt von ${name} ${when}`,
    updated: (name: string, when: string) => `geändert von ${name} ${when}`,
    toTrash: 'In den Papierkorb',
    deleted: 'Rezept gelöscht',
    restored: 'Rezept wiederhergestellt',
    inTrash: (name: string, when: string) => `Im Papierkorb (gelöscht von ${name} ${when})`,
    restore: 'Wiederherstellen',
    notFound: 'Rezept nicht gefunden',
    notFoundText: 'Vielleicht wurde es endgültig gelöscht.',
    loading: 'Rezept wird geladen',
  },

  trash: {
    intro: 'Gelöschte Rezepte bleiben 30 Tage hier. Danach werden sie endgültig gelöscht.',
    deletedBy: (name: string, when: string) => `Gelöscht von ${name} ${when}`,
    remaining: (days: number) =>
      days <= 0 ? 'wird heute endgültig gelöscht' : `noch ${plural(days, 'Tag', 'Tage')}`,
    restore: 'Wiederherstellen',
    purge: 'Endgültig löschen',
    confirmTitle: (title: string) => `„${title}“ endgültig löschen?`,
    confirmText: 'Das Rezept lässt sich danach nicht mehr wiederherstellen.',
    empty: 'Der Papierkorb ist leer',
    restored: (title: string) => `„${title}“ wiederhergestellt`,
    purged: (title: string) => `„${title}“ endgültig gelöscht`,
    open: 'Öffnen',
    loading: 'Papierkorb wird geladen',
  },

  more: {
    profile: 'Profil',
    noProfile: 'Kein Profil gewählt',
    choose: 'Profil wählen',
    switch: 'Profil wechseln',
    edit: 'Bearbeiten',
    delete: 'Profil löschen',
    counts: (ratings: number, favorites: number) =>
      `${plural(ratings, 'Bewertung', 'Bewertungen')} · ${plural(favorites, 'Favorit', 'Favoriten')}`,
    saved: 'Profil gespeichert',
    deleted: (name: string) => `Profil „${name}“ gelöscht`,
    deleteTitle: (name: string) => `Profil „${name}“ löschen?`,
    deleteText: (ratings: number, favorites: number) =>
      `Dabei gehen ${plural(ratings, 'Bewertung', 'Bewertungen')} und ${plural(favorites, 'Favorit', 'Favoriten')} verloren. Die Rezepte bleiben erhalten.`,
    app: 'Weiteres',
    trashHint: 'Gelöschte Rezepte wiederherstellen',
    connectHint: 'Adressen und QR-Code für Handy und Tablet',
    statusHint: 'Version und Zustand des Servers',
  },

  connect: {
    intro:
      'Öffne eine dieser Adressen im Browser deines Handys oder Tablets oder scanne den QR-Code mit der Kamera.',
    wifi: 'Das Gerät muss im selben WLAN sein wie der Rezepte-PC.',
    kinds: { public: 'Feste Adresse', ip: 'IP-Adresse', mdns: 'Gerätename' },
    qrCaption: (url: string) => `QR-Code für ${url}`,
    loading: 'Adressen werden geladen',
  },

  status: {
    server: 'Server',
    data: 'Daten',
    state: 'Zustand',
    states: { ok: 'Alles in Ordnung', degraded: 'Eingeschränkt', 'read-only': 'Nur Lesen' },
    version: 'Version',
    uptime: 'Läuft seit',
    database: 'Datenbank',
    databaseStates: { ok: 'In Ordnung', corrupt: 'Beschädigt – nur Lesen möglich' },
    images: 'Bildverarbeitung',
    imageStates: { ok: 'Bereit', unavailable: 'Nicht verfügbar' },
    recipes: 'Rezepte',
    trash: 'Im Papierkorb',
    imageCount: 'Bilder',
    profiles: 'Profile',
    tags: 'Tags',
    countsUnreadable: 'Nicht lesbar (Datenbank beschädigt)',
    counts: 'Zähler',
    lessThanMinute: 'unter 1 min',
    minutes: (m: number) => `${m} min`,
    hours: (h: number, m: number) => `${h} h ${m} min`,
    days: (d: number, h: number) => `${plural(d, 'Tag', 'Tage')} ${h} h`,
    loading: 'Status wird geladen',
  },
} as const;
