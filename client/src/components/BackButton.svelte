<script lang="ts">
  // Back button of every sub-view, top left (F-34): works without a browser bar (iOS shortcut).
  // plain: 44 px (editor, tags, trash …); overlay: 48 px round surface on a photo (detail).
  // Goes back in history, or to `fallback` when the view was opened directly (deep link).
  import { de } from '../i18n/de.ts';
  import { router } from '../lib/router.svelte.ts';
  import { paths } from '../lib/routes.ts';
  import IconButton from './IconButton.svelte';

  interface Props {
    variant?: 'plain' | 'overlay';
    /** aria-label, e.g. "Zurück zu Rezepte". */
    label?: string;
    fallback?: string;
  }

  let { variant = 'plain', label = de.common.back, fallback = paths.recipes() }: Props = $props();
</script>

<IconButton icon="back" {label} {variant} onclick={() => router.back(fallback)} />
