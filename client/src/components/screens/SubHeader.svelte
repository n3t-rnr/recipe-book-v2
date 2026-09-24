<script lang="ts">
  // Header of the sub-views below "Mehr" (generator editor header): back button top left (F-34, also
  // without a browser bar) and the title at 24 px.
  import { de } from '../../i18n/de.ts';
  import { paths } from '../../lib/routes.ts';
  import BackButton from '../BackButton.svelte';

  interface Props {
    title: string;
    fallback?: string;
  }

  let { title, fallback = paths.more }: Props = $props();
</script>

<header class="sub">
  <BackButton {fallback} label={de.common.backTo(de.nav.more)} />
  <h1 class="title-section">{title}</h1>
</header>

<style>
  .sub {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: calc(64px + var(--safe-top));
    padding: var(--safe-top) 12px 0 8px;
  }

  .title-section {
    font-size: 1.5rem;
  }
</style>
