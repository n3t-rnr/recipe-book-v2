/**
 * Where Back leads (F-34) without the Navigation API (Firefox, Safari): the router records the URL of
 * each history position of the app session it shows. An entry changes only while it is current, so the
 * position below the current one still holds the URL that Back returns to. Kept in sessionStorage (per
 * tab, survives reloads) like the scroll positions. No DOM access, so the unit tests run in Node.
 */

/** History position (EntryState.idx) → pathname + search. */
export type HistoryUrls = Map<number, string>;

/** Browsers keep about 50 entries per tab; older positions are unreachable anyway. */
const MAX_URLS = 50;

/** Records `url` at position `idx`; a push drops the forward positions the browser discarded. */
export function recordUrl(urls: HistoryUrls, idx: number, url: string, push: boolean): void {
  for (const i of urls.keys()) {
    if (i === idx || (push && i > idx)) urls.delete(i);
  }
  urls.set(idx, url);
  for (const i of urls.keys()) {
    if (urls.size <= MAX_URLS) break;
    urls.delete(i);
  }
}

/** Path (without query) of the entry below position `idx`; null for the first entry or when unknown. */
export function pathBefore(urls: HistoryUrls, idx: number): string | null {
  return urls.get(idx - 1)?.split('?')[0] ?? null;
}

/** Reads the stored positions; anything unexpected is skipped. */
export function parseUrls(raw: string | null): HistoryUrls {
  const urls: HistoryUrls = new Map();
  try {
    const data: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(data)) {
      for (const item of data) {
        if (Array.isArray(item) && Number.isInteger(item[0]) && typeof item[1] === 'string') {
          urls.set(item[0] as number, item[1]);
        }
      }
    }
  } catch {
    // Unreadable storage: start without recorded positions.
  }
  return urls;
}
