<script lang="ts">
  // "Mehr → Status" (F-42, basic form of M0): state, version, uptime, database, image processing and the
  // counters from /api/v1/health. Sizes, free disk space and the last backup follow in M6.
  import { onMount } from 'svelte';
  import Button from '../components/Button.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SubHeader from '../components/screens/SubHeader.svelte';
  import { de } from '../i18n/de.ts';
  import { dl } from '../i18n/de-screens-lazy.ts';
  import { ApiError, errorMessage, get, isAbortError } from '../lib/api.ts';
  import { formatUptime } from '../lib/screens.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { toast } from '../state/toast.svelte.ts';

  /** The part of GET /api/v1/health (Kap. 7.8) this page shows. */
  interface Health {
    status: 'ok' | 'degraded' | 'read-only';
    version: string;
    uptimeSec: number;
    db: 'ok' | 'corrupt';
    images: 'ok' | 'unavailable';
    counts: { recipes: number; trash: number; images: number; profiles: number; tags: number } | null;
  }

  let health = $state.raw<Health | null>(null);
  let failure = $state<string | null>(null);
  let loading = $state(false);
  let controller: AbortController | null = null;

  async function load(): Promise<void> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    loading = true;
    failure = null;
    try {
      health = await get<Health>('/health', { signal: own.signal, profile: false });
    } catch (err) {
      if (isAbortError(err)) return;
      failure = errorMessage(err);
      // The last state stays visible; like the list, a failed "Aktualisieren" says so in a toast, which
      // offers "Erneut versuchen" after a timeout (NF-09). Offline is explained by the banner.
      if (health && !(err instanceof ApiError && err.code === 'NETWORK')) toast.error(err, load);
    } finally {
      if (controller === own) {
        controller = null;
        loading = false;
      }
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

  const serverRows = $derived<Array<[string, string]>>(
    health
      ? [
          [dl.status.state, dl.status.states[health.status] ?? health.status],
          [dl.status.version, health.version],
          [dl.status.uptime, formatUptime(health.uptimeSec)],
          [dl.status.database, dl.status.databaseStates[health.db] ?? health.db],
          [dl.status.images, dl.status.imageStates[health.images] ?? health.images],
        ]
      : [],
  );

  const dataRows = $derived<Array<[string, string | number]>>(
    health?.counts
      ? [
          [dl.status.recipes, health.counts.recipes],
          [dl.status.trash, health.counts.trash],
          [dl.status.imageCount, health.counts.images],
          [dl.status.profiles, health.counts.profiles],
          [dl.status.tags, health.counts.tags],
        ]
      : [[dl.status.counts, dl.status.countsUnreadable]],
  );
</script>

<div class="page">
  <SubHeader title={de.titles.status} />

  <div class="body">
    {#if health}
      <section class="card" aria-labelledby="status-server">
        <h2 id="status-server" class="title-section">{dl.status.server}</h2>
        <dl class="facts">
          {#each serverRows as [label, value] (label)}
            <div class="row"><dt>{label}</dt><dd>{value}</dd></div>
          {/each}
        </dl>
      </section>
      <section class="card" aria-labelledby="status-data">
        <h2 id="status-data" class="title-section">{dl.status.data}</h2>
        <dl class="facts">
          {#each dataRows as [label, value] (label)}
            <div class="row"><dt>{label}</dt><dd>{value}</dd></div>
          {/each}
        </dl>
      </section>
      <div>
        <Button variant="outline" size={44} icon="refresh" busy={loading} onclick={load}>{de.common.refresh}</Button>
      </div>
    {:else if failure}
      <EmptyState title={failure} illustration={false} actionLabel={de.common.retry} actionIcon="refresh" onaction={load} />
    {:else}
      <div class="skeleton" aria-hidden="true"></div>
      <span class="visually-hidden" role="status">{dl.status.loading}</span>
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
    gap: 16px;
    padding: 8px 20px 32px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 20px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-surface);
  }

  .title-section {
    font-size: 1.25rem;
  }

  .row {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-label);
  }

  .row:last-child {
    border-bottom: 0;
  }

  dd {
    font-weight: 700;
    text-align: right;
    overflow-wrap: anywhere;
  }

  .skeleton {
    height: 280px;
    border-radius: var(--radius-card);
    background: var(--color-subtle);
  }
</style>
