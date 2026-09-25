<script lang="ts">
  // One row of the tag page (Kap. 6.3 „Tags“, F-19): the count chip of the component sheet links to the
  // list filtered by the tag (like the detail's tag chips), the ⋮ button opens the row menu. While the
  // tag is renamed, the name form replaces both („Umbenennen (inline)“). No artboard (NF-16, M7 set).
  import type { TagCount } from '../../../../shared/types.ts';
  import { de } from '../../i18n/de.ts';
  import { dt } from '../../i18n/de-screens-tags.ts';
  import { paths } from '../../lib/routes.ts';
  import Chip from '../Chip.svelte';
  import IconButton from '../IconButton.svelte';
  import TagNameForm from './TagNameForm.svelte';

  interface Props {
    tag: TagCount;
    /** Shows the rename form instead of chip and menu button. */
    renaming?: boolean;
    busy?: boolean;
    /** Server error of the rename request. */
    error?: string | null;
    onmenu: (tag: TagCount) => void;
    onrename: (tag: TagCount, name: string) => void;
    oncancel: (tag: TagCount) => void;
  }

  let { tag, renaming = false, busy = false, error = null, onmenu, onrename, oncancel }: Props = $props();
</script>

<li class="row">
  {#if renaming}
    <TagNameForm
      value={tag.name}
      submitLabel={de.common.save}
      {busy}
      {error}
      onsubmit={(name) => onrename(tag, name)}
      oncancel={() => oncancel(tag)}
    />
  {:else}
    <Chip label={tag.name} count={tag.count} href={paths.recipes({ tags: tag.id })} />
    <!-- The id lets the page give the focus back to this button after a sheet, dialog or form (NF-11). -->
    <IconButton
      id="tag-menu-{tag.id}"
      icon="dotsV"
      label={dt.menu(tag.name)}
      haspopup="dialog"
      onclick={() => onmenu(tag)}
    />
  {/if}
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 60px;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border);
  }

  /* A name of up to 40 characters without a space (German compounds) wraps inside the chip instead of
     pushing the page sideways (NF-08); the chip then grows in height. */
  .row :global(a.chip) {
    flex-shrink: 1;
    min-width: 0;
    height: auto;
    min-height: 44px;
    padding-block: 10px;
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
