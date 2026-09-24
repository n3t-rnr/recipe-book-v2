<script lang="ts">
  // The editor's dialogs (component sheet "Dialog: Versionskonflikt"): title, text and two stacked
  // 52 px actions, primary first. Used for the version conflict (F-07), "In den Papierkorb gelegt"
  // (F-07), the draft prompt (F-09), "Änderungen verwerfen?" (F-09, F-35) and a deleted recipe.
  // Render it conditionally; Escape, Back and the backdrop call `onclose` (default: `oncancel`).
  import Button from '../Button.svelte';
  import Dialog from '../Dialog.svelte';

  interface Props {
    title: string;
    text?: string | undefined;
    confirmLabel: string;
    cancelLabel: string;
    /** Disables both actions while the confirmed action runs. */
    busy?: boolean;
    alert?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    onclose?: (() => void) | undefined;
  }

  let {
    title,
    text,
    confirmLabel,
    cancelLabel,
    busy = false,
    alert = false,
    onconfirm,
    oncancel,
    onclose,
  }: Props = $props();

  function close(): void {
    if (busy) return;
    (onclose ?? oncancel)();
  }
</script>

<Dialog {title} {text} {alert} onclose={close}>
  {#snippet actions()}
    <Button size={52} full {busy} onclick={onconfirm}>{confirmLabel}</Button>
    <Button size={52} full variant="outline" disabled={busy} onclick={oncancel}>{cancelLabel}</Button>
  {/snippet}
</Dialog>
