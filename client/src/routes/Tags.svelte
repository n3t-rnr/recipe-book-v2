<svelte:options runes />

<script lang="ts">
  // Tags /tags (Kap. 6.3): the tag management with counts, rename, merge and delete comes with M4
  // (F-17 to F-20). Until then the page shows a short empty state with a way back to the list.
  import EmptyState from '../components/EmptyState.svelte';
  import ScreenHeader from '../components/screens/ScreenHeader.svelte';
  import { de } from '../i18n/de.ts';
  import { dl } from '../i18n/de-screens-lazy.ts';
  import { paths } from '../lib/routes.ts';
</script>

<ScreenHeader title={de.titles.tags} />
<div class="state">
  <EmptyState
    title={dl.tags.emptyTitle}
    text={dl.tags.emptyText}
    actionLabel={de.notFound.toList}
    actionIcon="book"
    actionHref={paths.recipes()}
  />
</div>

<style>
  .state {
    max-width: 760px;
    padding: 32px 20px 0;
  }
</style>
