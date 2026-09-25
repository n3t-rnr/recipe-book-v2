/**
 * Stands in for Vite's helper of dynamic imports (vite/preload-helper; vite.config.ts swaps it in for the
 * build, NF-01). Before a lazily loaded chunk runs, the shared chunks it imports start loading in parallel
 * with it, each once, as <link rel="modulepreload">. The app has a single stylesheet that index.html links
 * (build.cssCodeSplit false), so the dependencies are JS chunks only. Vite's own helper also covers chunk
 * stylesheets, a relative base, CSP nonces, browsers without modulepreload and the vite:preloadError
 * event; this app has none of them (base "/", no nonce, NF-17 browsers support modulepreload).
 */
const requested = new Set<string>();

/**
 * Called by Vite's generated code as `__vitePreload(() => import('./Chunk.js'), deps)`; `deps` are paths
 * below the base, e.g. "assets/Sheet-<hash>.js". The preload links are hints only: the import itself
 * fetches what is still missing and fails when the server is gone.
 */
export function __vitePreload<T>(load: () => Promise<T>, deps?: readonly string[]): Promise<T> {
  for (const dep of deps ?? []) {
    const href = `/${dep}`;
    // Also skips what index.html links already.
    if (requested.has(href) || document.querySelector(`link[href="${href}"]`)) continue;
    requested.add(href);
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.crossOrigin = '';
    link.href = href;
    document.head.append(link);
  }
  return load();
}
