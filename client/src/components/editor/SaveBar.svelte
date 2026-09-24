<script lang="ts">
  // Fixed bottom bar "Abbrechen" + "Speichern" (editor artboards). Phone: both buttons share the width
  // (16/20/20 px padding, top border); from 600 px they sit right-aligned at 180/220 px (12/24/16 px);
  // at ≥ 1024 px the bar spans the content area next to the rail.
  // NF-07, NF-11: neither the bar nor the on-screen keyboard hides the focused element. Keyboards shrink
  // only the visual viewport (iOS, Android Chrome), so the bar is lifted by the hidden part (visualViewport
  // resize and scroll) and a spacer keeps the last fields reachable. The bar's height goes to the page's
  // scroll-padding-bottom (--bottom-bar, base.css), so the browser scrolls a focused element (Tab) above
  // it; after focusin and when the keyboard height changes, the focused element of the form is corrected
  // above the bar once more. Scrolling alone never pulls the page back, so the form stays scrollable.
  import { onMount } from 'svelte';
  import { deEditor } from '../../i18n/de-editor.ts';
  import Button from '../Button.svelte';

  interface Props {
    saving: boolean;
    canSave: boolean;
    /** Tablet style: right-aligned fixed-width buttons. */
    compact: boolean;
    onsave: () => void;
    oncancel: () => void;
  }

  let { saving, canSave, compact, onsave, oncancel }: Props = $props();

  let bar: HTMLDivElement | undefined = $state();
  let height = $state(0);
  /** Height of the layout viewport hidden below the visual viewport (keyboard), in px. */
  let offset = $state(0);

  const FOCUS_MARGIN = 12;
  /** Pinch zoom also shrinks the visual viewport; then the bar stays where it is. */
  const ZOOMED = 1.05;

  function keyboardOffset(): number {
    const vv = window.visualViewport;
    if (!vv || vv.scale > ZOOMED) return 0;
    const hidden = window.innerHeight - vv.height - vv.offsetTop;
    return hidden > 1 ? Math.round(hidden) : 0;
  }

  /** Scrolls the focused element of the form into the area between the top and the bar. */
  function keepFocusVisible(): void {
    const el = document.activeElement;
    // Every focusable element of the form (fields, row menus, add buttons, "Weitere Angaben"); not the
    // bar's own buttons (outside the form) and nothing inside a dialog or sheet.
    if (!(el instanceof HTMLElement) || !bar || !el.closest('form') || el.closest('dialog')) return;
    const top = window.visualViewport?.offsetTop ?? 0;
    const bottom = bar.getBoundingClientRect().top;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > bottom - FOCUS_MARGIN) {
      const room = bottom - top - 2 * FOCUS_MARGIN;
      // A textarea taller than the free space shows its start (where the caret usually is).
      const delta = rect.height > room ? rect.top - top - FOCUS_MARGIN : rect.bottom - bottom + FOCUS_MARGIN;
      window.scrollBy(0, delta);
    } else if (rect.top < top + FOCUS_MARGIN) {
      window.scrollBy(0, rect.top - top - FOCUS_MARGIN);
    }
  }

  // Scroll padding of the page while the editor is open (rule in base.css).
  $effect(() => {
    const root = document.documentElement.style;
    root.setProperty('--bottom-bar', `${height + offset + FOCUS_MARGIN}px`);
    return () => root.removeProperty('--bottom-bar');
  });

  onMount(() => {
    const vv = window.visualViewport;
    const keyboardHeight = (): number => (vv ? Math.round(window.innerHeight - vv.height) : 0);
    let keyboard = keyboardHeight();
    let frame = 0;
    let refocus = false;
    const place = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        offset = keyboardOffset();
        if (!refocus) return;
        refocus = false;
        // Wait for the lifted bar to render before measuring against it.
        requestAnimationFrame(keepFocusVisible);
      });
    };
    // The keyboard opened, closed or changed its height: keep the focused element visible once.
    const onResize = (): void => {
      if (vv && vv.scale <= ZOOMED) {
        const next = keyboardHeight();
        if (next !== keyboard) refocus = true;
        keyboard = next;
      }
      place();
    };
    // Scrolling the visual viewport (iOS with the keyboard open) only moves the bar along.
    const onScroll = (): void => place();
    // The browser scrolls a focused field into view first; correct it afterwards for the bar.
    const onFocus = (): void => {
      requestAnimationFrame(keepFocusVisible);
    };
    // A ResizeObserver instead of bind:offsetHeight keeps that runtime part out of the entry chunk.
    const observer = new ResizeObserver(() => {
      height = bar?.offsetHeight ?? 0;
    });
    if (bar) observer.observe(bar);
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onScroll);
    document.addEventListener('focusin', onFocus);
    place();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', onFocus);
    };
  });
</script>

<div class="spacer" style:height="{height + offset}px" aria-hidden="true"></div>
<div
  bind:this={bar}
  class={['bar', { compact, keyboard: offset > 0 }]}
  style:transform={offset > 0 ? `translateY(${-offset}px)` : undefined}
>
  <Button variant="outline" grow={!compact} class="cancel" onclick={oncancel}>{deEditor.cancel}</Button>
  <Button grow={!compact} class="save" busy={saving} disabled={!canSave} onclick={onsave}>
    {deEditor.save}
  </Button>
</div>

<style>
  .spacer {
    flex-shrink: 0;
  }

  .bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    display: flex;
    gap: 8px;
    padding: 16px calc(20px + var(--safe-right)) calc(20px + var(--safe-bottom)) calc(20px + var(--safe-left));
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
  }

  .bar.compact {
    justify-content: flex-end;
    padding: 12px calc(24px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(24px + var(--safe-left));
  }

  .bar.compact :global(.cancel) {
    width: 180px;
  }

  .bar.compact :global(.save) {
    width: 220px;
  }

  /* With the keyboard open the home indicator is covered; keep the bar low so fields stay visible. */
  .bar.keyboard {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  @media (min-width: 1024px) {
    .bar {
      left: calc(88px + var(--safe-left));
    }
  }
</style>
