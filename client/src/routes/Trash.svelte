<script lang="ts">
  // Trash "Mehr → Papierkorb" (F-08, Kap. 6.3): title, who deleted it, when, and the days left until the
  // automatic purge. "Wiederherstellen" acts at once; "Endgültig löschen" asks first and names the recipe
  // (F-35: only final actions are confirmed). Empty: "Der Papierkorb ist leer" (Kap. 6.6).
  import { onMount } from 'svelte';
  import type { RecipeResponse, TrashItem, TrashResponse } from '../../../shared/types.ts';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SubHeader from '../components/screens/SubHeader.svelte';
  import { de } from '../i18n/de.ts';
  import { dl } from '../i18n/de-screens-lazy.ts';
  import { ApiError, del, errorMessage, get, isAbortError, post } from '../lib/api.ts';
  import { router } from '../lib/router.svelte.ts';
  import { paths } from '../lib/routes.ts';
  import { onDate, personName, remainingDays } from '../lib/screens.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { toast } from '../state/toast.svelte.ts';

  let items = $state.raw<TrashItem[]>([]);
  let phase = $state<'loading' | 'ready' | 'failed'>('loading');
  let failure = $state('');
  /** Ids with a request in flight (buttons disabled). */
  let pending = $state.raw<ReadonlySet<number>>(new Set());
  let confirm = $state.raw<TrashItem | null>(null);
  let controller: AbortController | null = null;

  async function load(): Promise<void> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    try {
      const res = await get<TrashResponse>('/trash', { signal: own.signal });
      items = res.items;
      phase = 'ready';
    } catch (err) {
      if (isAbortError(err)) return;
      if (phase !== 'ready') {
        failure = errorMessage(err);
        phase = 'failed';
      }
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

  function setPending(id: number, on: boolean): void {
    const next = new Set(pending);
    if (on) next.add(id);
    else next.delete(id);
    pending = next;
  }

  function drop(id: number): void {
    items = items.filter((i) => i.id !== id);
  }

  async function restore(item: TrashItem): Promise<void> {
    setPending(item.id, true);
    try {
      await post<RecipeResponse>(`/recipes/${item.id}/restore`);
      drop(item.id);
      toast.show(dl.trash.restored(item.title), {
        action: { label: dl.trash.open, run: () => router.navigate(paths.recipe(item.id)) },
      });
    } catch (err) {
      toast.show(errorMessage(err));
      void load();
    } finally {
      setPending(item.id, false);
    }
  }

  async function purge(item: TrashItem): Promise<void> {
    setPending(item.id, true);
    try {
      await del(`/trash/${item.id}`);
      drop(item.id);
      confirm = null;
      toast.show(dl.trash.purged(item.title));
    } catch (err) {
      confirm = null;
      // Gone already (another device): the list catches up.
      if (err instanceof ApiError && (err.code === 'NOT_FOUND' || err.code === 'NOT_IN_TRASH')) void load();
      toast.show(errorMessage(err));
    } finally {
      setPending(item.id, false);
    }
  }
</script>

<div class="page">
  <SubHeader title={de.titles.trash} />

  <div class="body">
    {#if phase === 'failed'}
      <EmptyState
        title={failure}
        illustration={false}
        actionLabel={de.common.retry}
        actionIcon="refresh"
        onaction={load}
      />
    {:else if phase === 'ready' && items.length === 0}
      <EmptyState title={dl.trash.empty} />
    {:else}
      <p class="intro">{dl.trash.intro}</p>
      {#if phase === 'loading'}
        <div class="items" aria-busy="true">
          {#each [1, 2, 3] as n (n)}
            <div class="item skeleton" aria-hidden="true"></div>
          {/each}
          <span class="visually-hidden" role="status">{dl.trash.loading}</span>
        </div>
      {:else}
        <ul class="items">
          {#each items as item (item.id)}
            {@const busy = pending.has(item.id)}
            <li class="item">
              <div class="text">
                <h2 class="title">{item.title}</h2>
                <p class="meta">{dl.trash.deletedBy(personName(item.deletedBy), onDate(item.deletedAt))}</p>
                <p class="meta days">{dl.trash.remaining(remainingDays(item.purgeAt))}</p>
              </div>
              <div class="actions">
                <Button variant="outline" size={44} icon="restore" disabled={busy} onclick={() => restore(item)}>
                  {dl.trash.restore}
                </Button>
                <Button variant="text" icon="trash" disabled={busy} onclick={() => (confirm = item)}>
                  {dl.trash.purge}
                </Button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

{#if confirm}
  {@const item = confirm}
  <!-- Irreversible: focus starts on "Abbrechen", not on "Endgültig löschen" (NF-11). -->
  <Dialog
    alert
    initialFocus="cancel"
    title={dl.trash.confirmTitle(item.title)}
    text={dl.trash.confirmText}
    onclose={() => (confirm = null)}
  >
    {#snippet actions()}
      <Button size={52} full icon="trash" busy={pending.has(item.id)} onclick={() => purge(item)}>
        {dl.trash.purge}
      </Button>
      <Button variant="outline" size={52} full onclick={() => (confirm = null)}>{de.common.cancel}</Button>
    {/snippet}
  </Dialog>
{/if}

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

  .intro {
    font-size: var(--text-label);
    line-height: 1.5;
    color: var(--color-text-muted);
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 16px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-tile);
    background: var(--color-surface);
  }

  .item.skeleton {
    height: 150px;
    border-color: transparent;
    background: var(--color-subtle);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-step);
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: break-word;
  }

  .meta {
    font-size: var(--text-meta);
    line-height: 1.5;
    color: var(--color-text-muted);
  }

  .days {
    font-weight: 600;
    color: var(--color-text);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 20px;
  }
</style>
