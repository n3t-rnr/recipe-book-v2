<script lang="ts" module>
  export type TagAction = 'rename' | 'merge' | 'delete';
</script>

<script lang="ts">
  // Row menu of the tag page (Kap. 6.3: „Je Zeile ein Menü: Umbenennen (inline), ‚Zusammenführen mit …‘,
  // Löschen“) as a bottom sheet like the editor's row menu (RowMenu.svelte): title = tag name, meta = its
  // recipe count, three 52 px outline buttons. The page closes the sheet before it opens the next step.
  import type { TagCount } from '../../../../shared/types.ts';
  import { dt } from '../../i18n/de-screens-tags.ts';
  import Button from '../Button.svelte';
  import Sheet from '../Sheet.svelte';

  interface Props {
    tag: TagCount;
    /** false when no other tag exists to merge into. */
    canMerge: boolean;
    onpick: (action: TagAction) => void;
    onclose: () => void;
  }

  let { tag, canMerge, onpick, onclose }: Props = $props();
</script>

<!-- display: contents; only scopes the rule for long names below. -->
<div class="tag-menu">
  <Sheet title={tag.name} meta={dt.recipes(tag.count)} {onclose}>
    <div class="actions">
      <Button variant="outline" size={52} full icon="pencil" onclick={() => onpick('rename')}>{dt.rename}</Button>
      <Button variant="outline" size={52} full icon="tag" disabled={!canMerge} onclick={() => onpick('merge')}>
        {dt.merge}
      </Button>
      <Button variant="outline" size={52} full icon="trash" onclick={() => onpick('delete')}>{dt.delete}</Button>
    </div>
  </Sheet>
</div>

<style>
  .tag-menu {
    display: contents;
  }

  /* A 40-character name without a space wraps instead of widening the sheet (NF-08). */
  .tag-menu :global(h2) {
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 4px;
  }
</style>
