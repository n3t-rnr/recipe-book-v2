<script lang="ts" module>
  /**
   * The open filter sheet. Shared by all list instances: turning a tablet swaps the list between the page
   * and the list column (a new instance), and the sheet stays open (Kap. 6.4 „Drehen: Zustand bleibt“).
   */
  let sheet = $state<null | 'filter' | 'tags' | 'sort'>(null);
</script>

<script lang="ts">
  // Recipe list /rezepte (Kap. 6.3; artboards Main, TabletHochListe, TabletQuer): header with
  // "Aktualisieren" and avatar, sticky search row, tag chip row, count row with the sort button, cards
  // (phone one column, tablet portrait two columns) or compact rows in the 380 px column from 1024 px.
  // Skeletons on the first load (F-33), 40 per page with a cursor as the end comes near
  // (IntersectionObserver), empty states for no recipes at all and for a filter without hits.
  // Search text, tags, tag mode and sort live in the URL (F-34, lib/list-query.ts); every change replaces
  // the history entry. A new filter reloads with the old results still visible (F-21) and one request at
  // a time; the loaded pages live per filter in lib/recipes.ts, so Back from a recipe shows them at once
  // and the router restores the scroll position (F-34). A newer X-Data-Revision reloads them in the
  // background, also when it arrives while a reload runs (e.g. "Rückgängig" right after deleting).
  import { onMount, tick, untrack } from 'svelte';
  import type { RecipeCard as Card, RecipeListPage } from '../../../shared/types.ts';
  import Button from '../components/Button.svelte';
  import CompactRow from '../components/CompactRow.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import RecipeCard from '../components/RecipeCard.svelte';
  import ScreenHeader from '../components/screens/ScreenHeader.svelte';
  import SearchBar from '../components/screens/SearchBar.svelte';
  import TagChipRow from '../components/screens/TagChipRow.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { de } from '../i18n/de.ts';
  import { ds } from '../i18n/de-screens.ts';
  import { ApiError, errorMessage, isAbortError } from '../lib/api.ts';
  import { breakpoints } from '../lib/breakpoints.svelte.ts';
  import { mayReloadForChunk } from '../lib/chunk-retry.ts';
  import { loadFilterSheet, loadNoHits } from '../lib/lazy-routes.ts';
  import {
    activeFilterCount,
    effectiveSort,
    filterKey,
    isFiltered,
    knownTags,
    type ListFilter,
    listFilterFor,
    rememberListFilter,
    resetFilter,
    searchable,
    toApiQuery,
    toggleTag,
    toUrlQuery,
  } from '../lib/list-query.ts';
  import {
    fetchRecipePage,
    ListRevision,
    type ListSnapshot,
    PAGE_SIZE,
    readListSnapshot,
    writeListSnapshot,
  } from '../lib/recipes.ts';
  import { router } from '../lib/router.svelte.ts';
  import { paths } from '../lib/routes.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { tags } from '../state/tags.svelte.ts';
  import { toast } from '../state/toast.svelte.ts';

  interface Props {
    /** Recipe shown in the detail column at ≥ 1024 px (highlight its row). */
    selectedId?: number | null;
  }

  let { selectedId = null }: Props = $props();

  const SKELETONS = [1, 2, 3, 4, 5, 6, 7, 8];
  const wide = $derived(breakpoints.wide);
  /** The filter of the URL; next to a detail without list parameters the last one shown. */
  const filter = $derived(listFilterFor(router.route.name, router.query));
  const key = $derived(filterKey(filter));

  /** Filter key of the shown items (the URL may be ahead while a reload runs). */
  let shownKey = $state(untrack(() => key));
  const saved = readListSnapshot(untrack(() => shownKey));
  /** Filter of the shown items: count, empty states and paging follow it, not the URL. */
  let shown = $state.raw<ListFilter>(untrack(() => filter));
  let items = $state.raw<Card[]>(saved?.items ?? []);
  let total = $state.raw(saved?.total ?? 0);
  let totalAll = $state.raw(saved ? (saved.totalAll ?? saved.total) : 0);
  let didYouMean = $state.raw<string | null>(saved?.didYouMean ?? null);
  let cursor = $state.raw<string | null>(saved?.nextCursor ?? null);
  let revision = new ListRevision(saved?.revision ?? null);
  /** loading: first load without data; ready: items shown (possibly empty); failed: no data and an error. */
  let phase = $state.raw<'loading' | 'ready' | 'failed'>(saved ? 'ready' : 'loading');
  let failure = $state('');
  let reloading = $state(false);
  let more = $state<'idle' | 'loading' | 'failed'>('idle');
  let sentinel: HTMLElement | undefined = $state();
  let searchBar: SearchBar | undefined = $state();
  let countLine: HTMLElement | undefined = $state();
  let controller: AbortController | null = null;

  /** Two panes: rows carry the list filter, so the detail URL restores the list next to it (F-34). */
  const rowQuery = $derived(wide ? toUrlQuery(filter) : null);
  const noRecipes = $derived(phase === 'ready' && items.length === 0 && !isFiltered(shown) && totalAll === 0);
  const noHits = $derived(phase === 'ready' && items.length === 0 && total === 0 && isFiltered(shown));

  $effect(() => rememberListFilter(filter));

  /** Applies a filter change: the URL of this history entry changes; scroll position and focus stay. */
  function apply(next: ListFilter): void {
    rememberListFilter(next);
    router.setQuery(toUrlQuery(next));
  }

  /** Shows the first pages of `next`: a fresh answer or a snapshot of it. */
  function show(data: RecipeListPage | ListSnapshot, next: ListFilter): void {
    items = data.items;
    total = data.total;
    totalAll = data.totalAll ?? data.total;
    didYouMean = data.didYouMean ?? null;
    cursor = data.nextCursor;
    shown = next;
    phase = 'ready';
  }

  /** Keyed by the filter of the items, not shownKey: after a failed reload for a new filter they differ. */
  function store(): void {
    writeListSnapshot(
      { items, nextCursor: cursor, total, totalAll, didYouMean, revision: revision.shown },
      filterKey(shown),
    );
  }

  /**
   * A chunk of this view (filter sheet, empty result) failed while the server was away; lazy() showed the
   * banner. Chromium keeps a failed import for the page, so after the reconnection only a reload brings it
   * back, as App.svelte does for routes (lib/chunk-retry.ts).
   */
  let chunkFailed = false;

  function chunk<T>(load: () => Promise<T>): Promise<T> {
    return load().catch((err: unknown) => {
      chunkFailed = true;
      throw err;
    });
  }

  /** Loads a chunk ahead (pointerdown on the filter buttons, the first search), so it shows without waiting. */
  function preload(load: () => Promise<unknown>): void {
    chunk(load).catch(() => {});
  }

  /**
   * Loads the first page of the current filter again. `keep` loads as many items as are shown (max. 100),
   * so a background reload keeps the reading position; `top` (a new filter) starts the list at the top.
   */
  async function reload(keep: boolean, top = false): Promise<void> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    const next = filter;
    const query = toApiQuery(next);
    reloading = true;
    more = 'idle';
    revision.start(connection.dataRevision);
    if (query.q) preload(loadNoHits);
    try {
      const limit = keep ? Math.max(PAGE_SIZE, items.length) : PAGE_SIZE;
      const page = await fetchRecipePage(null, limit, own.signal, query);
      if (own.signal.aborted) return;
      show(page, next);
      const again = revision.done(connection.dataRevision);
      store();
      if (top) router.restoreScroll({ window: 0, list: 0 });
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
      const page = await fetchRecipePage(cursor, PAGE_SIZE, own.signal, toApiQuery(shown));
      if (own.signal.aborted) return;
      const known = new Set(items.map((i) => i.id));
      items = [...items, ...page.items.filter((i) => !known.has(i.id))];
      total = page.total;
      totalAll = page.totalAll;
      cursor = page.nextCursor;
      more = 'idle';
      store();
    } catch (err) {
      more = isAbortError(err) ? 'idle' : 'failed';
    } finally {
      if (controller === own) controller = null;
    }
  }

  /** „Aktualisieren“ (F-34): the list from the start, and the tags of the chip row. */
  function refresh(): void {
    void reload(false);
    void tags.load();
  }

  const preloadSheet = (): void => preload(loadFilterSheet);

  /** False once this list is gone (another page), so a sheet whose chunk arrives late stays closed. */
  let alive = true;

  /** The sheet opens once its chunk is there; after a failed load the buttons stay ready for the next tap. */
  function openSheet(kind: 'filter' | 'tags' | 'sort'): void {
    chunk(loadFilterSheet).then(
      () => alive && (sheet = kind),
      () => {},
    );
  }

  /**
   * „Filter zurücksetzen“ and „Meintest du“ of the empty result take the tapped button away with it, and the
   * focus must not fall back to <body> (NF-11). From the keyboard (a click with detail 0) it goes to the
   * search field, to type on. A tap must not open the on-screen keyboard over the new hits (or leave it
   * open): the focus goes to the count line, which stays, announces the new count, and from which Tab
   * leads on to the sort button and the hits.
   */
  function applyAndSearch(next: ListFilter, event: MouseEvent): void {
    apply(next);
    if (event.detail === 0) searchBar?.focus();
    else countLine?.focus({ preventScroll: true });
  }

  onMount(() => {
    if (phase === 'loading') void reload(false);
    // Server back after an outage (NF-09): refresh what is shown, the tags included. After a failed chunk
    // the page reloads instead (at most every 30 s); a list reload would preload it again, and each failure
    // would report the server gone and back once more, without end.
    const off = connection.onReconnect(() => {
      if (chunkFailed) {
        if (mayReloadForChunk()) location.reload();
        return;
      }
      void reload(true);
      void tags.load();
    });
    return () => {
      off();
      alive = false;
      // Turning a tablet on a recipe hides the list: its sheet must not come back with the next list.
      if (router.route.name !== 'recipes') sheet = null;
    };
  });

  // A new filter (typing, chips, sheet, Back): its snapshot at once, else a reload with the old results
  // visible (F-21). Paging and a running reload of the old filter stop.
  $effect(() => {
    const next = key;
    untrack(() => {
      if (next === shownKey) return;
      const pop = router.lastNavigation.kind === 'pop';
      controller?.abort();
      controller = null;
      reloading = false;
      more = 'idle';
      shownKey = next;
      const snapshot = readListSnapshot(next);
      if (!snapshot) {
        void reload(false, !pop);
        return;
      }
      show(snapshot, filter);
      revision = new ListRevision(snapshot.revision);
      if (revision.seen(connection.dataRevision)) void reload(true);
      if (!pop) void tick().then(() => router.restoreScroll({ window: 0, list: 0 }));
    });
  });

  // Another write (this device or another) changed the data: reload quietly and keep the position.
  // During a reload the revision is only noted; the reload then runs once more.
  $effect(() => {
    const rev = connection.dataRevision;
    untrack(() => revision.seen(rev) && void reload(true));
  });

  // The tags of the chip row and the sheet (F-24): loaded once, again after every write (X-Data-Revision).
  $effect(() => {
    void connection.dataRevision;
    untrack(() => void tags.ensure());
  });

  // A link with tags that no longer exist (deleted or merged) filters by the ones left. Only with a
  // current list: a tag saved a moment ago in the editor is not in an older one yet.
  $effect(() => {
    if (tags.status !== 'ready' || tags.stale) return;
    const pruned = knownTags(filter, tags.list);
    if (pruned) untrack(() => apply(pruned));
  });

  // Back from a recipe, or Back to another filter: the pages are there, so the saved scroll position can be
  // applied (F-34). Once per filter.
  let restoredKey: string | null = null;
  $effect(() => {
    if (phase !== 'ready' || restoredKey === shownKey) return;
    restoredKey = shownKey;
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

  /** Kap. 6.4: "/" focuses the search, unless the user types somewhere or a dialog is open. */
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) {
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    searchBar?.focus();
  }

  /** Keyboard focus on a card or row: all of it comes into view below the sticky search row (NF-11). */
  function onfocusin(event: FocusEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches(':focus-visible')) {
      target.closest('li')?.scrollIntoView({ block: 'nearest' });
    }
  }
</script>

<svelte:window {onkeydown} />

<div class={['list', { wide }]}>
  <ScreenHeader title={de.titles.recipes} compact={wide} onrefresh={refresh} busy={reloading} />
  <SearchBar
    bind:this={searchBar}
    value={filter.q}
    filterCount={activeFilterCount(filter)}
    expanded={sheet !== null}
    onsearch={(q) => apply({ ...filter, q })}
    onfilter={() => openSheet('filter')}
    onintent={preloadSheet}
  />
  <TagChipRow
    list={tags.list}
    active={filter.tags}
    ontoggle={(id) => apply(toggleTag(filter, id))}
    onall={() => openSheet('tags')}
    onintent={preloadSheet}
  />

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
  {:else if noRecipes}
    <div class="state">
      <EmptyState
        title={ds.list.emptyTitle}
        text={ds.list.emptyText}
        actionLabel={ds.list.emptyAction}
        actionHref={paths.recipeNew()}
      />
    </div>
  {:else}
    <div class="count-row">
      <p bind:this={countLine} class="count" aria-live="polite" tabindex="-1">
        {phase !== 'ready' ? '' : isFiltered(shown) ? ds.list.countOf(total, totalAll) : ds.list.count(total)}
      </p>
      <Button
        variant="text"
        underline={false}
        trailingIcon="chevDown"
        class="sort"
        onpointerdown={preloadSheet}
        onclick={() => openSheet('sort')}
      >
        <span class="visually-hidden">{ds.list.sortPrefix}</span>{ds.list.sorts[effectiveSort(filter)]}
      </Button>
    </div>
    {#if phase === 'loading'}
      <div class="items" aria-busy="true">
        {#each SKELETONS.slice(0, wide ? 8 : 4) as n (n)}
          <Skeleton variant={wide ? 'row' : 'card'} />
        {/each}
        <span class="visually-hidden" role="status">{de.common.loading}</span>
      </div>
    {:else if noHits}
      <div class="state">
        {#await chunk(loadNoHits) then mod}
          <mod.default
            q={searchable(shown.q) ? shown.q.trim() : null}
            {didYouMean}
            onreset={(event) => applyAndSearch(resetFilter(filter), event)}
            onsuggest={(q, event) => applyAndSearch({ ...filter, q }, event)}
          />
        {:catch}
          <!-- Server away: the banner explains it, the count row stays („0 von 38 Rezepten“). -->
        {/await}
      </div>
    {:else}
      <ul class="items" aria-busy={reloading} onfocusin={onfocusin}>
        {#each items as recipe, i (recipe.id)}
          <li>
            {#if wide}
              <CompactRow
                {recipe}
                href={rowQuery ? paths.recipe(recipe.id, rowQuery) : undefined}
                selected={recipe.id === selectedId}
                eager={i < 6}
              />
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

{#if sheet}
  {#await loadFilterSheet() then mod}
    <mod.default {filter} {total} focus={sheet} onchange={apply} onclose={() => (sheet = null)} />
  {/await}
{/if}

<style>
  /* Kap. 6.3 „fixiertes Suchfeld“: the browser scrolls a focused element or a scrollIntoView target below
     the sticky search row (banner + band + 12 px + 52 px field), not behind it (NF-11). */
  :global(html:has(.search-row)),
  :global(.list-pane:has(.search-row)) {
    scroll-padding-top: calc(var(--banner-h, 0px) + var(--safe-top) + 72px);
  }

  /* Count row of the artboard: 10 px 12 px 10 px 20 px around the 44 px sort button. */
  .count-row {
    min-height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px 10px 20px;
  }

  .count {
    font-size: var(--text-label);
    font-weight: 600;
  }

  .count-row :global(.sort) {
    flex-shrink: 0;
    padding: 0 8px;
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

  /* Tablet portrait: two-column card grid (artboard TabletHochListe), count row 10 px 16 px 10 px 20 px. */
  @media (min-width: 600px) {
    .count-row {
      padding-right: 16px;
    }

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
  .wide .count-row {
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
