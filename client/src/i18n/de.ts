/**
 * All German UI texts (NF-10): informal "du", short and neutral labels. Components never contain
 * literal texts; they import from here. Functions build texts with numbers or names.
 */
import type { ErrorCode } from '../../../shared/error-codes.ts';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export const de = {
  appName: 'Rezepte',

  common: {
    back: 'Zurück',
    backTo: (target: string) => `Zurück zu ${target}`,
    close: 'Schließen',
    retry: 'Erneut versuchen',
    refresh: 'Aktualisieren',
    undo: 'Rückgängig',
    loading: 'Lädt …',
    moreActions: 'Weitere Aktionen',
    edit: 'Bearbeiten',
    cancel: 'Abbrechen',
    save: 'Speichern',
    optional: 'optional',
    required: 'Pflichtfeld',
  },

  nav: {
    main: 'Hauptnavigation',
    recipes: 'Rezepte',
    favorites: 'Favoriten',
    tags: 'Tags',
    more: 'Mehr',
    new: 'Neu',
    newRecipe: 'Neues Rezept',
  },

  /** Headings and document titles per route (Kap. 6.2). */
  titles: {
    profile: 'Wer kocht?',
    recipes: 'Rezepte',
    recipe: 'Rezept',
    recipeNew: 'Neues Rezept',
    recipeEdit: 'Rezept bearbeiten',
    favorites: 'Favoriten',
    tags: 'Tags',
    more: 'Mehr',
    connect: 'Anderes Gerät verbinden',
    trash: 'Papierkorb',
    status: 'Status',
    notFound: 'Nicht gefunden',
  },

  connection: {
    offline: 'Server nicht erreichbar – läuft der Rezepte-PC?',
    routeFailed: 'Die Seite konnte nicht geladen werden.',
  },

  profile: {
    switchTitle: 'Profil wechseln',
    switchLabel: (name: string) => `Profil wechseln, aktiv: ${name}`,
    chooseLabel: 'Profil wählen',
    active: 'aktiv',
    newProfile: 'Neues Profil',
    gone: 'Profil nicht mehr vorhanden',
    loadFailed: 'Die Profile konnten nicht geladen werden.',
    hint: 'Profile trennen nur Bewertungen und Favoriten – kein Passwort.',
  },

  recipe: {
    photo: (title: string) => `Foto: ${title}`,
    noPhoto: (title: string) => `Noch kein Foto: ${title}`,
    addPhoto: 'Foto hinzufügen',
    favorite: 'Favorit',
    notRated: 'Noch nicht bewertet',
    ratingSummary: (avg: string, count: number) =>
      `Durchschnitt ${avg} von 5 Sternen, ${count} ${plural(count, 'Bewertung', 'Bewertungen')}`,
    moreTags: (n: number) => `+${n}`,
    moreTagsLabel: (n: number) => `${n} ${plural(n, 'weiterer Tag', 'weitere Tags')}`,
    totalTime: (time: string) => `Gesamtzeit ${time}`,
  },

  /** Detail column at ≥ 1024 px while no recipe is selected. */
  detailPane: {
    title: 'Kein Rezept ausgewählt',
    text: 'Wähle links ein Rezept aus.',
  },

  notFound: {
    text: 'Diese Seite gibt es nicht.',
    toList: 'Zur Rezeptliste',
  },

  toast: {
    actionFailed: 'Das hat nicht geklappt.',
  },

  time: {
    today: 'heute',
    yesterday: 'gestern',
    daysAgo: (n: number) => `vor ${n} Tagen`,
    minutes: (m: number) => `${m} min`,
  },
} as const;

/** Client-side failures that have no server code. */
export type ClientErrorCode = 'NETWORK' | 'TIMEOUT';

/** German text for every server error code (Kap. 7.2) and the client-side failures (NF-10). */
export const ERROR_TEXTS: Record<ErrorCode | ClientErrorCode, string> = {
  VALIDATION: 'Bitte prüfe deine Eingaben.',
  BAD_REQUEST: 'Die Anfrage wurde abgelehnt. Lade die Seite neu und versuch es noch einmal.',
  PROFILE_REQUIRED: 'Bitte wähle zuerst ein Profil.',
  PROFILE_UNKNOWN: 'Profil nicht mehr vorhanden',
  NOT_FOUND: 'Nicht gefunden',
  IN_TRASH: 'Das Rezept liegt im Papierkorb.',
  VERSION_CONFLICT: 'Das Rezept wurde inzwischen geändert.',
  NAME_EXISTS: 'Name bereits vergeben',
  TAG_EXISTS: 'Diesen Tag gibt es schon.',
  LAST_PROFILE: 'Das letzte Profil kann nicht gelöscht werden.',
  NOT_IN_TRASH: 'Endgültig löschen geht nur im Papierkorb.',
  PAYLOAD_TOO_LARGE: 'Zu groß – Bilder dürfen höchstens 20 MB haben.',
  UNSUPPORTED_MEDIA: 'Nur JPEG, PNG oder WebP',
  MISDIRECTED: 'Unbekannte Adresse – öffne die App über die Adresse auf der Verbinden-Seite.',
  INTERNAL: 'Unerwarteter Fehler auf dem Server. Versuch es noch einmal.',
  IMAGES_UNAVAILABLE: 'Die Bildverarbeitung ist gerade nicht verfügbar.',
  READ_ONLY: 'Datenbank beschädigt – nur Lesen möglich',
  INSUFFICIENT_STORAGE: 'Der Speicher auf dem Rezepte-PC ist fast voll.',
  NETWORK: 'Server nicht erreichbar – läuft der Rezepte-PC?',
  TIMEOUT: 'Das dauert zu lange',
};
