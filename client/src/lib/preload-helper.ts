/**
 * Stands in for Vite's helper of dynamic imports (vite/preload-helper; vite.config.ts swaps it in for the
 * build, NF-01). Before a lazily loaded chunk runs, its stylesheets and the shared chunks it imports load
 * in parallel with it, each once. Vite's own helper also covers a relative base, CSP nonces, browsers
 * without modulepreload and the vite:preloadError event; this app has none of them (base "/", no nonce,
 * NF-17 browsers support modulepreload), and they cost about 0.35 KB gzip of initial JS.
 */
const requested = new Set<string>();

/**
 * Called by Vite's generated code as `__vitePreload(() => import('./Chunk.js'), deps)`; `deps` are paths
 * below the base, e.g. "assets/Sheet-<hash>.css". A failed stylesheet fails the import like a failed chunk.
 */
export function __vitePreload<T>(load: () => Promise<T>, deps?: readonly string[]): Promise<T> {
  const styles: Array<Promise<unknown>> = [];
  for (const dep of deps ?? []) {
    const href = `/${dep}`;
    // Also skips what index.html links already: the entry's stylesheet.
    if (requested.has(href) || document.querySelector(`link[href="${href}"]`)) continue;
    requested.add(href);
    const link = document.createElement('link');
    link.rel = href.endsWith('.css') ? 'stylesheet' : 'modulepreload';
    link.crossOrigin = '';
    link.href = href;
    document.head.append(link);
    // The chunk renders only once its styles apply (no unstyled flash).
    if (link.rel === 'stylesheet') {
      styles.push(
        new Promise((resolve, reject) => {
          link.onload = resolve;
          link.onerror = reject;
        }),
      );
    }
  }
  return Promise.all(styles).then(load);
}
