<script lang="ts">
  // Bottom sheet (generator phoneFilter): scrim, raised surface with 28 px top corners, handle, title,
  // close button. Native modal <dialog>: focus stays inside, Escape closes (NF-11); the Android back
  // button and the iOS back gesture close it and keep the page (F-34, via router.pushOverlay).
  // Dragging the handle down closes it too; the close button is the visible alternative (NF-07).
  // Render it conditionally ({#if open}<Sheet onclose={() => (open = false)}>…) — mount opens it.
  import { onMount, type Snippet } from 'svelte';
  import { de } from '../i18n/de.ts';
  import { lockScroll } from '../lib/overlay.ts';
  import { router } from '../lib/router.svelte.ts';
  import IconButton from './IconButton.svelte';

  interface Props {
    title: string;
    /** Short text next to the title, e.g. "14 Treffer". */
    meta?: string | undefined;
    onclose: () => void;
    /** Full height (filter sheet: 32 px below the top) instead of fitting the content. */
    full?: boolean;
    children: Snippet;
  }

  let { title, meta, onclose, full = false, children }: Props = $props();

  const titleId = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();
  let dragStart: number | null = null;
  let dragY = $state(0);

  onMount(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    // Escape: close through the parent so its state stays the single source of truth.
    event.preventDefault();
    onclose();
  }

  function onbackdrop(event: MouseEvent): void {
    // The panel fills the dialog box, so a click whose target is the dialog hit the backdrop.
    if (event.target === dialog) onclose();
  }

  function onpointerdown(event: PointerEvent): void {
    if (event.target instanceof Element && event.target.closest('button')) return;
    dragStart = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onpointermove(event: PointerEvent): void {
    if (dragStart === null) return;
    dragY = Math.max(0, event.clientY - dragStart);
  }

  function onpointerup(): void {
    if (dragStart === null) return;
    dragStart = null;
    if (dragY > 96) onclose();
    else dragY = 0;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class={['sheet', { full }]} aria-labelledby={titleId} {oncancel} onclick={onbackdrop}>
  <div class="panel" style:transform={dragY > 0 ? `translateY(${dragY}px)` : undefined}>
    <!-- svelte-ignore a11y_no_static_element_interactions (drag gesture; the close button is the alternative, NF-07) -->
    <div class="grab" {onpointerdown} {onpointermove} {onpointerup} onpointercancel={onpointerup}>
      <span class="handle" aria-hidden="true"></span>
      <div class="head">
        <div class="titles">
          <h2 id={titleId} class="title-section">{title}</h2>
          {#if meta}<span class="meta">{meta}</span>{/if}
        </div>
        <IconButton icon="close" label={de.common.close} onclick={onclose} />
      </div>
    </div>
    <div class="body">
      {@render children()}
    </div>
  </div>
</dialog>

<style>
  .sheet {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-width: none;
    height: auto;
    max-height: calc(100dvh - 32px);
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text);
    overflow: visible;
  }

  .sheet.full {
    height: calc(100dvh - 32px);
  }

  .sheet::backdrop {
    background: var(--color-scrim);
  }

  /* Tablets: a centered bottom sheet instead of an edge-to-edge one. */
  @media (min-width: 600px) {
    .sheet {
      max-width: 560px;
      margin-inline: auto;
    }
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    max-height: calc(100dvh - 32px);
    padding: 10px 20px calc(20px + var(--safe-bottom));
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    background: var(--color-surface-raised);
    box-shadow: 0 -8px 24px var(--color-shadow);
    animation: sheet-in 220ms ease-out;
  }

  .grab {
    display: flex;
    flex-direction: column;
    gap: 14px;
    touch-action: none;
  }

  .handle {
    align-self: center;
    width: 40px;
    height: 5px;
    border-radius: 3px;
    background: var(--color-border-strong);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .titles {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .meta {
    font-size: var(--text-label);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  @keyframes sheet-in {
    from {
      transform: translateY(100%);
    }
  }
</style>
