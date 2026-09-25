<script lang="ts">
  // Recipe editor for /rezepte/neu and /rezepte/:id/bearbeiten (Kap. 6.3 "Editor", artboards
  // HandyEditor and TabletQuerEditor). One continuous form: Foto · Titel · Tags · Zutaten · Zubereitung ·
  // Weitere Angaben; one column below 1024 px (tablet portrait centered, at most 720 px wide), two
  // columns from 1024 px as in the tablet artboard: at 600 px the right column would be 228 px narrow
  // and every ingredient row three lines high. The text mode (F-12) and the similar-recipe hint (F-45)
  // follow in M5. Tags: chip input with autocomplete (TagInput, F-17, F-18); saving first adds the
  // typed tag text (TagInput.commit()).
  // Photo (F-14): ImagePicker uploads right after the choice; saving waits for a running upload, a
  // failed one does not block it. A restored draft's photo is checked on the server (F-09 AK); ?foto=1
  // (the detail's "Foto hinzufügen") focuses "Foto aufnehmen".
  // Save: POST with one createKey per editor session, or PUT with the loaded version (NF-09, F-07);
  // a createKey that already created the recipe continues as PUT (createOutcome in lib/editor.ts);
  // 409 opens the conflict dialog, 410 offers "wiederherstellen und speichern". Drafts every 2 s in
  // localStorage (F-09); leaving with unsaved changes asks "Änderungen verwerfen?" (F-35), also for the
  // Android back button and the iOS back gesture (a guard entry via router.pushOverlay).
  import { onMount, tick, untrack } from 'svelte';
  import type { InTrashDetails, RecipeDetail, RecipeResponse } from '../../../shared/types.ts';
  import EmptyState from '../components/EmptyState.svelte';
  import ChoiceDialog from '../components/editor/ChoiceDialog.svelte';
  import ConflictMark from '../components/editor/ConflictMark.svelte';
  import FieldError from '../components/editor/FieldError.svelte';
  import FieldLabel from '../components/editor/FieldLabel.svelte';
  import ImagePicker from '../components/editor/ImagePicker.svelte';
  import IngredientEditor from '../components/editor/IngredientEditor.svelte';
  import MoreFields from '../components/editor/MoreFields.svelte';
  import SaveBar from '../components/editor/SaveBar.svelte';
  import StepEditor from '../components/editor/StepEditor.svelte';
  import TagInput from '../components/editor/TagInput.svelte';
  import IconButton from '../components/IconButton.svelte';
  import { de } from '../i18n/de.ts';
  import { deEditor } from '../i18n/de-editor.ts';
  import { ApiError, errorMessage, get, post, put } from '../lib/api.ts';
  import { breakpoints } from '../lib/breakpoints.svelte.ts';
  import { browserStorage, draftKey, draftSync, pruneDrafts, readDraft, removeDraft } from '../lib/draft.ts';
  import {
    applyField,
    buildRequest,
    cloneForm,
    createOutcome,
    deletedWhen,
    diffFields,
    type EditorDraft,
    type EditorForm,
    type FieldErrors,
    type FieldMap,
    type FieldName,
    fieldPreview,
    firstError,
    formFromDetail,
    formKey,
    mapDetails,
    newCreateKey,
    newForm,
    parseEditorDraft,
    type SaveContext,
    draftWhen,
    validationDetails,
    verifyDraftImage,
  } from '../lib/editor.ts';
  import { router } from '../lib/router.svelte.ts';
  import { paths } from '../lib/routes.ts';
  import { imageState } from '../lib/upload.ts';
  import { toast } from '../state/toast.svelte.ts';

  interface Props {
    /** null = new recipe (/rezepte/neu). */
    id: number | null;
  }

  let { id }: Props = $props();

  // The route remounts per path (App.svelte), so the id is fixed for this instance.
  const recipeId = untrack(() => id);
  const uid = $props.id();
  const storage = browserStorage();
  const storageKey = draftKey(recipeId);
  const drafts = draftSync(storage, storageKey);
  const fallback = recipeId === null ? paths.recipes() : paths.recipe(recipeId);
  const AUTOSAVE_MS = 2000;
  /** Opened from the detail's "Foto hinzufügen": start at the photo instead of the title. */
  const photoFirst = untrack(() => router.query.get('foto') === '1');
  /** Fields under "Weitere Angaben"; the section opens when one of them has a value, error or offer. */
  const MORE_FIELDS = ['servings', 'servingsUnit', 'prepMinutes', 'cookMinutes', 'source', 'description'] as const;
  const isMoreField = (field: string): boolean => (MORE_FIELDS as readonly string[]).includes(field);

  type Phase = 'loading' | 'ready' | 'notFound' | 'inTrash' | 'error';
  type LeaveTarget = { kind: 'back' } | { kind: 'link'; href: string };
  type DialogState =
    | { kind: 'draft'; when: string; draft: EditorDraft }
    | { kind: 'discard'; then: LeaveTarget }
    | { kind: 'conflict'; current: RecipeDetail }
    | { kind: 'trash'; by: string | null }
    | { kind: 'gone' };

  let phase = $state<Phase>(recipeId === null ? 'ready' : 'loading');
  let loadError = $state('');
  let trashInfo = $state.raw<InTrashDetails | null>(null);
  let loaded = $state.raw<RecipeDetail | null>(null);

  let form = $state<EditorForm>(newForm(untrack(() => router.query.get('title') ?? '')));
  /** The state the edit started from: dirty tracking and the conflict diff compare against it. */
  let baseline = $state.raw<EditorForm>(untrack(() => cloneForm(form)));
  let version = $state<number | null>(null);
  /** POST instead of PUT: a new recipe, or "Als neues Rezept speichern" after it was purged. */
  let asNew = $state(recipeId === null);
  let createKey = newCreateKey();
  /** Recipe a PUT goes to; a new recipe gets it when its createKey turns out to be used already. */
  let targetId = recipeId;

  /** Pending "Meine Änderung übernehmen" offers after "Neu laden" (F-07) and the own version. */
  let offers = $state<FieldName[]>([]);
  let mine = $state.raw<EditorForm | null>(null);

  let errors = $state<FieldErrors>({});
  let liveValidation = $state(false);
  let lastMap: FieldMap = { ingredientKeys: [], groupKeys: [], stepKeys: [] };
  let saving = $state(false);
  let titleTouched = $state(false);
  let moreOpen = $state(false);
  let dialog = $state.raw<DialogState | null>(null);
  let dialogBusy = $state(false);
  let restoring = $state(false);
  let announcement = $state('');
  /** Hint in the photo section: expired draft photo (F-09 AK), file over 20 MB. */
  let imageNotice = $state<string | null>(null);
  /** A chosen photo is still uploading or waits for "Erneut hochladen": leaving would lose it (F-14). */
  let photoUnsaved = $state(false);

  let formEl: HTMLFormElement | undefined = $state();
  let titleEl: HTMLInputElement | undefined = $state();
  let picker: ReturnType<typeof ImagePicker> | undefined = $state();
  let tagInput: ReturnType<typeof TagInput> | undefined = $state();

  let leaving = false;
  let destroyed = false;
  let draftActive = false;
  /** A mouse button or finger is down (onTitleBlur). */
  let pressing = false;
  let hintAfterPress = false;
  let guardRelease: (() => void) | null = null;
  /** The last closed dialog's history step (closeDialog). */
  let dialogClosed = Promise.resolve();
  let undoToast: number | null = null;
  let failToast: number | null = null;

  const phone = $derived(breakpoints.phone);
  /** Two columns from 1024 px (tablet landscape artboard). */
  const columns = $derived(breakpoints.wide);
  const baselineKey = $derived(formKey(baseline));
  const dirty = $derived(phase === 'ready' && (offers.length > 0 || formKey(form) !== baselineKey));
  /** Leaving asks first (F-09, F-35): unsaved changes, or a photo not in the form yet. No draft for the latter. */
  const mustAsk = $derived(dirty || photoUnsaved);
  const canSave = $derived(phase === 'ready' && form.title.trim() !== '');
  /** Changes besides the photo: a photo taken first (scenarios S2, S3) does not flag the title yet. */
  const textDirty = $derived(dirty && formKey({ ...form, image: baseline.image }) !== baselineKey);
  const titleError = $derived(
    errors.title ?? (form.title.trim() === '' && (titleTouched || textDirty) ? deEditor.title.missing : undefined),
  );
  const heading = $derived(recipeId === null ? deEditor.titleNew : deEditor.titleEdit);

  // ---------------------------------------------------------------- loading and drafts

  function hasMoreValues(f: EditorForm): boolean {
    return MORE_FIELDS.some((field) => {
      const value = f[field].trim();
      return field === 'servingsUnit' ? value !== '' && value !== deEditor.more.defaultServingsUnit : value !== '';
    });
  }

  function applyLoaded(recipe: RecipeDetail): void {
    loaded = recipe;
    form = formFromDetail(recipe);
    baseline = cloneForm(form);
    version = recipe.version;
    moreOpen = hasMoreValues(form);
    document.title = `${deEditor.documentTitle(recipe.title)} – ${de.appName}`;
  }

  function readTrashDetails(details: unknown): InTrashDetails | null {
    if (typeof details !== 'object' || details === null) return null;
    const { deletedAt, deletedBy } = details as Record<string, unknown>;
    if (typeof deletedAt !== 'string') return null;
    const by =
      typeof deletedBy === 'object' && deletedBy !== null && typeof (deletedBy as { name?: unknown }).name === 'string'
        ? (deletedBy as { id: number; name: string })
        : null;
    return { deletedAt, deletedBy: by };
  }

  function readCurrent(details: unknown): RecipeDetail | null {
    const current = (details as { current?: unknown } | null)?.current;
    if (typeof current !== 'object' || current === null) return null;
    const c = current as Record<string, unknown>;
    // Our own server built it (VersionConflictDetails); check the parts the editor relies on.
    const ok =
      typeof c.id === 'number' &&
      typeof c.version === 'number' &&
      typeof c.title === 'string' &&
      Array.isArray(c.ingredients) &&
      Array.isArray(c.steps) &&
      Array.isArray(c.tags);
    return ok ? (current as RecipeDetail) : null;
  }

  async function load(): Promise<void> {
    if (recipeId === null) return;
    phase = 'loading';
    try {
      const res = await get<RecipeResponse>(`/recipes/${recipeId}`);
      applyLoaded(res.recipe);
      phase = 'ready';
      offerDraft();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        phase = 'notFound';
      } else if (err instanceof ApiError && err.code === 'IN_TRASH') {
        trashInfo = readTrashDetails(err.details);
        phase = 'inTrash';
      } else {
        loadError = errorMessage(err);
        phase = 'error';
      }
    }
  }

  async function restoreFromTrash(): Promise<void> {
    if (recipeId === null || restoring) return;
    restoring = true;
    try {
      const res = await post<RecipeResponse>(`/recipes/${recipeId}/restore`);
      applyLoaded(res.recipe);
      phase = 'ready';
      offerDraft();
    } catch (err) {
      toast.show(errorMessage(err));
    } finally {
      restoring = false;
    }
  }

  /** F-09: a stored draft is offered before anything overwrites it. */
  function offerDraft(): void {
    const stored = readDraft(storage, storageKey, parseEditorDraft, new Date());
    if (stored) {
      dialog = { kind: 'draft', when: draftWhen(stored.savedAt), draft: stored.data };
    } else {
      draftActive = true;
      focusTitle();
    }
  }

  function restoreDraft(draft: EditorDraft): void {
    form = draft.form;
    if (recipeId !== null) {
      // Keep the version the draft started from: if the recipe changed since, saving shows the conflict.
      if (draft.base) baseline = draft.base;
      if (draft.version !== null) version = draft.version;
    }
    if (draft.createKey !== null) createKey = draft.createKey;
    if (draft.conflict) {
      mine = draft.conflict.mine;
      offers = [...draft.conflict.fields];
    }
    moreOpen = hasMoreValues(form) || offers.some(isMoreField);
    dialog = null;
    draftActive = true;
    // The stored draft is the restored one: autosave rewrites it, or removes it once nothing is changed.
    drafts.adopt();
    focusTitle();
    void checkDraftImage(recipeId === null ? null : baseline);
  }

  /**
   * F-09 AK: the draft's photo may have expired on the server; then it leaves the form with a hint, and
   * the stored draft at once, so a draft that held nothing else is not offered again.
   */
  async function checkDraftImage(base: EditorForm | null): Promise<void> {
    if (!(await verifyDraftImage(form, base, (id) => imageState(id)))) return;
    imageNotice = deEditor.photo.gone;
    autosave();
  }

  function dropDraft(): void {
    removeDraft(storage, storageKey);
    dialog = null;
    draftActive = true;
    focusTitle();
  }

  /**
   * Leaving the empty title shows its hint, which pushes everything below it down (one column below
   * 1024 px). A press elsewhere takes the focus before its click, so a hint shown at once would move the
   * pressed button away and the click would miss it (b4). The hint waits until the pointer is up and the
   * current event with its click is through.
   */
  function onTitleBlur(): void {
    if (pressing) hintAfterPress = true;
    else setTimeout(() => (titleTouched = true));
  }

  function onPointer(event: Event): void {
    pressing = event.type === 'pointerdown';
    if (!pressing && hintAfterPress) {
      hintAfterPress = false;
      onTitleBlur();
    }
  }

  /** Focus at the start: the title of a new recipe, or "Foto aufnehmen" after "Foto hinzufügen". */
  function focusTitle(): void {
    if (!photoFirst && recipeId !== null) return;
    void tick().then(() => requestAnimationFrame(() => (photoFirst ? picker?.focus() : titleEl?.focus())));
  }

  /** Writes the draft when something changed; removes it when the form is back to its start. */
  function autosave(): void {
    if (!draftActive || leaving || phase !== 'ready') return;
    if (!dirty) {
      drafts.drop();
      return;
    }
    const payload: EditorDraft = {
      form: cloneForm(form),
      base: recipeId === null ? null : baseline,
      version,
      // A new recipe keeps its createKey also after it continued as PUT: a restored draft then finds
      // the recipe again instead of creating a second one (NF-09).
      createKey: asNew || recipeId === null ? createKey : null,
      conflict: mine && offers.length > 0 ? { mine, fields: [...offers] } : null,
    };
    drafts.keep(payload, new Date());
  }

  // ---------------------------------------------------------------- feedback helpers

  function announce(text: string): void {
    announcement = '';
    void tick().then(() => {
      announcement = text;
    });
  }

  /** One undo toast at a time; a newer removal replaces the older offer (F-35). */
  function notifyUndo(message: string, undo: () => void): void {
    if (undoToast !== null) toast.dismiss(undoToast);
    undoToast = toast.show(message, { undo });
  }

  function dismissToasts(): void {
    if (undoToast !== null) toast.dismiss(undoToast);
    if (failToast !== null) toast.dismiss(failToast);
    undoToast = null;
    failToast = null;
  }

  async function showErrors(next: FieldErrors): Promise<void> {
    errors = next;
    liveValidation = true;
    if (next.form) toast.show(next.form);
    if (Object.keys(next).some(isMoreField)) moreOpen = true;
    await tick();
    const target = firstError(formEl?.querySelectorAll<HTMLElement>('[aria-invalid="true"], .field-error') ?? []);
    if (!target) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    if (target.matches('input, textarea')) target.focus({ preventScroll: true });
  }

  function saveContext(): SaveContext {
    return asNew ? { kind: 'create', createKey } : { kind: 'update', version: version ?? 1 };
  }

  // After a failed save, errors follow the input live until everything is valid again.
  $effect(() => {
    if (!liveValidation) return;
    const built = buildRequest(form, untrack(saveContext));
    untrack(() => {
      lastMap = built.map;
      errors = built.ok ? {} : built.errors;
      if (built.ok) liveValidation = false;
    });
  });

  // ---------------------------------------------------------------- saving

  async function save(options: { force?: boolean } = {}): Promise<void> {
    if (saving || !canSave) return;
    const upload = picker?.pending();
    if (upload) {
      // F-14: saving waits for a running upload; a failed one leaves the photo as it was.
      saving = true;
      announce(deEditor.photo.waiting);
      await upload;
      saving = false;
      if (destroyed || leaving) return;
      await save(options);
      return;
    }
    // The typed, not yet added tag belongs to what is saved (F-17).
    tagInput?.commit();
    if (failToast !== null) toast.dismiss(failToast);
    failToast = null;
    const sent = cloneForm(form);
    const built = buildRequest(sent, saveContext());
    lastMap = built.map;
    if (!built.ok) {
      await showErrors(built.errors);
      return;
    }
    errors = {};
    liveValidation = false;
    saving = true;
    try {
      if (!asNew) {
        const res = await put<RecipeResponse>(
          `/recipes/${targetId}`,
          built.body,
          options.force ? { query: { force: true } } : undefined,
        );
        await finishSaved(res.recipe);
        return;
      }
      const res = await post<RecipeResponse>('/recipes', built.body);
      const outcome = createOutcome(sent, res.recipe);
      if (outcome === 'saved') {
        await finishSaved(res.recipe);
        return;
      }
      // The createKey had created this recipe before (lost answer, restored draft) and it lacks the
      // later input (F-09 AK): continue as an edit of it; the draft stays until that is saved.
      asNew = false;
      targetId = res.recipe.id;
      version = res.recipe.version;
      if (outcome === 'conflict') {
        dialog = { kind: 'conflict', current: res.recipe };
        return;
      }
      baseline = formFromDetail(res.recipe);
      saving = false;
      await save();
    } catch (err) {
      saving = false;
      await handleSaveError(err);
    } finally {
      saving = false;
    }
  }

  async function handleSaveError(err: unknown): Promise<void> {
    if (!(err instanceof ApiError)) {
      toast.show(errorMessage(err));
      return;
    }
    switch (err.code) {
      case 'VALIDATION': {
        const { image: imageGone, ...mapped } = mapDetails(validationDetails(err.details), lastMap);
        if (imageGone !== undefined) {
          // Unknown or taken imageId (Kap. 4.6): the photo is gone; drop it and say so at the picker.
          form.image = null;
          imageNotice = deEditor.photo.gone;
        }
        if (Object.keys(mapped).length > 0) await showErrors(mapped);
        else if (imageGone === undefined) toast.show(err.message);
        else picker?.focus();
        return;
      }
      case 'VERSION_CONFLICT': {
        const current = readCurrent(err.details);
        if (!current) {
          toast.show(err.message);
        } else if (formKey(formFromDetail(current)) === formKey(form)) {
          // The first attempt got through although its answer was lost (timeout): already saved.
          await finishSaved(current);
        } else {
          dialog = { kind: 'conflict', current };
        }
        return;
      }
      case 'IN_TRASH':
        dialog = { kind: 'trash', by: readTrashDetails(err.details)?.deletedBy?.name ?? null };
        return;
      case 'NOT_FOUND':
        dialog = { kind: 'gone' };
        return;
      case 'NETWORK':
      case 'TIMEOUT':
        // F-09 AK: everything stays; the same createKey makes the retry safe (NF-09).
        failToast = toast.show(deEditor.saving.failed, {
          action: { label: deEditor.saving.retry, run: () => save() },
        });
        return;
      default:
        toast.show(err.message);
    }
  }

  async function finishSaved(recipe: RecipeDetail): Promise<void> {
    leaving = true;
    removeDraft(storage, storageKey);
    dismissToasts();
    await closeDialog();
    await releaseGuard();
    // Coming from the detail of this recipe: go back to it instead of stacking a second entry (F-34).
    if (!asNew && router.previousPath() === paths.recipe(recipe.id)) router.back(paths.recipe(recipe.id));
    else router.navigate(paths.recipe(recipe.id), { replace: true });
  }

  // ---------------------------------------------------------------- dialogs

  function reloadFromServer(current: RecipeDetail): void {
    const own = cloneForm(form);
    const changed = diffFields(baseline, own);
    dismissToasts();
    applyLoaded(current);
    mine = changed.length > 0 ? own : null;
    offers = changed;
    errors = {};
    liveValidation = false;
    if (changed.some(isMoreField)) moreOpen = true;
    dialog = null;
    drafts.adopt();
    autosave();
    toast.show(deEditor.conflict.reloaded);
  }

  function takeOver(field: FieldName): void {
    if (!mine) return;
    applyField(form, field, mine);
    offers = offers.filter((f) => f !== field);
    if (offers.length === 0) mine = null;
  }

  // A dialog action that saves closes the dialog through closeDialog: finishSaved then waits for the
  // dialog's history step before it releases the back guard (two quick steps merge in WebKit, d4).
  function saveMine(): void {
    void closeDialog();
    void save({ force: true });
  }

  async function restoreAndSave(): Promise<void> {
    if (targetId === null) return;
    dialogBusy = true;
    try {
      await post<RecipeResponse>(`/recipes/${targetId}/restore`);
    } catch (err) {
      dialogBusy = false;
      if (err instanceof ApiError && err.code === 'NOT_FOUND') dialog = { kind: 'gone' };
      else toast.show(errorMessage(err));
      return;
    }
    dialogBusy = false;
    void closeDialog();
    await save();
  }

  function saveAsNew(): void {
    asNew = true;
    createKey = newCreateKey();
    void closeDialog();
    void save();
  }

  interface Choice {
    title: string;
    text: string;
    confirmLabel: string;
    cancelLabel: string;
    alert?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    onclose?: () => void;
  }

  function closeChoice(): void {
    dialog = null;
  }

  /** Texts and actions of the open dialog; one ChoiceDialog renders all of them. */
  const choice = $derived.by((): Choice | null => {
    const d = dialog;
    switch (d?.kind) {
      case 'draft':
        // Escape or Back keep the input: they restore instead of discarding.
        return {
          title: deEditor.draft.title(d.when),
          text: deEditor.draft.text,
          confirmLabel: deEditor.draft.restore,
          cancelLabel: deEditor.draft.discard,
          onconfirm: () => restoreDraft(d.draft),
          oncancel: dropDraft,
          onclose: () => restoreDraft(d.draft),
        };
      case 'discard':
        // The safe choice comes first and gets the initial focus; Enter never discards by accident.
        return {
          title: deEditor.discard.title,
          text: deEditor.discard.text,
          confirmLabel: deEditor.discard.keep,
          cancelLabel: deEditor.discard.confirm,
          alert: true,
          onconfirm: closeChoice,
          oncancel: () => void leave(d.then, true),
          onclose: closeChoice,
        };
      case 'conflict': {
        const name = d.current.updatedBy?.name ?? null;
        return {
          title: deEditor.conflict.title(name),
          text: deEditor.conflict.text(name),
          confirmLabel: deEditor.conflict.reload,
          cancelLabel: deEditor.conflict.force,
          onconfirm: () => reloadFromServer(d.current),
          oncancel: saveMine,
          onclose: closeChoice,
        };
      }
      case 'trash':
        return {
          title: deEditor.trash.title(d.by),
          text: deEditor.trash.text,
          confirmLabel: deEditor.trash.confirm,
          cancelLabel: deEditor.trash.cancel,
          onconfirm: () => void restoreAndSave(),
          oncancel: closeChoice,
        };
      case 'gone':
        return {
          title: deEditor.gone.title,
          text: deEditor.gone.text,
          confirmLabel: deEditor.gone.saveAsNew,
          cancelLabel: deEditor.gone.cancel,
          onconfirm: saveAsNew,
          oncancel: closeChoice,
        };
      default:
        return null;
    }
  });

  // ---------------------------------------------------------------- leaving (F-09, F-35)

  function isOverlayEntry(state: unknown): boolean {
    return typeof state === 'object' && state !== null && (state as { overlay?: unknown }).overlay === true;
  }

  /** Resolves after the next history step (a closed dialog removing its entry), at most after 600 ms. */
  function nextPopstate(): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        window.removeEventListener('popstate', done);
        resolve();
      };
      const timer = setTimeout(done, 600);
      window.addEventListener('popstate', done);
    });
  }

  /**
   * Closes the dialog; resolves once its history entry is gone. Without an open dialog: resolves with the
   * last close, so the guard's release never overlaps a dialog's step still under way.
   */
  function closeDialog(): Promise<void> {
    if (dialog) {
      const pending = isOverlayEntry(history.state);
      dialog = null;
      dialogClosed = tick().then(() => (pending ? nextPopstate() : undefined));
    }
    return dialogClosed;
  }

  async function releaseGuard(): Promise<void> {
    const release = guardRelease;
    if (!release) return;
    guardRelease = null;
    const pending = isOverlayEntry(history.state);
    release();
    if (pending) await nextPopstate();
  }

  async function leave(target: LeaveTarget, discard: boolean): Promise<void> {
    leaving = true;
    if (discard) removeDraft(storage, storageKey);
    dismissToasts();
    await closeDialog();
    await releaseGuard();
    if (target.kind === 'link') {
      router.navigate(target.href);
      return;
    }
    const path = router.route.path;
    const popped = nextPopstate();
    router.back(fallback);
    await popped;
    await tick();
    if (destroyed || router.route.path !== path) return;
    // Back landed on another entry of this editor (a duplicate): stay usable instead of keeping the
    // draft autosave and the back guard switched off. "Verwerfen" has discarded the input.
    if (discard) {
      form = cloneForm(baseline);
      offers = [];
      mine = null;
      errors = {};
      liveValidation = false;
    }
    drafts.adopt();
    leaving = false;
    draftActive = true;
  }

  /** Abbrechen and the back button: ask only when something would be lost. */
  function requestLeave(): void {
    if (mustAsk) dialog = { kind: 'discard', then: { kind: 'back' } };
    else void leave({ kind: 'back' }, false);
  }

  /**
   * The guard entry was closed: by the Android back button or the iOS back gesture (the route stays),
   * or by a navigation elsewhere (the route changes; the draft keeps the input then).
   */
  function onGuardClosed(): void {
    guardRelease?.();
    guardRelease = null;
    const path = router.route.path;
    queueMicrotask(() => {
      if (leaving || router.route.path !== path) return;
      if (mustAsk) dialog = { kind: 'discard', then: { kind: 'back' } };
      else void leave({ kind: 'back' }, false);
    });
  }

  // While there are unsaved changes or a photo upload, a history entry catches the back gesture (F-09 AK).
  $effect(() => {
    const needed = mustAsk && dialog?.kind !== 'discard';
    untrack(() => {
      if (needed && !guardRelease && !leaving) guardRelease = router.pushOverlay(onGuardClosed);
    });
  });

  /** Links elsewhere (navigation rail, profile sheet) ask first, too. */
  function interceptLinks(event: MouseEvent): void {
    if (!mustAsk || leaving || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (!anchor?.hasAttribute('href') || (anchor.target !== '' && anchor.target !== '_self')) return;
    if (anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      return;
    }
    const href = url.pathname + url.search;
    if (href === location.pathname + location.search) return;
    event.preventDefault();
    dialog = { kind: 'discard', then: { kind: 'link', href } };
  }

  /** Enter moves to the next field (no accidental submit); Ctrl/Cmd+Enter saves (NF-11). */
  function onFormKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      void save();
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || event.shiftKey || event.altKey || !formEl) return;
    event.preventDefault();
    const fields = [...formEl.querySelectorAll<HTMLElement>('input:not([type="file"]), textarea')].filter(
      (el) => !el.closest('dialog'),
    );
    const next = fields[fields.indexOf(target) + 1];
    if (next) next.focus();
    else target.blur();
  }

  onMount(() => {
    pruneDrafts(storage, new Date());
    if (recipeId === null) offerDraft();
    else void load();
    const timer = setInterval(autosave, AUTOSAVE_MS);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') autosave();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', autosave);
    document.addEventListener('click', interceptLinks, true);
    const pointerEvents = ['pointerdown', 'pointerup', 'pointercancel'];
    for (const type of pointerEvents) window.addEventListener(type, onPointer, true);
    return () => {
      destroyed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', autosave);
      document.removeEventListener('click', interceptLinks, true);
      for (const type of pointerEvents) window.removeEventListener(type, onPointer, true);
      // Left without a decision (navigation elsewhere): the draft keeps the input (F-09).
      autosave();
      guardRelease?.();
      guardRelease = null;
      dismissToasts();
    };
  });
</script>

{#snippet offer(field: FieldName)}
  {#if mine && offers.includes(field)}
    <ConflictMark preview={fieldPreview(mine, field)} ontakeover={() => takeOver(field)} />
  {/if}
{/snippet}

{#snippet photoField()}
  <div class="field">
    <ImagePicker
      bind:this={picker}
      bind:image={form.image}
      bind:notice={imageNotice}
      bind:unsaved={photoUnsaved}
      compact={!phone}
      onundo={notifyUndo}
      {announce}
    />
    {@render offer('image')}
  </div>
{/snippet}

{#snippet titleField()}
  <div class="field">
    <FieldLabel for="{uid}-title" text={deEditor.title.label} hint={deEditor.required} />
    <input
      bind:this={titleEl}
      bind:value={form.title}
      id="{uid}-title"
      class={['input', 'lg', { invalid: titleError }]}
      type="text"
      autocomplete="off"
      enterkeyhint="next"
      placeholder={deEditor.title.placeholder}
      aria-required="true"
      aria-invalid={titleError ? 'true' : undefined}
      aria-describedby={titleError ? `${uid}-title-error` : undefined}
      onblur={onTitleBlur}
    />
    <FieldError id="{uid}-title-error" message={titleError} />
    {@render offer('title')}
  </div>
{/snippet}

{#snippet tagsField()}
  <div class="field">
    <FieldLabel for="{uid}-tags" text={deEditor.tags.label} />
    <TagInput
      bind:this={tagInput}
      bind:tags={form.tags}
      inputId="{uid}-tags"
      error={errors.tags}
      onundo={notifyUndo}
      {announce}
    />
    {@render offer('tags')}
  </div>
{/snippet}

{#snippet ingredientsSection()}
  <section class="section" aria-labelledby="{uid}-ingredients">
    <h2 id="{uid}-ingredients" class="title-section">{deEditor.ingredients.heading}</h2>
    {@render offer('ingredients')}
    <IngredientEditor bind:items={form.items} {errors} onundo={notifyUndo} {announce} />
  </section>
{/snippet}

{#snippet stepsSection()}
  <section class="section" aria-labelledby="{uid}-steps">
    <h2 id="{uid}-steps" class="title-section">{deEditor.steps.heading}</h2>
    {@render offer('steps')}
    <StepEditor bind:steps={form.steps} {errors} onundo={notifyUndo} />
  </section>
{/snippet}

{#snippet moreSection()}
  <MoreFields
    bind:form
    bind:open={moreOpen}
    {errors}
    collapsible={!columns}
    {offers}
    {mine}
    ontakeover={takeOver}
  />
{/snippet}

<div class={['editor', { tablet: !phone, columns }]}>
  <header class="head">
    <IconButton icon="back" label={deEditor.back} onclick={requestLeave} />
    <h1 class="heading">{heading}</h1>
    {#if !phone && loaded}<span class="sub">{loaded.title}</span>{/if}
  </header>

  {#if phase === 'loading'}
    <div class="loading" aria-busy="true">
      <span class="visually-hidden">{deEditor.load.busy}</span>
      <span class="bone label"></span>
      <span class="bone field"></span>
      <span class="bone label"></span>
      <span class="bone field"></span>
      <span class="bone block"></span>
    </div>
  {:else if phase === 'notFound'}
    <div class="state">
      <EmptyState
        title={deEditor.load.notFound}
        text={deEditor.load.notFoundText}
        actionLabel={deEditor.load.toList}
        actionIcon="book"
        actionHref={paths.recipes()}
      />
    </div>
  {:else if phase === 'inTrash'}
    <div class="state">
      <EmptyState
        title={deEditor.load.inTrash(
          trashInfo?.deletedBy?.name ?? null,
          trashInfo ? deletedWhen(trashInfo.deletedAt) : '',
        )}
        actionLabel={deEditor.load.restore}
        actionIcon="restore"
        onaction={restoreFromTrash}
      />
    </div>
  {:else if phase === 'error'}
    <div class="state">
      <EmptyState
        title={deEditor.load.failed}
        text={loadError}
        illustration={false}
        actionLabel={deEditor.load.retry}
        actionIcon="refresh"
        onaction={load}
      />
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (delegated Enter handling of the fields inside) -->
    <form
      bind:this={formEl}
      class="form"
      novalidate
      aria-labelledby="{uid}-form-label"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onkeydown={onFormKeydown}
    >
      <span id="{uid}-form-label" class="visually-hidden">{heading}</span>
      <!-- One DOM for both layouts: below 1024 px the columns dissolve (display: contents), so rotating a
           tablet keeps the fields, their focus and a running photo upload; only "Weitere Angaben" moves. -->
      <div class="col left">
        {@render photoField()}
        {@render titleField()}
        {@render tagsField()}
        {#if columns}{@render moreSection()}{/if}
      </div>
      <div class="col right">
        {@render ingredientsSection()}
        {@render stepsSection()}
        {#if !columns}{@render moreSection()}{/if}
      </div>
    </form>
    <SaveBar {saving} {canSave} compact={!phone} onsave={() => save()} oncancel={requestLeave} />
  {/if}

  <p class="visually-hidden" aria-live="polite">{announcement}</p>
</div>

{#if choice}
  <ChoiceDialog {...choice} busy={dialogBusy} />
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }

  /* Phone header of the artboard: 64 px, back button and a 24 px heading. */
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: calc(64px + var(--safe-top));
    flex-shrink: 0;
    padding: var(--safe-top) calc(12px + var(--safe-right)) 0 calc(8px + var(--safe-left));
  }

  .heading {
    min-width: 0;
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.3px;
    overflow-wrap: anywhere;
  }

  .sub {
    min-width: 0;
    overflow: hidden;
    font-size: 1rem;
    color: var(--color-text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Phone form: one column, 28 px between blocks, 20 px page margin. */
  .form {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 8px calc(20px + var(--safe-right)) 24px calc(20px + var(--safe-left));
  }

  .field,
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Tablet artboard: header with bottom border. Tablet portrait keeps the one-column form, centered. */
  .editor.tablet .head {
    gap: 8px;
    padding: var(--safe-top) 24px 0 12px;
    border-bottom: 1px solid var(--color-border);
  }

  .editor.tablet .form {
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
    padding: 20px 24px 24px;
  }

  /* From 1024 px: left column (title, tags, more) and right column (ingredients, steps). */
  .editor.columns .form {
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr);
    align-items: start;
    gap: 24px;
    max-width: 1200px;
    margin-inline: 0;
  }

  .col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .col.left {
    gap: 20px;
  }

  .col.right {
    gap: 24px;
  }

  .editor:not(.columns) .col {
    display: contents;
  }

  .state {
    padding: 24px 20px;
  }

  .loading {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 20px;
  }

  .bone {
    display: block;
    border-radius: var(--radius-input);
    background: var(--color-subtle);
  }

  .bone.label {
    width: 30%;
    height: 18px;
    margin-top: 12px;
  }

  .bone.field {
    height: 52px;
  }

  .bone.block {
    height: 200px;
    margin-top: 16px;
    border-radius: var(--radius-tile);
  }

  /* Text fields of the component sheet ("Eingabefelder"): 1.5 px border, 12 px radius, 16 px text
     (no zoom on iOS, NF-15); focus = 2 px text-colored border plus focus ring; error = 2 px border in
     --color-primary-text plus icon and message (not color alone). Shared by the editor's parts. */
  .editor :global(.input) {
    width: 100%;
    min-width: 0;
    height: 44px;
    padding: 0 12px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-input);
    background: var(--color-input-bg);
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.4;
    appearance: none;
  }

  .editor :global(.input.lg) {
    height: 52px;
    font-size: var(--text-body);
  }

  .editor :global(.input:focus-visible) {
    padding: 0 11.5px;
    border: 2px solid var(--color-text);
  }

  .editor :global(.input.invalid) {
    padding: 0 11.5px;
    border: 2px solid var(--color-primary-text);
  }

  .editor :global(textarea.input) {
    display: block;
    height: auto;
    min-height: 128px;
    padding: 10px 12px;
    font-size: var(--text-body);
    line-height: 1.5;
    resize: none;
  }

  .editor :global(textarea.input:focus-visible),
  .editor :global(textarea.input.invalid) {
    padding: 9.5px 11.5px;
  }
</style>
