<script lang="ts">
  // Technical placeholder page of M0 (NF-16): server status and "connect another device".
  // The real UI starts in M2; its texts will then move to i18n/de.ts (NF-10).
  import { ApiError, getJson } from './api.ts';

  interface Health {
    status: 'ok' | 'degraded' | 'read-only';
    version: string;
    uptimeSec: number;
    db: 'ok' | 'corrupt';
    images: 'ok' | 'unavailable';
    counts: { recipes: number; trash: number; images: number; profiles: number; tags: number } | null;
  }

  interface ServerInfo {
    hostname: string;
    urls: Array<{ url: string; kind: 'public' | 'ip' | 'mdns' }>;
    qrUrl: string;
    qrSvg: string;
  }

  type View =
    | { state: 'loading' }
    | { state: 'error'; detail: string }
    | { state: 'ready'; health: Health; info: ServerInfo };

  const STATUS_TEXT: Record<Health['status'], string> = {
    ok: 'Alles in Ordnung',
    degraded: 'Eingeschränkt',
    'read-only': 'Nur Lesen',
  };
  const KIND_TEXT: Record<ServerInfo['urls'][number]['kind'], string> = {
    public: 'Feste Adresse',
    ip: 'IP-Adresse',
    mdns: 'Gerätename',
  };

  let view = $state<View>({ state: 'loading' });

  function formatUptime(sec: number): string {
    const min = Math.floor(sec / 60);
    if (min < 1) return 'unter 1 Min.';
    const h = Math.floor(min / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d} ${d === 1 ? 'Tag' : 'Tage'} ${h % 24} Std.`;
    return h > 0 ? `${h} Std. ${min % 60} Min.` : `${min} Min.`;
  }

  function errorDetail(err: unknown): string {
    if (err instanceof ApiError && err.kind === 'timeout') return 'Der Server hat 10 Sekunden lang nicht geantwortet.';
    if (err instanceof ApiError && err.kind === 'http') return `Der Server meldet einen Fehler (${err.status}).`;
    return 'Prüfe, ob der PC eingeschaltet ist und du im selben WLAN bist.';
  }

  async function load(): Promise<void> {
    view = { state: 'loading' };
    try {
      const [health, info] = await Promise.all([
        getJson<Health>('/health'),
        getJson<ServerInfo>('/server-info'),
      ]);
      view = { state: 'ready', health, info };
    } catch (err) {
      view = { state: 'error', detail: errorDetail(err) };
    }
  }

  void load();
</script>

<main class="page">
  <header class="intro">
    <h1>Rezepte-App</h1>
    <p class="muted">Technische Vorschau – die eigentliche Oberfläche folgt mit Meilenstein M2.</p>
  </header>

  {#if view.state === 'loading'}
    <p class="muted" role="status">Lade …</p>
  {:else if view.state === 'error'}
    <div class="banner" role="alert">
      <p class="banner-title">Server nicht erreichbar – läuft der Rezepte-PC?</p>
      <p>{view.detail}</p>
      <button type="button" class="retry" onclick={load}>Erneut versuchen</button>
    </div>
  {:else}
    {@const health = view.health}
    {@const info = view.info}
    <section class="card" aria-labelledby="server-heading">
      <h2 id="server-heading">Server</h2>
      <dl class="facts">
        <dt>Status</dt>
        <dd>{STATUS_TEXT[health.status] ?? health.status}</dd>
        <dt>Version</dt>
        <dd>{health.version}</dd>
        <dt>Läuft seit</dt>
        <dd>{formatUptime(health.uptimeSec)}</dd>
        <dt>Datenbank</dt>
        <dd>{health.db === 'ok' ? 'In Ordnung' : 'Beschädigt – nur Lesen möglich'}</dd>
        <dt>Bildverarbeitung</dt>
        <dd>{health.images === 'ok' ? 'Bereit' : 'Nicht verfügbar'}</dd>
        {#if health.counts}
          <dt>Rezepte</dt>
          <dd>{health.counts.recipes}</dd>
          <dt>Im Papierkorb</dt>
          <dd>{health.counts.trash}</dd>
          <dt>Bilder</dt>
          <dd>{health.counts.images}</dd>
          <dt>Profile</dt>
          <dd>{health.counts.profiles}</dd>
          <dt>Tags</dt>
          <dd>{health.counts.tags}</dd>
        {:else}
          <dt>Zähler</dt>
          <dd>Nicht lesbar (Datenbank beschädigt)</dd>
        {/if}
      </dl>
    </section>

    <section class="card" aria-labelledby="connect-heading">
      <h2 id="connect-heading">Anderes Gerät verbinden</h2>
      <p>Öffne eine dieser Adressen im Browser deines Handys oder scanne den QR-Code.</p>
      <ul class="urls">
        {#each info.urls as entry (entry.url)}
          <li>
            <span class="muted">{KIND_TEXT[entry.kind] ?? entry.kind}</span>
            <a href={entry.url}>{entry.url}</a>
          </li>
        {/each}
      </ul>
      <!-- The SVG comes from our own server (qrcode-generator), never from user input. -->
      <figure class="qr-figure">
        <div class="qr">{@html info.qrSvg}</div>
        <figcaption class="muted">QR-Code für {info.qrUrl}</figcaption>
      </figure>
    </section>
  {/if}
</main>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-7) var(--page-margin);
  }

  h1 {
    font-family: var(--font-display);
    font-size: var(--text-screen);
    font-weight: var(--text-screen-weight);
    line-height: var(--leading-heading);
  }

  h2 {
    font-family: var(--font-display);
    font-size: var(--text-section);
    font-weight: var(--text-section-weight);
    line-height: var(--leading-heading);
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .muted {
    color: var(--color-text-muted);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-surface);
  }

  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2) var(--space-4);
  }

  .facts dt {
    font-weight: var(--text-label-weight);
  }

  .urls {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0;
    list-style: none;
  }

  .urls li {
    display: flex;
    flex-direction: column;
  }

  .urls a {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap-min);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .qr-figure {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* The QR SVG brings its own light quiet zone, so it scans in both color schemes. */
  .qr {
    width: 220px;
    max-width: 100%;
  }

  .qr :global(svg) {
    width: 100%;
    height: auto;
  }

  .banner {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 14px var(--space-4);
    border-radius: var(--radius-tile);
    background: var(--color-highlight);
    color: var(--color-ink);
  }

  /* The page focus color (Linen in dark mode) would vanish on Vanilla. */
  .banner :focus-visible {
    outline-color: var(--color-ink);
  }

  .banner-title {
    font-weight: 700;
    line-height: 1.4;
  }

  .retry {
    align-self: flex-start;
    min-height: var(--tap-min);
    padding: 0 var(--space-4);
    border: 1.5px solid var(--color-ink);
    border-radius: var(--radius-chip);
    background: transparent;
    color: var(--color-ink);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
  }
</style>
