<script lang="ts">
  // App root: shell, route outlet, connection banner, toast host (Kap. 6.2). The NF-01 initial budget
  // covers shell and list, so these (and the favorites view, a list with a fixed filter) are in the
  // entry chunk; profile choice, detail, editor, tags and "Mehr" load as separate chunks
  // (lib/lazy-routes.ts). A route chunk that failed while the server was away loads again once it
  // answers: by reloading the page, the only way past the browser's failed module (lib/chunk-retry.ts).
  import { type Component, onMount, untrack } from 'svelte';
  import AppShell from './components/AppShell.svelte';
  import Banner from './components/Banner.svelte';
  import EmptyState from './components/EmptyState.svelte';
  import Toast from './components/Toast.svelte';
  import { de } from './i18n/de.ts';
  import { ping } from './lib/api.ts';
  import { ChunkRetry, mayReloadForChunk } from './lib/chunk-retry.ts';
  import { router } from './lib/router.svelte.ts';
  import {
    lazy,
    loadConnect,
    loadMore,
    loadRecipeDetail,
    loadRecipeEdit,
    loadStatus,
    loadTags,
    loadTrash,
  } from './lib/lazy-routes.ts';
  import { idParam, routeMeta } from './lib/routes.ts';
  import Favorites from './routes/Favorites.svelte';
  import NotFound from './routes/NotFound.svelte';
  import RecipeList from './routes/RecipeList.svelte';
  import { connection } from './state/connection.svelte.ts';
  import { profile } from './state/profile.svelte.ts';

  const route = $derived(router.route);
  const meta = $derived(routeMeta(route.name));
  const recipeId = $derived(idParam(route));
  const selectedId = $derived(route.name === 'recipe' ? recipeId : null);
  /** Which list sits next to the detail at ≥ 1024 px. */
  const listKind = $derived(route.name === 'favorites' ? 'favorites' : route.name === 'recipes' ? 'recipes' : router.listContext);

  let retryingConnection = $state(false);
  const loadProfilePick = lazy(() => import('./routes/ProfilePick.svelte'));
  // Keyed by route name: in two panes the failed detail stays on screen while the recipe id changes.
  const chunks = new ChunkRetry(() => untrack(() => router.route.name));

  async function retryConnection(): Promise<void> {
    retryingConnection = true;
    await ping();
    retryingConnection = false;
  }

  /** "Erneut versuchen" on a failed route: once the server answers, a reload loads the chunk (NF-09). */
  async function retryChunk(): Promise<void> {
    if (await ping()) location.reload();
  }

  onMount(() => {
    void profile.load();
    const online = (): void => void ping();
    window.addEventListener('online', online);
    const off = connection.onReconnect(() => {
      if (chunks.failed && mayReloadForChunk()) location.reload();
    });
    return () => {
      off();
      window.removeEventListener('online', online);
    };
  });
</script>

{#snippet offlineBanner()}
  <Banner
    message={de.connection.offline}
    actionLabel={de.common.retry}
    onaction={retryConnection}
    busy={retryingConnection}
  />
{/snippet}

{#snippet listColumn()}
  {#if listKind === 'favorites'}
    <Favorites {selectedId} />
  {:else}
    <RecipeList {selectedId} />
  {/if}
{/snippet}

{#snippet detailColumn()}
  {#if route.name === 'recipe' && recipeId !== null}
    {@render detailRoute(recipeId)}
  {:else}
    <div class="detail-empty">
      <EmptyState title={de.detailPane.title} text={de.detailPane.text} />
    </div>
  {/if}
{/snippet}

{#snippet routeError()}
  <div class="route-error">
    <EmptyState
      title={de.connection.routeFailed}
      illustration={false}
      actionLabel={de.common.retry}
      actionIcon="refresh"
      onaction={retryChunk}
    />
  </div>
{/snippet}

{#snippet lazyRoute(load: () => Promise<{ default: Component }>)}
  {#await chunks.track(load()) then mod}
    <mod.default />
  {:catch}
    {@render routeError()}
  {/await}
{/snippet}

{#snippet detailRoute(id: number)}
  {#await chunks.track(loadRecipeDetail()) then mod}
    {#key id}
      <mod.default {id} />
    {/key}
  {:catch}
    {@render routeError()}
  {/await}
{/snippet}

{#snippet editorRoute(id: number | null)}
  {#await chunks.track(loadRecipeEdit()) then mod}
    <mod.default {id} />
  {:catch}
    {@render routeError()}
  {/await}
{/snippet}

{#snippet toastHost()}
  <Toast />
{/snippet}

<AppShell
  {meta}
  banner={connection.online ? undefined : offlineBanner}
  list={meta.twoPane ? listColumn : undefined}
  detail={meta.twoPane ? detailColumn : undefined}
  overlays={toastHost}
>
  {#key route.path}
    {#if route.name === 'profile'}
      {@render lazyRoute(loadProfilePick)}
    {:else if route.name === 'recipes'}
      <RecipeList />
    {:else if route.name === 'favorites'}
      <Favorites />
    {:else if route.name === 'recipe' && recipeId !== null}
      {@render detailRoute(recipeId)}
    {:else if route.name === 'recipeNew' || route.name === 'recipeEdit'}
      {@render editorRoute(route.name === 'recipeEdit' ? recipeId : null)}
    {:else if route.name === 'tags'}
      {@render lazyRoute(loadTags)}
    {:else if route.name === 'more'}
      {@render lazyRoute(loadMore)}
    {:else if route.name === 'connect'}
      {@render lazyRoute(loadConnect)}
    {:else if route.name === 'trash'}
      {@render lazyRoute(loadTrash)}
    {:else if route.name === 'status'}
      {@render lazyRoute(loadStatus)}
    {:else}
      <NotFound />
    {/if}
  {/key}
</AppShell>

<style>
  .detail-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: 24px;
  }

  .route-error {
    padding: calc(48px + var(--safe-top)) 20px 24px;
  }
</style>
