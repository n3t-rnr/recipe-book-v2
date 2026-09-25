<script lang="ts">
  // Full-screen photo (F-29 AK "Antippen öffnet l", NF-06: only this view loads variant l). Loaded lazily
  // by the detail. Native modal <dialog> on the page background: Escape, the close button (48 px), a tap
  // beside the photo and the Android back button or iOS back gesture close it (router.pushOverlay, F-34).
  // No artboard of its own: built from tokens and the overlay button (NF-16).
  import { onMount } from 'svelte';
  import type { DetailImage } from '../../../shared/types.ts';
  import { de } from '../i18n/de.ts';
  import { lockScroll } from '../lib/overlay.ts';
  import { router } from '../lib/router.svelte.ts';
  import IconButton from './IconButton.svelte';

  interface Props {
    image: DetailImage;
    /** The recipe title. */
    alt: string;
    onclose: () => void;
  }

  let { image, alt, onclose }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();

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
    event.preventDefault();
    onclose();
  }

  function onclick(event: MouseEvent): void {
    if (event.target === dialog) onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (Escape and the close button are the keyboard way) -->
<dialog bind:this={dialog} class="lightbox" aria-label={alt} {oncancel} {onclick}>
  <img src={image.urls.l} {alt} width={image.width} height={image.height} decoding="async" />
  <div class="close"><IconButton variant="overlay" icon="close" label={de.common.close} onclick={onclose} /></div>
</dialog>

<style>
  .lightbox {
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--color-bg);
  }

  .lightbox[open] {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* max-width: 100% comes from base.css; auto sizes keep the aspect ratio within both limits. */
  img {
    width: auto;
    height: auto;
    max-height: 100%;
  }

  .close {
    position: absolute;
    top: calc(12px + var(--safe-top));
    right: calc(12px + var(--safe-right));
  }
</style>
