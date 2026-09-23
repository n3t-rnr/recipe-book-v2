import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./client', import.meta.url));
const apiTarget = `http://localhost:${process.env.PORT ?? '8080'}`;
const outDir = fileURLToPath(new URL('./dist/client', import.meta.url));

export default defineConfig({
  root,
  publicDir: 'public',
  plugins: [svelte()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    // Keine data:-URIs für Assets: Schriften und Bilder bleiben eigene, gehashte Dateien (NF-01, NF-15).
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/media': apiTarget,
    },
  },
});
