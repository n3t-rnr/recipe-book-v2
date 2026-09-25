import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('./client', import.meta.url));
const apiTarget = `http://localhost:${process.env.PORT ?? '8080'}`;
const outDir = fileURLToPath(new URL('./dist/client', import.meta.url));
const preloadHelper = fileURLToPath(new URL('./client/src/lib/preload-helper.ts', import.meta.url));

/**
 * Scoped class of a component: "svelte-" and the last 4 characters of Svelte's own hash of the file path
 * instead of all 6–7. The class sits in every scoped selector and in the markup, so the random part costs
 * JS and CSS bytes (NF-01). Two components with the same class would share their styles: the build stops.
 */
function shortCssHash(): (input: { hash: (input: string) => string; filename: string }) => string {
  const owners = new Map<string, string>();
  return ({ hash, filename }) => {
    const cssHash = `svelte-${hash(filename).slice(-4)}`;
    const owner = owners.get(cssHash);
    if (owner !== undefined && owner !== filename) {
      throw new Error(
        `CSS-Hash ${cssHash} von ${filename} gehört schon zu ${owner}: Länge in vite.config.ts erhöhen.`,
      );
    }
    owners.set(cssHash, filename);
    return cssHash;
  };
}

/** Swaps Vite's helper of dynamic imports for client/src/lib/preload-helper.ts (see there, NF-01). */
function slimPreloadHelper(): Plugin {
  return {
    name: 'slim-preload-helper',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      if (config.base !== '/') throw new Error('client/src/lib/preload-helper.ts setzt base "/" voraus.');
    },
    resolveId(id) {
      return id === '\0vite/preload-helper.js' ? preloadHelper : undefined;
    },
  };
}

export default defineConfig({
  root,
  publicDir: 'public',
  plugins: [svelte({ compilerOptions: { cssHash: shortCssHash() } }), slimPreloadHelper()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    // Keine data:-URIs für Assets: Schriften und Bilder bleiben eigene, gehashte Dateien (NF-01, NF-15).
    assetsInlineLimit: 0,
    // Every NF-17 browser supports <link rel="modulepreload">; the polyfill would only cost entry bytes (NF-01).
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Everything the first view imports statically goes into the entry chunk. Without this group,
          // modules that lazy chunks use as well (Svelte runtime, router, texts, api) land in a second
          // shared chunk: one more file for the first view, and the bindings the two chunks exchange plus
          // the split compression cost about 1.3 KB gzip of initial JS and 0.3 KB CSS (NF-01).
          groups: [{ name: 'index', tags: ['$initial'] }],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/media': apiTarget,
    },
  },
});
