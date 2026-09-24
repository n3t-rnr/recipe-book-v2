<script lang="ts">
  // Modal dialog of the component sheet (e.g. version conflict): raised surface, 28 px radius, title,
  // text, stacked actions. Only for final actions and discarding input (F-35). Native modal <dialog>:
  // focus stays inside, Escape and Back close it (NF-11, F-34). Render conditionally; mount opens it.
  import { onMount, type Snippet } from 'svelte';
  import { lockScroll } from '../lib/overlay.ts';
  import { router } from '../lib/router.svelte.ts';

  interface Props {
    title: string;
    text?: string | undefined;
    onclose: () => void;
    /** alertdialog for confirmations of final actions. */
    alert?: boolean;
    /**
     * Where focus starts: the first action (default) or "cancel", the last action (by convention
     * "Abbrechen"). Irreversible confirmations use "cancel", so Enter or a stray tap on the focused
     * button cannot delete anything (NF-11, WAI-ARIA alertdialog).
     */
    initialFocus?: 'first' | 'cancel';
    /** Optional extra content between text and actions. */
    children?: Snippet | undefined;
    /** Buttons, stacked (use Button with full). */
    actions: Snippet;
  }

  let { title, text, onclose, alert = false, initialFocus = 'first', children, actions }: Props = $props();

  const id = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();
  let actionBox: HTMLDivElement | undefined = $state();

  onMount(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // showModal() focuses the first element with autofocus, else the first focusable one.
    const cancel = initialFocus === 'cancel' ? actionBox?.lastElementChild : null;
    if (cancel instanceof HTMLElement) cancel.autofocus = true;
    dialog?.showModal();
    const unlock = lockScroll();
    const release = router.pushOverlay(() => onclose());
    return () => {
      release();
      unlock();
      opener?.focus({ preventScroll: true });
    };
  });

  function oncancel(event: Event): void {
    event.preventDefault();
    onclose();
  }

  function onbackdrop(event: MouseEvent): void {
    if (event.target === dialog) onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  class="dialog"
  role={alert ? 'alertdialog' : undefined}
  aria-labelledby="{id}-title"
  aria-describedby={text ? `${id}-text` : undefined}
  {oncancel}
  onclick={onbackdrop}
>
  <div class="panel">
    <h2 id="{id}-title" class="title">{title}</h2>
    {#if text}<p id="{id}-text" class="text">{text}</p>{/if}
    {@render children?.()}
    <div class="actions" bind:this={actionBox}>{@render actions()}</div>
  </div>
</dialog>

<style>
  .dialog {
    width: calc(100% - 32px);
    max-width: 420px;
    max-height: calc(100dvh - 32px);
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text);
    overflow: visible;
  }

  .dialog::backdrop {
    background: var(--color-scrim);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 22px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sheet);
    background: var(--color-surface-raised);
    box-shadow: 0 16px 40px var(--color-shadow);
    animation: dialog-in 160ms ease-out;
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.3px;
  }

  .text {
    font-size: 1rem;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  @keyframes dialog-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }
</style>
