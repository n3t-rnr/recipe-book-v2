<script lang="ts">
  // App layout per breakpoint (NF-08, approved artboards):
  // - < 1024 px: content in the window scroll, floating bottom navigation, FAB (Rezepte, Favoriten).
  // - ≥ 1024 px: 88 px navigation rail; list and detail routes show the list column (380 px) and the
  //   detail column side by side, each scrolling on its own; other routes use the full content width.
  // The route decides via `meta` (lib/routes.ts); App.svelte passes the snippets.
  import { type Snippet, tick, untrack } from 'svelte';
  import { de } from '../i18n/de.ts';
  import { breakpoints } from '../lib/breakpoints.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import type { RouteMeta } from '../lib/routes.ts';
  import { toast } from '../state/toast.svelte.ts';
  import BottomNav from './BottomNav.svelte';
  import Fab from './Fab.svelte';
  import NavRail from './NavRail.svelte';

  interface Props {
    meta: RouteMeta;
    /** Banner above the content (connection, later read-only and update hints). */
    banner?: Snippet | undefined;
    /** Two-pane layout (≥ 1024 px on list and detail routes): list column and detail column. */
    list?: Snippet | undefined;
    detail?: Snippet | undefined;
    /** Single-pane content. */
    children?: Snippet | undefined;
    /** Toast host and other fixed layers; inherit the shell's offsets (--toast-bottom). */
    overlays?: Snippet | undefined;
  }

  let { meta, banner, list, detail, children, overlays }: Props = $props();

  const wide = $derived(breakpoints.wide);
  const twoPane = $derived(wide && meta.twoPane && list !== undefined);
  const showRail = $derived(wide && meta.chrome);
  const showBottomNav = $derived(!wide && meta.chrome && meta.bottomNav);
  const showFab = $derived(!wide && meta.chrome && meta.fab);
  const bottomBar = $derived(
    meta.bottomBar === 'always' || (meta.bottomBar === 'phone' && breakpoints.phone),
  );

  let mainEl: HTMLElement | undefined = $state();
  let listEl: HTMLElement | undefined = $state();
  let detailEl: HTMLElement | undefined = $state();

  $effect(() => (listEl ? router.registerScrollArea('list', listEl) : undefined));
  $effect(() => (detailEl ? router.registerScrollArea('detail', detailEl) : undefined));

  // Keyboard and screen reader users land at the start of the new view after a navigation (NF-11).
  // Inside the two-pane layout the focus stays in the list, so choosing the next recipe is one key away.
  $effect(() => {
    const nav = router.lastNavigation;
    if (!nav.focus) return;
    untrack(() => {
      if (twoPane) return;
      void tick().then(() => mainEl?.focus({ preventScroll: true }));
    });
  });

  // Rotating a tablet switches between one and two panes; keep the reading position (NF-08). Only a width
  // change counts: a navigation to a one-pane route starts at the top (router). The detail keeps its pixel
  // offset. Rows (≥ 1024 px) and cards differ in height, so the list keeps a recipe at the same distance
  // from its top edge instead: on /rezepte the first visible one; next to a detail the selected row, which
  // portrait hides, so its distance waits for the way back. A recipe opened in portrait then takes that
  // place, so the marked row is in view. offsetTop works because the list column is positioned (else the
  // page); while turning, the columns have no height (CSS), so the browser cannot cut the list's position.
  let wasWide = untrack(() => wide);
  /** Link path of the first visible recipe on /rezepte ('' at the top of the list: stay at the top). */
  let anchorPath: string | undefined;
  /** Distance of the anchor recipe from the top edge (before any turn: upper part of the column). */
  let anchorOffset = 300;
  $effect.pre(() => {
    const next = wide;
    untrack(() => {
      if (next === wasWide) return;
      wasWide = next;
      if (!meta.twoPane) return;
      const onDetail = router.route.name === 'recipe';
      if (onDetail) router.restoreScroll(next ? { detail: scrollY } : { window: detailEl?.scrollTop ?? 0 });
      // Pre effect: the old layout is still on screen, the list column or the page on /rezepte. A detail in
      // portrait has no selected row, so the anchor stays.
      const top = listEl?.scrollTop ?? scrollY;
      const selected = 'main li:has([aria-current=page])';
      const item = [...document.querySelectorAll<HTMLElement>(onDetail ? selected : 'main li')].find(
        (li) => onDetail || li.offsetTop >= top,
      );
      if (item) {
        anchorPath = top ? item.querySelector('a')?.pathname : '';
        anchorOffset = item.offsetTop - top;
      }
      void tick().then(() => {
        const row = document.querySelector<HTMLElement>(
          onDetail ? selected : `main li:has([href="${anchorPath}"])`,
        );
        if (row) (next ? listEl : window)?.scrollTo(0, row.offsetTop - anchorOffset);
      });
    });
  });
</script>

<div
  class={[
    'shell',
    {
      rail: showRail,
      'bottom-nav': showBottomNav,
      fab: showFab,
      'two-pane': twoPane,
      'bottom-bar': bottomBar,
    },
  ]}
>
  {#if showRail}
    <NavRail active={meta.nav} />
  {/if}

  <main bind:this={mainEl} class="main" tabindex="-1">
    {#if banner}
      <div class="banner-slot">{@render banner()}</div>
    {/if}
    {#if twoPane}
      <div class="panes">
        <section bind:this={listEl} class="list-pane" aria-label={de.nav.recipes}>
          {@render list?.()}
        </section>
        <section bind:this={detailEl} class="detail-pane" aria-label={de.titles.recipe}>
          {@render detail?.()}
        </section>
      </div>
    {:else}
      {@render children?.()}
    {/if}
  </main>

  {#if showBottomNav}
    <BottomNav active={meta.nav} />
  {/if}
  {#if showFab}
    <Fab raised={toast.current !== null} />
  {/if}
  {@render overlays?.()}
</div>

<style>
  .shell {
    --toast-bottom: calc(16px + var(--safe-bottom));
    --toast-left: calc(12px + var(--safe-left));
    --toast-right: calc(12px + var(--safe-right));
    min-height: 100dvh;
  }

  .main {
    display: block;
    min-height: 100dvh;
  }

  .main:focus {
    outline: none;
  }

  /* Floating navigation: 12 px + 72 px bar; content ends 24 px above it, or above the FAB (160 px). */
  .shell.bottom-nav {
    --toast-bottom: calc(96px + var(--safe-bottom));
  }

  .shell.bottom-nav .main {
    padding-bottom: calc(108px + var(--safe-bottom));
  }

  .shell.bottom-nav.fab .main {
    padding-bottom: calc(176px + var(--safe-bottom));
  }

  /* Screens with their own fixed bottom bar (save bar, "Bearbeiten"): toasts sit above it. */
  .shell.bottom-bar {
    --toast-bottom: calc(104px + var(--safe-bottom));
  }

  .shell.rail {
    --toast-left: calc(88px + 24px + var(--safe-left));
    --toast-right: 24px;
    --toast-bottom: 24px;
  }

  .shell.rail.bottom-bar {
    --toast-bottom: 96px;
  }

  .shell.rail .main {
    margin-left: calc(88px + var(--safe-left));
  }

  /* "Banner oben" (Kap. 6.6): stays in view while the page scrolls; the last list stays visible below. */
  .banner-slot {
    position: sticky;
    top: 0;
    z-index: 25;
    padding: calc(12px + var(--safe-top)) 12px 0;
    pointer-events: none;
  }

  .banner-slot > :global(*) {
    pointer-events: auto;
  }

  .shell.rail .banner-slot {
    padding: 12px 24px 0;
  }

  /* Two panes: the shell is exactly one viewport high; list and detail scroll on their own. */
  .shell.two-pane .main {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .shell.two-pane .banner-slot {
    position: static;
    padding-bottom: 12px;
  }

  .panes {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 380px minmax(0, 1fr);
  }

  /* Turning to portrait: until the layout switches, the columns would be as tall as the portrait screen,
     and the browser would cut the list's position near its end before the rotation effect reads it. */
  @media (max-width: 1023.98px) {
    .panes {
      max-height: 0;
    }
  }

  /* Thin scrollbars keep the 380 px column close to the artboard where scrollbars take space (desktop). */
  .list-pane,
  .detail-pane {
    scrollbar-width: thin;
  }

  .list-pane {
    position: relative;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: 24px;
    border-right: 1px solid var(--color-border);
  }

  .detail-pane {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
