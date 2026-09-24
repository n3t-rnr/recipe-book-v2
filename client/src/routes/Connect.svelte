<script lang="ts">
  // "Mehr → Anderes Gerät verbinden" (F-39): the server's addresses in large type and its QR code (an SVG
  // made by the server, so the client loads no QR library). Resolved on every visit, so a new IP shows up
  // without a restart. The full guide for Android, iOS and the home screen shortcut follows in M6.
  import { onMount } from 'svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SubHeader from '../components/screens/SubHeader.svelte';
  import { de } from '../i18n/de.ts';
  import { dl } from '../i18n/de-screens-lazy.ts';
  import { errorMessage, get, isAbortError } from '../lib/api.ts';
  import { connection } from '../state/connection.svelte.ts';

  /** GET /api/v1/server-info (Kap. 7.8). */
  interface ServerInfo {
    hostname: string;
    urls: Array<{ url: string; kind: 'public' | 'ip' | 'mdns' }>;
    qrUrl: string;
    qrSvg: string;
  }

  /** data: URL of the server's QR SVG (CSP img-src allows data:, Kap. 7.8). */
  function qrSource(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  let info = $state.raw<ServerInfo | null>(null);
  let failure = $state<string | null>(null);
  let controller: AbortController | null = null;

  async function load(): Promise<void> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    failure = null;
    try {
      info = await get<ServerInfo>('/server-info', { signal: own.signal, profile: false });
    } catch (err) {
      if (!isAbortError(err)) failure = errorMessage(err);
    } finally {
      if (controller === own) controller = null;
    }
  }

  onMount(() => {
    void load();
    const off = connection.onReconnect(() => void load());
    return () => {
      off();
      controller?.abort();
    };
  });
</script>

<div class="page">
  <SubHeader title={de.titles.connect} />

  <div class="body">
    {#if info}
      <p class="intro">{dl.connect.intro}</p>
      <ul class="urls">
        {#each info.urls as entry (entry.url)}
          <li class="url">
            <span class="kind">{dl.connect.kinds[entry.kind] ?? entry.kind}</span>
            <a class="address" href={entry.url} rel="external">{entry.url}</a>
          </li>
        {/each}
      </ul>
      <figure class="qr-figure">
        <!-- The SVG comes from our own server (qrcode-generator); as an image it needs no {@html}. -->
        <img class="qr" src={qrSource(info.qrSvg)} alt={dl.connect.qrCaption(info.qrUrl)} width="240" height="240" />
        <figcaption class="caption" aria-hidden="true">{dl.connect.qrCaption(info.qrUrl)}</figcaption>
      </figure>
      <p class="intro">{dl.connect.wifi}</p>
    {:else if failure}
      <EmptyState title={failure} illustration={false} actionLabel={de.common.retry} actionIcon="refresh" onaction={load} />
    {:else}
      <div class="skeleton" aria-hidden="true"></div>
      <span class="visually-hidden" role="status">{dl.connect.loading}</span>
    {/if}
  </div>
</div>

<style>
  .page {
    max-width: 760px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 8px 20px 32px;
  }

  .intro {
    font-size: var(--text-body);
    line-height: 1.5;
  }

  .urls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0;
    list-style: none;
  }

  .url {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 16px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-tile);
    background: var(--color-surface);
  }

  .kind {
    font-size: var(--text-meta);
    font-weight: 600;
    color: var(--color-text-muted);
  }

  /* "Die URLs groß" (F-39). */
  .address {
    min-height: 44px;
    display: flex;
    align-items: center;
    font-family: var(--font-display);
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .qr-figure {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* The QR SVG brings its own white quiet zone, so it scans in both color schemes. */
  .qr {
    width: 240px;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-tile);
    image-rendering: pixelated;
  }

  .caption {
    font-size: var(--text-meta);
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }

  .skeleton {
    height: 320px;
    border-radius: var(--radius-tile);
    background: var(--color-subtle);
  }
</style>
