<script lang="ts">
  // Recipe list /rezepte (Kap. 6.3; artboards Main, TabletHochListe, TabletQuer): header with
  // "Aktualisieren" and avatar, "38 Rezepte", cards (phone one column, tablet portrait two columns) or
  // compact rows in the 380 px column from 1024 px. Skeletons on the first load (F-33), 40 per page with
  // a cursor as the end comes near (IntersectionObserver), empty state with "Erstes Rezept anlegen".
  // Search field, chips and sorting follow in M4; the count row keeps their place.
  // The loaded pages live in lib/recipes.ts, so Back from a recipe shows them at once and the router
  // restores the scroll position (F-34); a newer X-Data-Revision reloads them in the background, also
  // when it arrives while a reload runs (e.g. "Rückgängig" right after deleting).
  import { onMount, tick, untrack } from 'svelte';
  import type { RecipeCard as Card } from '../../../shared/types.ts';
  import CompactRow from '../components/CompactRow.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import RecipeCard from '../components/RecipeCard.svelte';
  import ScreenHeader from '../components/screens/ScreenHeader.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { de } from '../i18n/de.ts';
  import { ds } from '../i18n/de-screens.ts';
  import { ApiError, errorMessage, isAbortError } from '../lib/api.ts';
  import { breakpoints } from '../lib/breakpoints.svelte.ts';
  import { fetchRecipePage, ListRevision, PAGE_SIZE, readListSnapshot, writeListSnapshot } from '../lib/recipes.ts';
  import { router } from '../lib/router.svelte.ts';
  import { paths } from '../lib/routes.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { toast } from '../state/toast.svelte.ts';

  interface Props {
    /** Recipe shown in the detail column at ≥ 1024 px (highlight its row). */
    selectedId?: number | null;
  }

  let { selectedId = null }: Props = $props();

  const SKELETONS = [1, 2, 3, 4, 5, 6, 7, 8];
  const saved = readListSnapshot();
  let items = $state.raw<Card[]>(saved?.items ?? []);
  let total = $state.raw(saved?.total ?? 0);
  let cursor = $state.raw<string | null>(saved?.nextCursor ?? null);
  const revision = new ListRevision(saved?.revision ?? null);
  /** loading: first load without data; ready: items shown (possibly empty); failed: no data and an error. */
  let phase = $state.raw<'loading' | 'ready' | 'failed'>(saved ? 'ready' : 'loading');
  let failure = $state('');
  let reloading = $state(false);
  let more = $state<'idle' | 'loading' | 'failed'>('idle');
  let sentinel: HTMLElement | undefined = $state();
  let controller: AbortController | null = null;

  const wide = $derived(breakpoints.wide);

  function store(): void {
    writeListSnapshot({ items, nextCursor: cursor, total, revision: revision.shown });
  }

  /**
   * Loads the first page again. `keep` loads as many items as are shown (max. 100), so a background
   * reload keeps the reading position; the button starts over with one page.
   */
  async function reload(keep: boolean): Promise<void> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    reloading = true;
    more = 'idle';
    revision.start(connection.dataRevision);
    try {
      const limit = keep ? Math.max(PAGE_SIZE, items.length) : PAGE_SIZE;
      const page = await fetchRecipePage(null, limit, own.signal);
      items = page.items;
      total = page.total;
      cursor = page.nextCursor;
      phase = 'ready';
      const again = revision.done(connection.dataRevision);
      store();
      if (again) void reload(true);
    } catch (err) {
      if (isAbortError(err)) return;
      if (phase !== 'ready') {
        failure = errorMessage(err);
        phase = 'failed';
      } else if (!(err instanceof ApiError && err.code === 'NETWORK')) {
        // Offline is explained by the banner; the last list stays visible (F-33). A timeout offers
        // "Erneut versuchen", which repeats this reload (NF-09, Kap. 6.6).
        toast.error(err, () => reload(keep));
      }
    } finally {
      if (controller === own) {
        controller = null;
        reloading = false;
        revision.stop();
      }
    }
  }

  async function loadMore(): Promise<void> {
    if (cursor === null || more === 'loading' || controller) return;
    const own = new AbortController();
    controller = own;
    more = 'loading';
    try {
      const page = await fetchRecipePage(cursor, PAGE_SIZE, own.signal);
      const known = new Set(items.map((i) => i.id));
      items = [...items, ...page.items.filter((i) => !known.has(i.id))];
      total = page.total;
      cursor = page.nextCursor;
      more = 'idle';
      store();
    } catch (err) {
      more = isAbortError(err) ? 'idle' : 'failed';
    } finally {
      if (controller === own) controller = null;
    }
  }

  onMount(() => {
    if (phase === 'loading') void reload(false);
    // Server back after an outage (NF-09): refresh what is shown.
    return connection.onReconnect(() => void reload(true));
  });

  // Another write (this device or another) changed the data: reload quietly and keep the position.
  // During a reload the revision is only noted; the reload then runs once more.
  $effect(() => {
    const rev = connection.dataRevision;
    untrack(() => revision.seen(rev) && void reload(true));
  });

  // Back from a recipe: the pages are there, so the saved scroll position can be applied (F-34).
  let restored = false;
  $effect(() => {
    if (phase !== 'ready' || restored) return;
    restored = true;
    void tick().then(() => router.restoreScroll());
  });

  // Next page when the end of the list comes within 800 px of what scrolls it: the list column (the
  // section of AppShell) at ≥ 1024 px, else the page. Observing again after every page fires once more
  // when the end is still in reach (short pages).
  $effect(() => {
    const el = sentinel;
    void items.length;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), {
      root: el.closest('section'),
      rootMargin: '800px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  });
</script>

<div class={['list', { wide }]}>
  <ScreenHeader title={de.titles.recipes} compact={wide} onrefresh={() => reload(false)} busy={reloading} />

  {#if phase === 'failed'}
    <div class="state">
      <EmptyState
        title={failure}
        illustration={false}
        actionLabel={de.common.retry}
        actionIcon="refresh"
        onaction={() => reload(false)}
      />
    </div>
  {:else if phase === 'ready' && total === 0 && items.length === 0}
    <div class="state">
      <EmptyState
        title={ds.list.emptyTitle}
        text={ds.list.emptyText}
        actionLabel={ds.list.emptyAction}
        actionHref={paths.recipeNew()}
      />
    </div>
  {:else}
    <p class="count" aria-live="polite">{phase === 'ready' ? ds.list.count(total) : ''}</p>
    {#if phase === 'loading'}
      <div class="items" aria-busy="true">
        {#each SKELETONS.slice(0, wide ? 8 : 4) as n (n)}
          <Skeleton variant={wide ? 'row' : 'card'} />
        {/each}
        <span class="visually-hidden" role="status">{de.common.loading}</span>
      </div>
    {:else}
      <ul class="items">
        {#each items as recipe, i (recipe.id)}
          <li>
            {#if wide}
              <CompactRow {recipe} selected={recipe.id === selectedId} eager={i < 6} />
            {:else}
              <RecipeCard {recipe} eager={i === 0} />
            {/if}
          </li>
        {/each}
      </ul>
      {#if cursor !== null}
        <div class="more" bind:this={sentinel}>
          {#if more === 'failed'}
            <EmptyState
              title={de.toast.actionFailed}
              illustration={false}
              actionLabel={de.common.retry}
              actionIcon="refresh"
              onaction={loadMore}
            />
          {:else}
            <Skeleton variant={wide ? 'row' : 'card'} />
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  /* Count row of the artboard (10 px 12 px 10 px 20 px around a 44 px sort button, which follows in M4). */
  .count {
    min-height: 64px;
    display: flex;
    align-items: center;
    padding: 0 12px 0 20px;
    font-size: var(--text-label);
    font-weight: 600;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 20px;
    list-style: none;
  }

  /* Cards and rows fill their item, so cards in one grid row share its height (artboard). */
  .items > li {
    display: grid;
    /* minmax(0, …): long titles must wrap instead of widening the row past the 380 px column (NF-08). */
    grid-template-columns: minmax(0, 1fr);
  }

  /* Tablet portrait: two-column card grid (artboard TabletHochListe). */
  @media (min-width: 600px) {
    .items {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .more {
    padding: 16px 20px 0;
  }

  .state {
    padding: 32px 20px 0;
  }

  /* List column at ≥ 1024 px: 6 px 8 px 4 px 20 px count row, rows 4 px apart, 12 px sides. */
  .wide .count {
    min-height: 54px;
    padding: 6px 8px 4px 20px;
  }

  .wide .items {
    display: flex;
    gap: 4px;
    padding: 0 12px;
  }

  .wide .more {
    padding: 4px 12px 0;
  }
</style>
