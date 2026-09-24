<script lang="ts">
  // Row menu of ingredients, groups and steps (artboard: "Zeilenmenü: verschieben, entfernen"): a bottom
  // sheet (Kap. 6.1) with "Nach oben", "Nach unten" and "Entfernen". The buttons are the visible
  // alternative to dragging (NF-07); the sheet stays open while moving, so several steps are quick.
  // The new position is announced in a live region inside the sheet: the modal dialog makes the page
  // (and its live region) inert. At the first or last position the pressed button is disabled; the
  // focus then moves to the other move button or to "Entfernen" instead of dropping to <body> (NF-11).
  import { tick } from 'svelte';
  import { deEditor } from '../../i18n/de-editor.ts';
  import Button from '../Button.svelte';
  import Sheet from '../Sheet.svelte';

  interface Props {
    title: string;
    /** "Position 3 von 5". */
    meta: string;
    canUp: boolean;
    canDown: boolean;
    onup: () => void;
    ondown: () => void;
    onremove: () => void;
    onclose: () => void;
  }

  let { title, meta, canUp, canDown, onup, ondown, onremove, onclose }: Props = $props();

  let actions: HTMLDivElement | undefined = $state();
  let status = $state('');

  async function move(up: boolean): Promise<void> {
    if (up) onup();
    else ondown();
    status = '';
    await tick();
    status = meta;
    const [upButton, downButton, removeButton] = actions ? [...actions.querySelectorAll('button')] : [];
    const other = up ? downButton : upButton;
    if ((up ? upButton : downButton)?.disabled) (other && !other.disabled ? other : removeButton)?.focus();
  }
</script>

<Sheet {title} {meta} {onclose}>
  <div class="actions" bind:this={actions}>
    <Button variant="outline" size={52} full icon="chevUp" disabled={!canUp} onclick={() => void move(true)}>
      {deEditor.menu.up}
    </Button>
    <Button variant="outline" size={52} full icon="chevDown" disabled={!canDown} onclick={() => void move(false)}>
      {deEditor.menu.down}
    </Button>
    <Button variant="outline" size={52} full icon="trash" onclick={onremove}>{deEditor.menu.remove}</Button>
  </div>
  <p class="visually-hidden" role="status">{status}</p>
</Sheet>

<style>
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 4px;
  }
</style>
