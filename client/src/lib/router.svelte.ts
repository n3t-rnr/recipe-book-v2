/**
 * Mini router on the History API (Kap. 5.1, F-34): reactive route, params and query; link interception;
 * Back closes open sheets first; scroll positions per history entry in sessionStorage; redirects for
 * "/" and routes that need a profile (F-02). The route table and pure helpers live in routes.ts.
 */
import { tick } from 'svelte';
import { type HistoryUrls, parseUrls, pathBefore, recordUrl } from './history-urls.ts';
import {
  buildUrl,
  matchPath,
  paths,
  type QueryInput,
  type RouteMatch,
  redirectFor,
  titleFor,
} from './routes.ts';

interface EntryState {
  /** Identifies the history entry; scroll positions are stored under it. */
  key: string;
  /** Position within this app session; 0 = first entry (Back would leave the app). */
  idx: number;
  /** Extra entry pushed while a sheet or dialog is open (Back closes it). */
  overlay?: boolean;
}

export type ScrollArea = 'window' | 'list' | 'detail';
export type Positions = Partial<Record<ScrollArea, number>>;
export type NavigationKind = 'initial' | 'push' | 'replace' | 'pop';

export interface NavigateOptions {
  replace?: boolean;
  /** false keeps the scroll position (filter changes). Default: scroll to the top. */
  scroll?: boolean;
  /** false keeps the keyboard focus (typing in a search field). Default: focus the main content. */
  focus?: boolean;
}

const SCROLL_STORAGE_KEY = 'router:scroll';
const URLS_STORAGE_KEY = 'router:urls';
const SCROLL_ENTRIES = 50;
const RESTORE_WINDOW_MS = 2000;

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function readEntry(value: unknown): EntryState | null {
  if (typeof value !== 'object' || value === null) return null;
  const { key, idx, overlay } = value as Record<string, unknown>;
  if (typeof key !== 'string' || typeof idx !== 'number') return null;
  return overlay === true ? { key, idx, overlay: true } : { key, idx };
}

function currentUrl(): string {
  return location.pathname + location.search;
}

class Router {
  /** Current route match (name, decoded params, normalized path). */
  route = $state.raw<RouteMatch>({ name: 'notFound', params: {}, path: '/' });
  /** Query of the current URL (Kap. 6.2: q, tags, tagMode, fav, minRating, sort). */
  query = $state.raw<URLSearchParams>(new URLSearchParams());
  /** pathname + search of the current entry. */
  url = $state('/');
  /** The list shown next to the detail at ≥ 1024 px: the last list the user opened. */
  listContext = $state<'recipes' | 'favorites'>('recipes');
  /** Last navigation, for focus handling in the shell. */
  lastNavigation = $state.raw<{ kind: NavigationKind; focus: boolean; seq: number }>({
    kind: 'initial',
    focus: false,
    seq: 0,
  });

  #hasProfile: () => boolean = () => false;
  #entry: EntryState = { key: '', idx: 0 };
  #overlays: Array<{ id: number; close: () => void; pushed: boolean }> = [];
  #overlaySeq = 0;
  #ignorePops = 0;
  /** Stepping back over overlay entries left from before a reload (start). */
  #dropStale = false;
  #pendingBack: Promise<void> | null = null;
  #resolveBack: (() => void) | null = null;
  #scroll = new Map<string, Positions>();
  #urls: HistoryUrls = new Map();
  #areas = new Map<ScrollArea, HTMLElement>();
  #restore: { positions: Positions; until: number } | null = null;
  #started = false;

  /** Reads the current location and starts listening. Call once before mounting the app. */
  start(options: { hasProfile: () => boolean }): void {
    if (this.#started) return;
    this.#started = true;
    this.#hasProfile = options.hasProfile;
    history.scrollRestoration = 'manual';
    this.#loadScroll();

    const entry = readEntry(history.state);
    this.#entry = entry ? { key: entry.key, idx: entry.idx } : { key: newKey(), idx: 0 };
    if (entry?.overlay) {
      // Reloaded while a sheet or the editor's guard entry was current. No overlay is open after a
      // reload, so step back onto the page's own entry (same URL and key); otherwise a duplicate of
      // the page stays in the history and Back seems to do nothing.
      this.#entry.idx--;
      this.#dropStale = true;
      this.#stepBack();
      // No history step arrived (entry not reachable): continue normally.
      setTimeout(() => this.#dropStale && this.#settle(), 1000);
    } else {
      history.replaceState(this.#entry, '', location.href);
    }
    this.#apply(currentUrl(), 'initial', {});

    window.addEventListener('popstate', this.#onPopState);
    document.addEventListener('click', this.#onClick);
    window.addEventListener('pagehide', () => this.#saveScroll());
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) {
      window.addEventListener(type, this.#cancelRestore, { passive: true, capture: true });
    }
  }

  /** Navigates within the app; other origins load normally. Same URL replaces instead of pushing. */
  navigate(to: string, options: NavigateOptions = {}): void {
    const target = new URL(to, location.href);
    if (target.origin !== location.origin) {
      location.assign(target.href);
      return;
    }
    if (this.#pendingBack) {
      // A sheet just closed and its history entry is being removed; wait for that step first.
      void this.#pendingBack.then(() => this.navigate(to, options));
      return;
    }
    const url = target.pathname + target.search;
    let replace = options.replace === true || url === currentUrl();
    if (this.#overlays.length > 0) {
      // Leaving a page with an open sheet: the sheet's entry becomes the new page.
      this.#closeOverlaysSilently();
      replace = true;
    }
    this.#saveScroll();
    const idx = replace ? this.#entry.idx : this.#entry.idx + 1;
    this.#entry = { key: newKey(), idx };
    if (replace) history.replaceState(this.#entry, '', url);
    else history.pushState(this.#entry, '', url);
    this.#apply(url, replace ? 'replace' : 'push', options);
  }

  /** Updates the query of the current route (filters, search); keeps scroll position and focus. */
  setQuery(query: QueryInput, options: { replace?: boolean } = {}): void {
    this.navigate(buildUrl(this.route.path, query), {
      replace: options.replace ?? true,
      scroll: false,
      focus: false,
    });
  }

  /**
   * Back button of sub-views (F-34): closes an open sheet first; otherwise goes back in history, or to
   * `fallback` when the view was opened directly (deep link, iOS shortcut without browser bar).
   */
  back(fallback: string = paths.recipes()): void {
    const top = this.#overlays.at(-1);
    if (top) {
      top.close();
      return;
    }
    if (this.#entry.idx > 0) history.back();
    else this.navigate(fallback, { replace: true });
  }

  /**
   * Path of the history entry below the current one (where Back leads), or null. Works without the
   * Navigation API: the router records the URL per history position (lib/history-urls.ts).
   */
  previousPath(): string | null {
    return pathBefore(this.#urls, this.#entry.idx);
  }

  /**
   * Registers an open sheet or dialog: pushes a history entry so the Android back button or the iOS
   * back gesture closes it and the page stays (F-34). Call the returned function when it closes.
   */
  pushOverlay(close: () => void): () => void {
    const overlay = { id: ++this.#overlaySeq, close, pushed: false };
    this.#overlays.push(overlay);
    const push = (): void => {
      if (!this.#overlays.includes(overlay)) return; // closed before its entry existed
      this.#entry = { key: this.#entry.key, idx: this.#entry.idx + 1, overlay: true };
      history.pushState(this.#entry, '', location.href);
      this.#remember(true);
      overlay.pushed = true;
    };
    // A previous sheet's entry may still be on its way out; push after that step.
    if (this.#pendingBack) void this.#pendingBack.then(push);
    else push();
    return () => this.#releaseOverlay(overlay.id);
  }

  /** Scroll containers besides the window (list and detail column at ≥ 1024 px). */
  registerScrollArea(area: Exclude<ScrollArea, 'window'>, el: HTMLElement): () => void {
    this.#areas.set(area, el);
    return () => {
      if (this.#areas.get(area) === el) this.#areas.delete(area);
    };
  }

  /**
   * Screens call this after their data rendered, so a pending Back restores the position (F-34). With
   * `positions`: scrolls areas there as soon as the content allows (layout switch when a tablet rotates).
   */
  restoreScroll(positions?: Positions): void {
    if (positions) this.#startRestore(positions);
    else this.#tryRestore();
  }

  #apply(url: string, kind: NavigationKind, options: NavigateOptions): void {
    const q = url.indexOf('?');
    const pathname = q === -1 ? url : url.slice(0, q);
    const search = q === -1 ? '' : url.slice(q + 1);
    const match = matchPath(pathname);
    const redirect = redirectFor(match, url, this.#hasProfile());
    if (redirect !== null && redirect !== url) {
      history.replaceState(this.#entry, '', redirect);
      this.#apply(redirect, kind === 'pop' ? 'replace' : kind, options);
      return;
    }
    this.route = match;
    this.query = new URLSearchParams(search);
    this.url = currentUrl();
    this.#remember(kind === 'push');
    if (match.name === 'recipes' || match.name === 'favorites') this.listContext = match.name;
    document.title = titleFor(match.name);
    this.lastNavigation = {
      kind,
      focus: kind !== 'initial' && kind !== 'pop' && options.focus !== false,
      seq: this.lastNavigation.seq + 1,
    };

    if (kind === 'pop' || kind === 'initial') {
      const saved = this.#scroll.get(this.#entry.key);
      if (saved) this.#startRestore(saved);
      else if (kind === 'pop') this.#startRestore({ window: 0, detail: 0 });
    } else if (options.scroll !== false) {
      // New content starts at the top; the list column at ≥ 1024 px keeps its position (NF-08).
      this.#startRestore({ window: 0, detail: 0 });
    }
  }

  #onPopState = (event: PopStateEvent): void => {
    // Entries without our state (e.g. an in-page #anchor) keep the current position in the session.
    const entry = readEntry(event.state) ?? { key: newKey(), idx: this.#entry.idx };
    if (this.#ignorePops > 0) {
      // The history step that removes a closed sheet's entry, or a stale one after a reload (start);
      // stale entries can be stacked (a sheet over the editor's guard).
      this.#entry = entry;
      if (this.#dropStale && entry.overlay) history.back();
      else if (--this.#ignorePops === 0) this.#settle();
      return;
    }
    const top = this.#overlays.at(-1);
    if (top?.pushed && entry.idx < this.#entry.idx) {
      // Back while a sheet is open closes the sheet; the page stays (F-34).
      this.#overlays.pop();
      this.#entry = entry;
      top.close();
      return;
    }
    this.#closeOverlaysSilently();
    this.#saveScroll();
    this.#entry = entry.overlay ? { key: entry.key, idx: entry.idx } : entry;
    this.#apply(currentUrl(), 'pop', {});
  };

  #onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!anchor?.hasAttribute('href')) return;
    if (anchor.target !== '' && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download') || anchor.relList.contains('external')) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
    event.preventDefault();
    this.navigate(url.pathname + url.search);
  };

  #releaseOverlay(id: number): void {
    const index = this.#overlays.findIndex((o) => o.id === id);
    if (index === -1) return; // already closed by Back or by a navigation
    const [overlay] = this.#overlays.splice(index, 1);
    // Remove the sheet's history entry so a later Back does not land on it.
    if (overlay?.pushed) this.#stepBack();
  }

  /** One history step back whose popstate only updates the entry; navigations wait for it. */
  #stepBack(): void {
    this.#ignorePops++;
    this.#pendingBack ??= new Promise<void>((resolve) => {
      this.#resolveBack = resolve;
    });
    history.back();
  }

  #settle(): void {
    this.#dropStale = false;
    this.#ignorePops = 0;
    this.#resolveBack?.();
    this.#resolveBack = null;
    this.#pendingBack = null;
  }

  /** Records the current URL at its history position for previousPath(). */
  #remember(push: boolean): void {
    recordUrl(this.#urls, this.#entry.idx, this.url, push);
    try {
      sessionStorage.setItem(URLS_STORAGE_KEY, JSON.stringify([...this.#urls]));
    } catch {
      // Storage full or blocked: the positions stay in memory for this page load.
    }
  }

  #closeOverlaysSilently(): void {
    const open = this.#overlays.splice(0);
    for (const overlay of open.reverse()) overlay.close();
  }

  #positions(): Positions {
    const positions: Positions = { window: window.scrollY };
    for (const [area, el] of this.#areas) positions[area] = el.scrollTop;
    return positions;
  }

  #saveScroll(): void {
    if (this.#entry.key === '') return;
    this.#scroll.delete(this.#entry.key);
    this.#scroll.set(this.#entry.key, this.#positions());
    while (this.#scroll.size > SCROLL_ENTRIES) {
      const oldest = this.#scroll.keys().next().value;
      if (oldest === undefined) break;
      this.#scroll.delete(oldest);
    }
    try {
      sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify([...this.#scroll]));
    } catch {
      // Storage full or blocked: positions stay in memory for this page load.
    }
  }

  #loadScroll(): void {
    try {
      this.#urls = parseUrls(sessionStorage.getItem(URLS_STORAGE_KEY));
      const raw = sessionStorage.getItem(SCROLL_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'object' && item[1]) {
          this.#scroll.set(item[0], item[1] as Positions);
        }
      }
    } catch {
      // Unreadable storage: start without saved positions.
    }
  }

  #startRestore(positions: Positions): void {
    this.#restore = { positions, until: performance.now() + RESTORE_WINDOW_MS };
    void tick().then(this.#tryRestore);
  }

  /** Applies the pending positions; retries each frame while content is still loading. */
  #tryRestore = (): void => {
    const pending = this.#restore;
    if (!pending) return;
    let done = true;
    for (const [area, value] of Object.entries(pending.positions) as Array<[ScrollArea, number]>) {
      // The page scrolls with <html> (standards mode, NF-17 browsers), the columns with their own element.
      const el = area === 'window' ? document.documentElement : this.#areas.get(area);
      if (!el) continue;
      if (Math.abs(el.scrollTop - value) > 1) el.scrollTop = value;
      if (Math.abs(el.scrollTop - value) > 1) done = false;
    }
    if (done || performance.now() > pending.until) this.#restore = null;
    else requestAnimationFrame(this.#tryRestore);
  };

  #cancelRestore = (): void => {
    this.#restore = null;
  };
}

export const router = new Router();
