<script lang="ts">
  // Recipe detail /rezepte/:id (F-29, F-33, Kap. 6.3; artboards HandyDetail, TabletHochDetail, TabletQuer).
  // Phone and tablet portrait: own page with the photo on top (back button, menu, on tablets edit, and the
  // avatar for the profile switch, F-03, all on round surfaces), the content sheet overlapping it by 32 px
  // and, on phones, a fixed "Bearbeiten" bar.
  // From 1024 px it fills the detail column next to the list with a toolbar instead.
  // Title and image come from the list data at once (F-29: ≤ 200 ms); the rest follows. The menu moves
  // the recipe to the trash without asking, with "Rückgängig" for 8 s (F-08). A recipe in the trash
  // shows who deleted it and "Wiederherstellen" (F-33); an unknown one "Rezept nicht gefunden".
  // The photo is variant m; tapping it opens variant l full screen (F-29, NF-06). The Lightbox is part of
  // this lazy chunk: it is only needed here, and a chunk of its own would cost a request when the photo is
  // tapped. On the placeholder, "Foto hinzufügen" opens the editor at the photo (?foto=1).
  import { onMount, untrack } from 'svelte';
  import type { CardImage, DetailImage, RecipeDetail, RecipeResponse } from '../../../shared/types.ts';
  import AvatarButton from '../components/AvatarButton.svelte';
  import Button from '../components/Button.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../components/Icon.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Lightbox from '../components/Lightbox.svelte';
  import RecipeMedia from '../components/RecipeMedia.svelte';
  import Sheet from '../components/Sheet.svelte';
  import DetailBody from '../components/screens/DetailBody.svelte';
  import { de } from '../i18n/de.ts';
  import { dl } from '../i18n/de-screens-lazy.ts';
  import { ApiError, del, errorMessage, get, isAbortError, post } from '../lib/api.ts';
  import { breakpoints } from '../lib/breakpoints.svelte.ts';
  import { cachedCard } from '../lib/recipes.ts';
  import { router } from '../lib/router.svelte.ts';
  import { paths } from '../lib/routes.ts';
  import { onDate, parseInTrash, personName } from '../lib/screens.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { toast } from '../state/toast.svelte.ts';

  interface Props {
    id: number;
  }

  let { id }: Props = $props();

  type View =
    | { kind: 'loading' }
    | { kind: 'ready'; recipe: RecipeDetail }
    | { kind: 'trash'; text: string }
    | { kind: 'missing' }
    | { kind: 'failed'; message: string };

  // App.svelte mounts this component once per id.
  const recipeId = untrack(() => id);
  const card = cachedCard(recipeId);

  let view = $state.raw<View>({ kind: 'loading' });
  let menuOpen = $state(false);
  let busy = $state(false);
  let zoomed = $state(false);
  let controller: AbortController | null = null;
  /** false once the detail is left: a late answer (or a retry from the toast) must not navigate. */
  let shown = true;

  const recipe = $derived(view.kind === 'ready' ? view.recipe : null);
  const title = $derived(recipe?.title ?? card?.title ?? '');
  const image = $derived<CardImage | DetailImage | null>(recipe ? recipe.image : (card?.image ?? null));
  const layout = $derived(breakpoints.layout);
  /** Photo heights of the artboards: 360 px at 390, 400 px at 768, 260 px in the 508 px column. */
  const ratio = $derived(layout === 'phone' ? '390 / 360' : layout === 'tablet' ? '768 / 400' : '508 / 260');
  const showHero = $derived(view.kind === 'loading' || view.kind === 'ready');
  const editHref = paths.recipeEdit(recipeId);
  const addPhoto = { href: `${editHref}?foto=1` };

  async function load(): Promise<void> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    try {
      const res = await get<RecipeResponse>(`/recipes/${recipeId}`, { signal: own.signal });
      view = { kind: 'ready', recipe: res.recipe };
    } catch (err) {
      if (isAbortError(err)) return;
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        view = { kind: 'missing' };
      } else if (err instanceof ApiError && err.code === 'IN_TRASH') {
        const info = parseInTrash(err.details);
        view = {
          kind: 'trash',
          text: dl.detail.inTrash(personName(info?.deletedBy ?? null), info ? onDate(info.deletedAt) : ''),
        };
      } else if (view.kind !== 'ready') {
        view = { kind: 'failed', message: errorMessage(err) };
      }
    } finally {
      if (controller === own) controller = null;
    }
  }

  onMount(() => {
    void load();
    const off = connection.onReconnect(() => {
      if (view.kind !== 'ready') void load();
    });
    return () => {
      shown = false;
      off();
      controller?.abort();
    };
  });

  $effect(() => {
    if (title !== '') document.title = `${title} – ${de.appName}`;
  });

  /** Back button top left (F-34): history back, or the list after a deep link. */
  function back(): void {
    router.back(paths.recipes());
  }

  /** Resolves once the closed menu sheet has removed its history entry (or after a short wait). */
  function sheetGone(): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        window.removeEventListener('popstate', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 400);
      window.addEventListener('popstate', done);
    });
  }

  async function moveToTrash(): Promise<void> {
    if (busy) return;
    const closed = menuOpen ? sheetGone() : Promise.resolve();
    menuOpen = false;
    busy = true;
    try {
      await del(`/recipes/${recipeId}`);
      toast.show(dl.detail.deleted, {
        undo: async () => {
          await post(`/recipes/${recipeId}/restore`);
        },
      });
      await closed;
      if (!shown) return;
      if (breakpoints.wide) router.navigate(paths.recipes(), { replace: true });
      else router.back(paths.recipes());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IN_TRASH') void load();
      else toast.error(err, moveToTrash);
    } finally {
      busy = false;
    }
  }

  async function restore(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const res = await post<RecipeResponse>(`/recipes/${recipeId}/restore`);
      view = { kind: 'ready', recipe: res.recipe };
      toast.show(dl.detail.restored);
    } catch (err) {
      // The server restores idempotently: a retry after a lost answer gets the recipe as well.
      toast.error(err, restore);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet zoom()}
  {#if recipe?.image}
    <button type="button" class="zoom" aria-label={dl.detail.zoom} aria-haspopup="dialog" onclick={() => (zoomed = true)}
    ></button>
  {/if}
{/snippet}

<article class={['detail', layout, { ready: recipe !== null }]} aria-busy={view.kind === 'loading'}>
  {#if showHero}
    {#if layout === 'wide'}
      {#if recipe}
        <div class="toolbar">
          <IconButton
            icon="dotsH"
            label={de.common.moreActions}
            haspopup="dialog"
            onclick={() => (menuOpen = true)}
          />
          <Button variant="outline" size={44} icon="pencil" href={editHref}>{de.common.edit}</Button>
        </div>
      {:else}
        <div class="toolbar" aria-hidden="true"></div>
      {/if}
    {:else}
      <!-- The overlay buttons come first in the DOM, so the focus order starts with "Zurück" (NF-11);
           they are positioned over the photo. -->
      <div class="hero">
        <div class="overlay start">
          <IconButton variant="overlay" icon="back" label={dl.detail.backToList} onclick={back} />
        </div>
        <div class="overlay end">
          {#if recipe}
            <IconButton
              variant="overlay"
              icon="dotsH"
              label={de.common.moreActions}
              haspopup="dialog"
              onclick={() => (menuOpen = true)}
            />
            {#if layout === 'tablet'}
              <IconButton variant="overlay" icon="pencil" label={de.common.edit} href={editHref} />
            {/if}
          {/if}
          <!-- Profile switch from the detail too (F-03; owner decision 2026-09-25, not on the artboard). -->
          <span class="plate"><AvatarButton /></span>
        </div>
        {#if recipe || card}
          <RecipeMedia
            {image}
            recipeId={recipeId}
            {title}
            use="detail"
            {ratio}
            eager
            alt={image ? de.recipe.photo(title) : ''}
            addPhoto={recipe && !image ? addPhoto : undefined}
          />
          {@render zoom()}
        {:else}
          <div class="media-skeleton" style:aspect-ratio={ratio}></div>
        {/if}
      </div>
    {/if}

    <div class="content">
      {#if layout === 'wide'}
        {#if recipe || card}
          <div class="photo">
            <RecipeMedia
              {image}
              recipeId={recipeId}
              {title}
              use="detail"
              {ratio}
              radius={24}
              eager
              alt={image ? de.recipe.photo(title) : ''}
              addPhoto={recipe && !image ? addPhoto : undefined}
            />
            {@render zoom()}
          </div>
        {:else}
          <div class="media-skeleton" style:aspect-ratio={ratio}></div>
        {/if}
      {/if}

      <div class="intro">
        {#if title !== ''}
          <h1 class="title-screen">{title}</h1>
        {:else}
          <span class="bar title-bar" aria-hidden="true"></span>
        {/if}
        {#if recipe && recipe.description.trim() !== ''}
          <p class="description">{recipe.description.trim()}</p>
        {/if}
      </div>

      {#if recipe}
        <DetailBody {recipe} />
      {:else if view.kind === 'failed'}
        <EmptyState
          title={view.message}
          illustration={false}
          actionLabel={de.common.retry}
          actionIcon="refresh"
          onaction={load}
        />
      {:else}
        <div class="loading" aria-hidden="true">
          <span class="bar tiles"></span>
          <span class="bar line"></span>
          <span class="bar row"></span>
          <span class="bar row"></span>
          <span class="bar row"></span>
        </div>
        <span class="visually-hidden" role="status">{dl.detail.loading}</span>
      {/if}
    </div>
  {:else}
    {#if layout !== 'wide'}
      <div class="plain-head">
        <IconButton icon="back" label={dl.detail.backToList} onclick={back} />
        <AvatarButton />
      </div>
    {/if}
    <div class="state">
      {#if view.kind === 'trash'}
        <EmptyState
          level={1}
          title={view.text}
          actionLabel={dl.detail.restore}
          actionIcon="restore"
          onaction={restore}
        />
      {:else if view.kind === 'missing'}
        <EmptyState
          level={1}
          title={dl.detail.notFound}
          text={dl.detail.notFoundText}
          actionLabel={de.notFound.toList}
          actionIcon="book"
          actionHref={paths.recipes()}
        />
      {:else if view.kind === 'failed'}
        <EmptyState
          level={1}
          title={view.message}
          illustration={false}
          actionLabel={de.common.retry}
          actionIcon="refresh"
          onaction={load}
        />
      {/if}
    </div>
  {/if}
</article>

{#if layout === 'phone' && recipe}
  <div class="edit-bar">
    <Button icon="pencil" full href={editHref}>{de.common.edit}</Button>
  </div>
{/if}

{#if zoomed && recipe?.image}
  <Lightbox image={recipe.image} alt={title} onclose={() => (zoomed = false)} />
{/if}

{#if menuOpen}
  <Sheet title={de.common.moreActions} onclose={() => (menuOpen = false)}>
    <ul class="menu">
      <li>
        <button type="button" class="menu-item" disabled={busy} onclick={moveToTrash}>
          <Icon name="trash" size={22} />{dl.detail.toTrash}
        </button>
      </li>
    </ul>
  </Sheet>
{/if}

<style>
  /* "Foto hinzufügen" sits 20 px above the content sheet, which overlaps the photo by 32 px. */
  .hero {
    position: relative;
    --add-photo-bottom: 52px;
  }

  /* The whole photo opens the full-screen view; the overlay buttons and the content sheet lie above. */
  .photo {
    position: relative;
  }

  .zoom {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    background: none;
    outline-offset: -4px;
  }

  /* z-index: the photo follows in the DOM and would otherwise paint over the buttons. */
  .overlay {
    position: absolute;
    z-index: 1;
    top: calc(12px + var(--safe-top));
    display: flex;
    gap: 8px;
  }

  .overlay.start {
    left: 12px;
  }

  .overlay.end {
    right: 12px;
  }

  /* Avatar on the photo: same round plate as the overlay buttons (NF-13). */
  .plate {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border: 1px solid var(--color-overlay-border);
    border-radius: 50%;
    background: var(--color-overlay);
  }

  .tablet .overlay {
    top: calc(16px + var(--safe-top));
  }

  .tablet .overlay.start {
    left: 16px;
  }

  .tablet .overlay.end {
    right: 16px;
  }

  /* Content sheet over the photo (artboard: −32 px, 28 px top corners). */
  .content {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: -32px;
    padding: 24px 20px 32px;
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    background: var(--color-bg);
  }

  /* Room for the fixed "Bearbeiten" bar (16 + 56 + 20 px). */
  .phone.ready .content {
    padding-bottom: calc(116px + var(--safe-bottom));
  }

  .tablet .content {
    gap: 18px;
    padding: 28px 32px 32px;
  }

  .tablet .title-screen {
    font-size: 2.5rem;
  }

  /* Detail column at ≥ 1024 px: toolbar, then photo and text with 24 px sides. */
  .toolbar {
    min-height: 56px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    padding: 12px 16px 0;
  }

  .wide .content {
    margin-top: 0;
    padding: 12px 24px 24px;
    border-radius: 0;
  }

  .wide .title-screen {
    font-size: 2.125rem;
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .title-screen {
    overflow-wrap: break-word;
    hyphens: auto;
  }

  /* At most about 70 characters per line on tablets (Kap. 6.7): German text in Figtree averages 0.47 em
     per character, so 33 em hold about 70; 70ch (the width of "0") would still allow about 95. */
  .description {
    max-width: 33em;
    font-size: var(--text-body);
    line-height: 1.5;
    white-space: pre-line;
  }

  .media-skeleton {
    width: 100%;
    background: var(--color-subtle);
  }

  .wide .media-skeleton {
    border-radius: var(--radius-card);
  }

  .loading {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .bar {
    display: block;
    border-radius: 11px;
    background: var(--color-subtle);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .title-bar {
    width: 70%;
    height: 38px;
  }

  .tiles {
    height: 76px;
    border-radius: var(--radius-tile);
  }

  .line {
    width: 55%;
    height: 22px;
  }

  .row {
    height: 52px;
    border-radius: var(--radius-row);
  }

  @keyframes pulse {
    50% {
      opacity: 0.55;
    }
  }

  .plain-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: calc(64px + var(--safe-top));
    padding: var(--safe-top) 12px 0 8px;
  }

  .state {
    padding: 24px 20px;
  }

  .wide .state {
    padding: 48px 24px;
  }

  .edit-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    padding: 16px calc(20px + var(--safe-right)) calc(20px + var(--safe-bottom)) calc(20px + var(--safe-left));
    background: var(--color-bg);
  }

  .menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    list-style: none;
  }

  .menu-item {
    width: 100%;
    min-height: 56px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-row);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-body);
    font-weight: 600;
    text-align: left;
  }

  .menu-item:active {
    background: var(--color-subtle);
  }

  .menu-item:disabled {
    color: var(--color-text-muted);
    cursor: progress;
  }
</style>
