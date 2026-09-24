<script lang="ts">
  // Mark of a field the user had changed before "Neu laden" (F-07): the form shows the server version,
  // this note shows the own value and offers "Meine Änderung übernehmen". Vanilla surface with dark
  // text like the hint box of the editor artboard; icon and text, not color alone (NF-13).
  import { deEditor } from '../../i18n/de-editor.ts';
  import Icon from '../Icon.svelte';

  interface Props {
    /** Short description of the own value ("3 Zutaten", "Kässpätzle"). */
    preview: string;
    ontakeover: () => void;
  }

  let { preview, ontakeover }: Props = $props();
</script>

<div class="mark" role="note">
  <p class="text">
    <Icon name="info" size={20} />
    <span>{deEditor.conflict.mark} <strong>{preview}</strong></span>
  </p>
  <button type="button" class="take" onclick={ontakeover}>{deEditor.conflict.takeOver}</button>
</div>

<style>
  .mark {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 14px;
    border-radius: var(--radius-row);
    background: var(--color-highlight);
    color: var(--color-ink);
  }

  .text {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: var(--text-label);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .text :global(svg) {
    margin-top: 1px;
  }

  .take {
    height: 44px;
    padding: 0 16px;
    border: 1.5px solid var(--color-ink);
    border-radius: 22px;
    background: transparent;
    color: var(--color-ink);
    font-size: var(--text-label);
    font-weight: 700;
  }

  /* The page focus color (Linen in dark mode) would vanish on Vanilla. */
  .take:focus-visible {
    outline-color: var(--color-ink);
  }
</style>
