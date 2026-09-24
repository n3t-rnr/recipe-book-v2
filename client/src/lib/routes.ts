/**
 * Route table (Kap. 6.2) and the pure parts of the router: path matching, query building, redirects.
 * No DOM access, so tests/unit/router.test.ts runs it in Node; router.svelte.ts adds history handling.
 */
import { de } from '../i18n/de.ts';

export type NavItem = 'recipes' | 'favorites' | 'tags' | 'more';

export interface RouteMeta {
  pattern: string;
  /** Active navigation item (bottom nav or rail). */
  nav: NavItem | null;
  /** Navigation chrome at all (the profile choice is full screen). */
  chrome: boolean;
  /** Floating bottom navigation below 1024 px. */
  bottomNav: boolean;
  /** "Neues Rezept" FAB below 1024 px (Rezepte and Favoriten only, Kap. 6.2). */
  fab: boolean;
  /** List and detail side by side from 1024 px (NF-08). */
  twoPane: boolean;
  /** The screen has its own fixed bottom bar (save bar, "Bearbeiten"); toasts sit above it. */
  bottomBar: 'never' | 'phone' | 'always';
  /** Without a remembered profile the route opens the profile choice first (F-02). */
  needsProfile: boolean;
}

const base = {
  nav: null,
  chrome: true,
  bottomNav: true,
  fab: false,
  twoPane: false,
  bottomBar: 'never',
  needsProfile: true,
} as const satisfies Omit<RouteMeta, 'pattern'>;

/** Order matters only for readability: literal segments never collide with the numeric :id. */
export const ROUTES = {
  root: { ...base, pattern: '/', chrome: false, bottomNav: false, needsProfile: false },
  profile: { ...base, pattern: '/profil', chrome: false, bottomNav: false, needsProfile: false },
  recipes: { ...base, pattern: '/rezepte', nav: 'recipes', fab: true, twoPane: true },
  recipeNew: { ...base, pattern: '/rezepte/neu', nav: 'recipes', bottomNav: false, bottomBar: 'always' },
  recipe: {
    ...base,
    pattern: '/rezepte/:id',
    nav: 'recipes',
    bottomNav: false,
    twoPane: true,
    bottomBar: 'phone',
  },
  recipeEdit: {
    ...base,
    pattern: '/rezepte/:id/bearbeiten',
    nav: 'recipes',
    bottomNav: false,
    bottomBar: 'always',
  },
  favorites: { ...base, pattern: '/favoriten', nav: 'favorites', fab: true, twoPane: true },
  tags: { ...base, pattern: '/tags', nav: 'tags' },
  more: { ...base, pattern: '/mehr', nav: 'more' },
  connect: { ...base, pattern: '/mehr/verbinden', nav: 'more', needsProfile: false },
  trash: { ...base, pattern: '/mehr/papierkorb', nav: 'more' },
  status: { ...base, pattern: '/mehr/status', nav: 'more', needsProfile: false },
} as const satisfies Record<string, RouteMeta>;

export type RouteName = keyof typeof ROUTES | 'notFound';

export const NOT_FOUND_META: RouteMeta = { ...base, pattern: '', needsProfile: false };

export function routeMeta(name: RouteName): RouteMeta {
  return name === 'notFound' ? NOT_FOUND_META : ROUTES[name];
}

export interface RouteMatch {
  name: RouteName;
  /** Decoded path parameters, e.g. { id: '42' }. */
  params: Readonly<Record<string, string>>;
  /** Normalized pathname (no trailing slash except "/"). */
  path: string;
}

/** Parameter rules: IDs are positive INTEGERs (Kap. 4). */
const PARAM_RULES: Readonly<Record<string, RegExp>> = {
  id: /^[1-9]\d{0,15}$/,
};

const COMPILED = (Object.keys(ROUTES) as Array<keyof typeof ROUTES>).map((name) => ({
  name,
  segments: ROUTES[name].pattern.split('/').slice(1),
}));

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Matches a pathname against the route table; unknown or malformed paths give "notFound". */
export function matchPath(pathname: string): RouteMatch {
  const path = normalizePath(pathname);
  const notFound: RouteMatch = { name: 'notFound', params: {}, path };
  let segments: string[];
  try {
    segments = path === '/' ? [''] : path.split('/').slice(1).map(decodeURIComponent);
  } catch {
    return notFound;
  }
  for (const route of COMPILED) {
    if (route.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = route.segments.every((part, i) => {
      const value = segments[i] ?? '';
      if (!part.startsWith(':')) return part === value;
      const name = part.slice(1);
      const rule = PARAM_RULES[name];
      if (rule && !rule.test(value)) return false;
      params[name] = value;
      return true;
    });
    if (ok) return { name: route.name, params, path };
  }
  return notFound;
}

/** Numeric :id of a match, or null. */
export function idParam(match: RouteMatch): number | null {
  const raw = match.params.id;
  if (raw === undefined) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type QueryInput = Readonly<Record<string, QueryValue>>;

function encode(value: string): string {
  // Commas stay readable in lists such as tags=3,7 (Kap. 6.2); URLSearchParams decodes both forms.
  return encodeURIComponent(value).replace(/%2C/gi, ',');
}

/**
 * Query string without "?": skips null, undefined, "", false and empty arrays; true becomes "1";
 * arrays are joined with commas. Keys keep their insertion order.
 */
export function buildQuery(query: QueryInput): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === false || value === '') continue;
    let text: string;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      text = value.join(',');
    } else {
      text = value === true ? '1' : String(value);
    }
    parts.push(`${encode(key)}=${encode(text)}`);
  }
  return parts.join('&');
}

export function buildUrl(path: string, query?: QueryInput): string {
  const q = query ? buildQuery(query) : '';
  return q === '' ? path : `${path}?${q}`;
}

/** URL builders for links and navigate(); screens never concatenate paths themselves. */
export const paths = {
  root: '/',
  profile: (query?: { next?: string | null; neu?: boolean }) => buildUrl('/profil', query),
  recipes: (query?: QueryInput) => buildUrl('/rezepte', query),
  recipeNew: (query?: { title?: string }) => buildUrl('/rezepte/neu', query),
  recipe: (id: number) => `/rezepte/${id}`,
  recipeEdit: (id: number) => `/rezepte/${id}/bearbeiten`,
  favorites: (query?: QueryInput) => buildUrl('/favoriten', query),
  tags: '/tags',
  more: '/mehr',
  connect: '/mehr/verbinden',
  trash: '/mehr/papierkorb',
  status: '/mehr/status',
} as const;

/**
 * Validates a "next" target after the profile choice: only app paths of this origin, never the
 * profile page itself or an unknown route (no open redirect).
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  const pathname = value.split(/[?#]/, 1)[0] ?? '';
  const match = matchPath(pathname);
  if (match.name === 'notFound' || match.name === 'profile' || match.name === 'root') return null;
  return value;
}

/**
 * Redirect for a resolved location (F-02): "/" goes to the list, or to the profile choice when no
 * profile is remembered; routes that need a profile go to the profile choice with a "next" target.
 */
export function redirectFor(match: RouteMatch, url: string, hasProfile: boolean): string | null {
  if (match.name === 'root') return hasProfile ? paths.recipes() : paths.profile();
  if (!hasProfile && routeMeta(match.name).needsProfile) return paths.profile({ next: url });
  return null;
}

/** Document title per route; detail and editor screens refine it with the recipe title. */
export function titleFor(name: RouteName): string {
  if (name === 'root' || name === 'recipes') return de.appName;
  return `${de.titles[name]} – ${de.appName}`;
}
