<script lang="ts">
  // Photo section of the editor (F-14; artboard HandyEditor for the empty state, TabletQuerEditor for the
  // upload): dashed box "Noch kein Foto" or the 3:2 preview with a trash button and, while uploading, the
  // progress panel; below it "Foto aufnehmen" (camera, JPEG only, so iOS converts HEIC) and "Bild
  // auswählen". The upload starts right after the choice, also for a recipe that is not saved yet; the
  // preview is the local file (blob: URL, allowed by the CSP) until the server's variant m has loaded.
  // A failed upload keeps the form usable and, unless the file itself was refused (413, 415), offers
  // "Erneut hochladen" with the same file; the form's photo only changes once an upload succeeded. A
  // preview the browser cannot decode (HEIC outside Safari) stays blank instead of a broken image. The
  // editor waits for a running upload before saving (pending()) and asks before leaving while a photo is
  // not in the form yet (unsaved). Start, processing and success are announced politely; the root's
  // data-photo keeps these hints out of the editor's jump to the first error. Removing is immediate with
  // "Rückgängig" (F-35).
  import { onMount, tick } from 'svelte';
  import type { DetailImage } from '../../../../shared/types.ts';
  import { deEditor } from '../../i18n/de-editor.ts';
  import { ApiError, errorMessage, isAbortError } from '../../lib/api.ts';
  import { photoPending, toDetailImage, tooLarge, type UploadPhase, uploadImage } from '../../lib/upload.ts';
  import { profile } from '../../state/profile.svelte.ts';
  import Button from '../Button.svelte';
  import Icon from '../Icon.svelte';
  import IconButton from '../IconButton.svelte';
  import FieldError from './FieldError.svelte';
  import FieldLabel from './FieldLabel.svelte';

  interface Props {
    /** The form's photo (bindable); set when an upload succeeded, null after removing. */
    image: DetailImage | null;
    /** Hint below the photo, e.g. an expired draft photo (F-09 AK) or a file over 20 MB (bindable). */
    notice?: string | null;
    /** Set here (bindable): a chosen photo is uploading or waits for "Erneut hochladen" (lib/upload.ts). */
    unsaved?: boolean;
    /** Tablet: 48 px buttons and no "optional" hint (artboard TabletQuerEditor). */
    compact?: boolean;
    onundo: (message: string, undo: () => void) => void;
    announce: (text: string) => void;
  }

  let {
    image = $bindable(),
    notice = $bindable(null),
    unsaved = $bindable(false),
    compact = false,
    onundo,
    announce,
  }: Props = $props();

  const uid = $props.id();

  /** The file being uploaded (or that failed) and its local preview. */
  let local = $state.raw<{ file: File; url: string } | null>(null);
  let phase = $state<UploadPhase>('done');
  let percent = $state(0);
  let failure = $state('');
  /** false when the server refused the file itself: sending it again cannot help. */
  let retryable = $state(true);
  /** Preview URL the browser could not decode. */
  let broken = $state<string | null>(null);
  let controller: AbortController | null = null;
  let running: Promise<void> | null = null;

  let takeButton: HTMLElement | null | undefined = $state();
  let cameraInput: HTMLInputElement | undefined = $state();
  let galleryInput: HTMLInputElement | undefined = $state();
  let section: HTMLDivElement | undefined = $state();

  const src = $derived(local?.url ?? image?.urls.m);
  const busy = $derived(phase === 'sending' || phase === 'processing');
  const size = $derived(compact ? 48 : 52);

  $effect(() => {
    unsaved = photoPending(phase, retryable);
  });

  /** A running upload's promise (it never rejects), or null; saving waits for it (F-14). */
  export function pending(): Promise<void> | null {
    return running;
  }

  /** Focuses "Foto aufnehmen" (the detail's "Foto hinzufügen" opens the editor with ?foto=1). */
  export function focus(): void {
    section?.scrollIntoView({ block: 'center' });
    takeButton?.focus({ preventScroll: true });
  }

  function forgetLocal(): void {
    controller?.abort();
    controller = null;
    running = null;
    if (local) URL.revokeObjectURL(local.url);
    local = null;
    phase = 'done';
  }

  function upload(file: File, url: string): void {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    local = { file, url };
    phase = 'sending';
    percent = 0;
    failure = '';
    notice = null;
    announce(deEditor.photo.sending);
    running = send(file, own).finally(() => {
      if (controller === own) {
        controller = null;
        running = null;
      }
    });
  }

  async function send(file: File, own: AbortController): Promise<void> {
    const profileId = profile.id;
    try {
      const res = await uploadImage(file, {
        profileId,
        signal: own.signal,
        onprogress: (p) => {
          percent = Math.round(p.fraction * 100);
          if (!p.processing || phase === 'processing') return;
          phase = 'processing';
          announce(deEditor.photo.processingPhoto);
        },
      });
      if (controller !== own) return;
      image = toDetailImage(res);
      phase = 'done';
      announce(deEditor.photo.uploaded);
      // Keep the local preview until the server's variant has loaded, so the photo does not flash.
      const next = new Image();
      next.src = res.urls.m;
      void next
        .decode()
        .catch(() => {})
        .then(() => {
          if (local?.file === file && phase === 'done') forgetLocal();
        });
    } catch (err) {
      if (isAbortError(err) || controller !== own) return;
      if (err instanceof ApiError && err.code === 'PROFILE_UNKNOWN' && profileId !== null) {
        profile.rejected(profileId);
      }
      failure = errorMessage(err);
      retryable = !(err instanceof ApiError && ['PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA'].includes(err.code));
      phase = 'failed';
    }
  }

  function onchange(event: Event & { currentTarget: HTMLInputElement }): void {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Reset, so choosing the same file again fires change again.
    input.value = '';
    if (!file) return;
    // A new choice replaces a failed attempt (a running upload continues until the new one starts).
    if (phase === 'failed') forgetLocal();
    if (tooLarge(file)) {
      notice = deEditor.photo.tooLarge;
      return;
    }
    if (local) URL.revokeObjectURL(local.url);
    const url = URL.createObjectURL(file);
    upload(file, url);
    // Probe instead of an onerror handler on the <img>: that would pull one more Svelte runtime function
    // into the entry chunk (NF-01, see lib/upload.ts).
    const probe = new Image();
    probe.src = url;
    probe.decode().catch(() => {
      broken = url;
    });
  }

  /** "Erneut hochladen" disappears with the new attempt: the focus moves on to "Foto aufnehmen". */
  function retry(): void {
    if (!local) return;
    upload(local.file, local.url);
    void tick().then(() => takeButton?.focus());
  }

  function remove(): void {
    forgetLocal();
    notice = null;
    const previous = image;
    image = null;
    if (previous) {
      onundo(deEditor.photo.removed, () => {
        image = previous;
      });
    }
    // The trash button is gone; keep the focus in the section.
    void tick().then(() => takeButton?.focus());
  }

  onMount(() => forgetLocal);
</script>

<div class="picker" role="group" aria-labelledby="{uid}-label" data-photo bind:this={section}>
  <div id="{uid}-label">
    <FieldLabel text={deEditor.photo.label} hint={compact ? undefined : deEditor.photo.optional} />
  </div>

  {#if src}
    <div class="frame">
      <img
        {src}
        alt={deEditor.photo.preview}
        width="720"
        height="480"
        style:visibility={broken === src ? 'hidden' : undefined}
      />
      <div class="trash">
        <IconButton variant="overlay" icon="trash" label={deEditor.photo.remove} onclick={remove} />
      </div>
      {#if busy}
        <div class="panel">
          <span>{phase === 'processing' ? deEditor.photo.processing : deEditor.photo.uploading(percent)}</span>
          <span
            class="bar"
            role="progressbar"
            aria-label={deEditor.photo.progress}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span class="fill" style:width="{percent}%"></span>
          </span>
        </div>
      {/if}
    </div>
  {:else}
    <div class="empty">
      <Icon name="camera" size={32} strokeWidth={1.8} />
      <strong>{deEditor.photo.empty}</strong>
      <span class="hint">{deEditor.photo.emptyHint}</span>
    </div>
  {/if}

  {#if phase === 'failed'}
    <FieldError message={deEditor.photo.failed(failure)} live />
    {#if retryable}
      <Button variant="outline" {size} icon="refresh" full onclick={retry}>{deEditor.photo.retry}</Button>
    {/if}
  {/if}
  <FieldError message={notice ?? undefined} live />

  <Button {size} icon="camera" full bind:element={takeButton} onclick={() => cameraInput?.click()}>
    {deEditor.photo.take}
  </Button>
  <Button variant="outline" {size} icon="image" full onclick={() => galleryInput?.click()}>
    {deEditor.photo.choose}
  </Button>
  <!-- Opened by the buttons above; hidden, but not display:none, which older iOS versions ignore. -->
  <input
    bind:this={cameraInput}
    class="visually-hidden"
    type="file"
    accept="image/jpeg"
    capture="environment"
    tabindex="-1"
    aria-hidden="true"
    {onchange}
  />
  <input
    bind:this={galleryInput}
    class="visually-hidden"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    tabindex="-1"
    aria-hidden="true"
    {onchange}
  />
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Empty state of the phone artboard: 180 px dashed box, camera 32 px, 16/700 and 14 px muted. */
  .empty {
    height: 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 24px;
    border: 2px dashed var(--color-border-strong);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    font-size: 1rem;
    text-align: center;
  }

  .hint {
    font-size: var(--text-meta);
    color: var(--color-text-muted);
  }

  /* Upload state of the tablet artboard: 3:2 photo, 24 px radius, trash 12 px from the corner. */
  .frame {
    position: relative;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    border-radius: var(--radius-card);
    background: var(--color-subtle);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .trash {
    position: absolute;
    top: 12px;
    right: 12px;
  }

  /* Progress panel: 12 px from the edges, 14/700 text, 6 px bar in the primary color. */
  .panel {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px 12px;
    border: 1px solid var(--color-overlay-border);
    border-radius: 16px;
    background: var(--color-overlay);
    font-size: var(--text-meta);
    font-weight: 700;
  }

  .bar {
    display: flex;
    height: 6px;
    border-radius: 3px;
    background: var(--color-subtle);
  }

  .fill {
    border-radius: 3px;
    background: var(--color-primary);
  }
</style>
