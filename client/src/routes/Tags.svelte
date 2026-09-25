<script lang="ts">
  // Tags /tags (Kap. 6.3 „Tags“, F-19, F-20): search field, list with counts (server order: count
  // descending, unused tags last, Kap. 6.6), per row a menu with „Umbenennen“ (inline), „Zusammenführen
  // mit …“ and „Löschen“, „Neuer Tag“ at the top. A main navigation destination like Rezepte and Mehr, so
  // the approved M2 header without a back button (F-34 AK, decision of 25.09.2026). No artboard: built
  // from component-sheet parts only (NF-16, screenshot set of M7).
  // Only merging and deleting are confirmed (F-35); renaming acts at once. Every write bumps the data
  // revision, so the shared tag list (state/tags) reloads itself for the list, the filter sheet and the
  // editor too; the write's form or dialog stays busy until that reload arrived (slow WLAN, NF-09). A failed
  // „Aktualisieren“ keeps the list and says so in a toast (NF-09). After each step the focus goes to a
  // row's ⋮ button or the search field, never to <body> (NF-11).
  import { onMount, tick } from 'svelte';
  import type { TagCount, TagMergeResponse, TagRef, TagResponse } from '../../../shared/types.ts';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SearchField from '../components/SearchField.svelte';
  import ScreenHeader from '../components/screens/ScreenHeader.svelte';
  import TagMenu, { type TagAction } from '../components/screens/TagMenu.svelte';
  import TagMergeSheet from '../components/screens/TagMergeSheet.svelte';
  import TagNameForm from '../components/screens/TagNameForm.svelte';
  import TagRow from '../components/screens/TagRow.svelte';
  import { de } from '../i18n/de.ts';
  import { dt } from '../i18n/de-screens-tags.ts';
  import { ApiError, del, errorMessage, patch, post } from '../lib/api.ts';
  import { matchTags } from '../lib/tag-match.ts';
  import { fieldMessage, neighbourId, readTagExists } from '../lib/tag-page.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { tags } from '../state/tags.svelte.ts';
  import { toast } from '../state/toast.svelte.ts';

  interface MergePlan {
    from: TagCount;
    into: TagRef;
    /** Recipes that change: the source's count, or affectedRecipes of a 409 TAG_EXISTS. */
    affected: number;
  }

  /** Skeleton bars while the first list loads (widths in %). */
  const BARS = [60, 45, 70, 50, 65, 40] as const;

  let query = $state('');
  let searchInput: HTMLInputElement | undefined = $state();
  let newButton: HTMLElement | null | undefined = $state();

  /** Start value of the „Neuer Tag“ form; null while it is closed. */
  let creating = $state<string | null>(null);
  /** Remounts the form when it is opened again with another start value. */
  let createSeq = $state(0);
  let createError = $state<string | null>(null);
  let createOpener: HTMLElement | null = null;

  let renamingId = $state<number | null>(null);
  let renameError = $state<string | null>(null);

  let menuFor = $state.raw<TagCount | null>(null);
  let mergeFrom = $state.raw<TagCount | null>(null);
  let mergePlan = $state.raw<MergePlan | null>(null);
  let deleting = $state.raw<TagCount | null>(null);
  /** A write request runs: its button shows it and a second submit does nothing (NF-09). */
  let busy = $state(false);
  /** An (empty) list was known on this visit, so a reload does not flash the skeleton. */
  let known = $state(false);
  /** This page's last toast; the next one replaces it instead of queueing 8 s behind it. */
  let lastToast: number | null = null;

  const shown = $derived(query.trim() === '' ? tags.list : matchTags(tags.list, query));
  const phase = $derived.by((): 'list' | 'empty' | 'error' | 'loading' => {
    if (tags.list.length > 0) return 'list';
    if (tags.status === 'ready' || known) return 'empty';
    return tags.status === 'error' ? 'error' : 'loading';
  });

  /** False once the page is gone, so a load that fails later does not report on another screen. */
  let alive = true;

  onMount(() => {
    known = tags.status === 'ready';
    void reload();
    const off = connection.onReconnect(() => void reload());
    return () => {
      off();
      alive = false;
    };
  });

  // Another device or screen changed data: reload the counts (the store only loads when it is stale).
  $effect(() => {
    void connection.dataRevision;
    void tags.ensure();
  });

  $effect(() => {
    if (tags.status === 'ready') known = true;
  });

  function notify(message: string): void {
    if (lastToast !== null) toast.dismiss(lastToast);
    lastToast = toast.show(message);
  }

  /** A failed request: its message, after a timeout or network error with „Erneut versuchen“ (NF-09). */
  function failed(err: unknown, retry: () => Promise<void>): void {
    if (lastToast !== null) toast.dismiss(lastToast);
    lastToast = toast.error(err, retry);
  }

  /**
   * Loads the list (visit, „Aktualisieren“, reconnect, „Erneut versuchen“). A failed load keeps the list
   * (or „Noch keine Tags“) on screen; like the recipe list it then says so in a toast, with „Erneut
   * versuchen“ after a timeout (NF-09). Offline is explained by the banner, and the error state (nothing
   * known yet) shows the message with its own button.
   */
  async function reload(): Promise<void> {
    await tags.load();
    // A newer load may run by now (status 'loading'); it reports for itself.
    if (!alive || tags.status !== 'error' || phase === 'error') return;
    if (tags.error instanceof ApiError && tags.error.code === 'NETWORK') return;
    failed(tags.error, reload);
  }

  /**
   * The list after a write (`force`: also when the revision did not change, e.g. after 404). Every write
   * waits for it before its form or dialog closes, so on slow WLAN the page never shows the old state
   * next to the new toast, and the focus goes from the form or dialog straight to a row (NF-09, NF-11).
   */
  function fresh(force = false): Promise<void> {
    return force ? tags.load() : tags.ensure();
  }

  /** Another name form was opened while a request ran: the user types there, so the focus stays. */
  function formOpen(): boolean {
    return renamingId !== null || creating !== null;
  }

  /**
   * Focuses the ⋮ button of row `id` once the DOM shows the fresh list. Without that row the focus stays
   * where it is (e.g. in an open rename form), or goes to the search field when its element went away
   * (NF-11: never <body>). After a failed reload the list stays as it is: focus at once instead of
   * waiting up to 10 s more for another load.
   */
  async function focusRow(id: number | null): Promise<void> {
    if (tags.status !== 'error') await fresh();
    await tick();
    const button = id === null ? null : document.getElementById(`tag-menu-${id}`);
    if (button) button.focus();
    else if (!document.activeElement || document.activeElement === document.body) searchInput?.focus();
  }

  // ------------------------------------------------------------------ row menu

  async function pick(action: TagAction): Promise<void> {
    const tag = menuFor;
    if (!tag) return;
    // Close the sheet first; its history entry goes, then the next step opens (router queues it).
    menuFor = null;
    await tick();
    if (action === 'rename') {
      creating = null;
      renameError = null;
      renamingId = tag.id;
    } else if (action === 'merge') {
      mergeFrom = tag;
    } else {
      deleting = tag;
    }
  }

  // ------------------------------------------------------------------ rename

  async function rename(tag: TagCount, name: string): Promise<void> {
    if (busy) return;
    if (name === tag.name) {
      cancelRename(tag);
      return;
    }
    busy = true;
    renameError = null;
    try {
      const res = await patch<TagResponse>(`/tags/${tag.id}`, { name });
      // The form stays (busy) until the list has the new name.
      await fresh();
      notify(dt.renamed(tag.name, res.tag.name));
      if (renamingId === tag.id) renamingId = null;
      if (!formOpen()) await focusRow(res.tag.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TAG_EXISTS') {
        // F-19 AK: renaming to an existing tag asks to merge; „Abbrechen“ returns to the form.
        const target = readTagExists(err.details);
        if (target) {
          mergePlan = {
            from: tag,
            into: { id: target.targetId, name: target.targetName },
            affected: target.affectedRecipes,
          };
        } else {
          renameError = err.message;
        }
      } else if (err instanceof ApiError && err.code === 'VALIDATION') {
        renameError = fieldMessage(err.details, err.message);
      } else if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        await fresh(true);
        if (renamingId === tag.id) renamingId = null;
        notify(dt.gone);
        await focusRow(null);
      } else {
        failed(err, () => rename(tag, name));
      }
    } finally {
      busy = false;
    }
  }

  function cancelRename(tag: TagCount): void {
    renamingId = null;
    renameError = null;
    void tick().then(() => document.getElementById(`tag-menu-${tag.id}`)?.focus());
  }

  // ------------------------------------------------------------------ merge

  async function pickTarget(into: TagCount): Promise<void> {
    const from = mergeFrom;
    if (!from) return;
    mergeFrom = null;
    await tick();
    mergePlan = { from, into, affected: from.count };
  }

  async function merge(plan: MergePlan): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const res = await post<TagMergeResponse>(`/tags/${plan.from.id}/merge`, { intoTagId: plan.into.id });
      // The dialog stays (busy) until the source row is gone from the list.
      await fresh();
      mergePlan = null;
      if (renamingId === plan.from.id) renamingId = null;
      renameError = null;
      notify(dt.merged(plan.from.name, res.tag.name));
      await focusRow(res.tag.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        // Source or target is gone (another device): the server says which one.
        await fresh(true);
        mergePlan = null;
        notify(errorMessage(err));
        await focusRow(plan.from.id);
      } else {
        mergePlan = null;
        // After a timeout „Erneut versuchen“ repeats the confirmed merge (NF-09).
        failed(err, () => merge(plan));
      }
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------------ delete

  async function remove(tag: TagCount): Promise<void> {
    if (busy) return;
    busy = true;
    const next = neighbourId(shown, tag.id);
    try {
      await del(`/tags/${tag.id}`);
      // The dialog stays (busy) until the row is gone from the list.
      await fresh();
      deleting = null;
      notify(dt.deleted(tag.name));
      await focusRow(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        await fresh(true);
        deleting = null;
        notify(dt.gone);
        await focusRow(next);
      } else {
        deleting = null;
        failed(err, () => remove(tag));
      }
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------------ new tag

  function openCreate(start: string): void {
    createOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    renamingId = null;
    createError = null;
    creating = start;
    createSeq += 1;
  }

  async function create(name: string): Promise<void> {
    if (busy) return;
    busy = true;
    createError = null;
    // POST answers 201 for a new tag and 200 for an existing key; the client only sees the tag.
    const before = new Set(tags.list.map((t) => t.id));
    const form = createSeq;
    try {
      const res = await post<TagResponse>('/tags', { name });
      // The form stays (busy) until the list has the new row.
      await fresh();
      notify(before.has(res.tag.id) ? dt.exists(res.tag.name) : dt.created(res.tag.name));
      if (createSeq === form) creating = null;
      if (!formOpen()) {
        query = '';
        await focusRow(res.tag.id);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION') {
        createError = fieldMessage(err.details, err.message);
      } else {
        failed(err, () => create(name));
      }
    } finally {
      busy = false;
    }
  }

  function cancelCreate(): void {
    creating = null;
    createError = null;
    const back = createOpener?.isConnected ? createOpener : newButton;
    void tick().then(() => back?.focus());
  }
</script>

<div class="page">
  <ScreenHeader title={de.titles.tags} onrefresh={() => void reload()} busy={tags.status === 'loading'} />

  <div class="tools">
    <div class="search">
      <SearchField bind:value={query} bind:element={searchInput} label={dt.search} />
    </div>
    <Button bind:element={newButton} variant="outline" size={44} icon="plus" onclick={() => openCreate('')}>
      {dt.newTag}
    </Button>
  </div>

  {#if creating !== null}
    <div class="create">
      {#key createSeq}
        <TagNameForm
          value={creating}
          submitLabel={dt.create}
          {busy}
          error={createError}
          onsubmit={create}
          oncancel={cancelCreate}
        />
      {/key}
    </div>
  {/if}

  <div class="body">
    {#if phase === 'loading'}
      <div class="rows" aria-busy="true">
        {#each BARS as width, i (i)}
          <div class="skeleton-row" aria-hidden="true"><span class="bar" style:width="{width}%"></span></div>
        {/each}
        <span class="visually-hidden" role="status">{dt.loading}</span>
      </div>
    {:else if phase === 'error'}
      <div class="state">
        <EmptyState
          title={errorMessage(tags.error)}
          illustration={false}
          actionLabel={de.common.retry}
          actionIcon="refresh"
          onaction={() => void reload()}
        />
      </div>
    {:else if phase === 'empty'}
      {#if creating === null}
        <div class="state">
          <EmptyState
            title={dt.emptyTitle}
            text={dt.emptyText}
            actionLabel={dt.newTag}
            actionIcon="plus"
            onaction={() => openCreate('')}
          />
        </div>
      {/if}
    {:else if shown.length === 0}
      <div class="none">
        <p>{dt.noMatch(query.trim())}</p>
        <Button variant="outline" size={44} icon="plus" onclick={() => openCreate(query.trim())}>
          {dt.createNamed(query.trim())}
        </Button>
      </div>
    {:else}
      <ul class="rows" aria-label={dt.list}>
        {#each shown as tag (tag.id)}
          <TagRow
            {tag}
            renaming={renamingId === tag.id}
            {busy}
            error={renamingId === tag.id ? renameError : null}
            onmenu={(t) => (menuFor = t)}
            onrename={rename}
            oncancel={cancelRename}
          />
        {/each}
      </ul>
    {/if}
  </div>
</div>

{#if menuFor}
  <TagMenu tag={menuFor} canMerge={tags.list.length > 1} onpick={pick} onclose={() => (menuFor = null)} />
{/if}

{#if mergeFrom}
  <TagMergeSheet from={mergeFrom} list={tags.list} onpick={pickTarget} onclose={() => (mergeFrom = null)} />
{/if}

{#if mergePlan}
  {@const plan = mergePlan}
  <!-- Final for the source tag: focus starts on „Abbrechen“ (NF-11). -->
  <div class="confirm">
    <Dialog
      alert
      initialFocus="cancel"
      title={dt.mergeQuestion(plan.from.name, plan.into.name)}
      text={dt.affected(plan.affected)}
      onclose={() => (mergePlan = null)}
    >
      {#snippet actions()}
        <Button size={52} full {busy} onclick={() => merge(plan)}>{dt.mergeConfirm}</Button>
        <Button variant="outline" size={52} full onclick={() => (mergePlan = null)}>{de.common.cancel}</Button>
      {/snippet}
    </Dialog>
  </div>
{/if}

{#if deleting}
  {@const tag = deleting}
  <div class="confirm">
    <Dialog
      alert
      initialFocus="cancel"
      title={dt.deleteTitle(tag.name)}
      text={dt.deleteText(tag.count)}
      onclose={() => (deleting = null)}
    >
      {#snippet actions()}
        <Button size={52} full icon="trash" {busy} onclick={() => remove(tag)}>{dt.delete}</Button>
        <Button variant="outline" size={52} full onclick={() => (deleting = null)}>{de.common.cancel}</Button>
      {/snippet}
    </Dialog>
  </div>
{/if}

<style>
  .page {
    max-width: 760px;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px 20px 0;
  }

  /* 12rem keeps the placeholder „Tags durchsuchen“ whole; below about 400 px „Neuer Tag“ wraps. */
  .search {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .create {
    display: flex;
    padding: 12px 20px 0;
  }

  .body {
    padding: 8px 20px 32px;
  }

  .rows {
    padding: 0;
    list-style: none;
  }

  .skeleton-row {
    display: flex;
    align-items: center;
    min-height: 60px;
    border-bottom: 1px solid var(--color-border);
  }

  .bar {
    height: 44px;
    border-radius: 22px;
    background: var(--color-subtle);
  }

  .state {
    padding-top: 24px;
  }

  .none {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding-top: 16px;
    overflow-wrap: anywhere;
  }

  /* „Tag ‚…‘ anlegen“ repeats the search text, which may be long: the button wraps instead. */
  .none :global(.button) {
    max-width: 100%;
    height: auto;
    min-height: 44px;
    padding-block: 8px;
    white-space: normal;
  }

  .confirm {
    display: contents;
  }

  /* Names of up to 40 characters without a space wrap instead of widening the dialog (NF-08). */
  .confirm :global(h2) {
    overflow-wrap: anywhere;
  }
</style>
