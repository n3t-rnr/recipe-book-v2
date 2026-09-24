<svelte:options runes />

<script lang="ts">
  // Unknown app path (F-34): the app page "Nicht gefunden" with a link to the list.
  import EmptyState from '../components/EmptyState.svelte';
  import { de } from '../i18n/de.ts';
  import { paths } from '../lib/routes.ts';
</script>

<div class="page">
  <EmptyState
    level={1}
    title={de.titles.notFound}
    text={de.notFound.text}
    actionLabel={de.notFound.toList}
    actionIcon="book"
    actionHref={paths.recipes()}
  />
</div>

<style>
  .page {
    padding: calc(48px + var(--safe-top)) 20px 24px;
  }
</style>
