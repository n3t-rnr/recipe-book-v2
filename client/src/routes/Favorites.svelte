<script lang="ts">
  // Favorites /favoriten (Kap. 6.3; artboard HandyFavoriten): the list layout with a fixed filter. Hearts,
  // the favorites filter and its search come with M5 (F-28), so M2 shows the view's own empty state with
  // a link to the list (Kap. 6.6).
  import EmptyState from '../components/EmptyState.svelte';
  import ScreenHeader from '../components/screens/ScreenHeader.svelte';
  import { de } from '../i18n/de.ts';
  import { ds } from '../i18n/de-screens.ts';
  import { breakpoints } from '../lib/breakpoints.svelte.ts';
  import { paths } from '../lib/routes.ts';

  interface Props {
    /** Recipe shown in the detail column at ≥ 1024 px (highlight its row). */
    selectedId?: number | null;
  }

  // No rows yet, so nothing to highlight; the prop is the contract with App.svelte.
  let { selectedId: _selectedId = null }: Props = $props();
</script>

<ScreenHeader title={de.titles.favorites} compact={breakpoints.wide} />
<div class="state">
  <EmptyState title={ds.favorites.empty} actionLabel={de.notFound.toList} actionIcon="book" actionHref={paths.recipes()} />
</div>

<style>
  .state {
    padding: 32px 20px 0;
  }
</style>
