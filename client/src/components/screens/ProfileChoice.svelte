<script lang="ts">
  // Profile choice /profil (F-01, F-02, Kap. 6.3; artboard HandyProfil): "Wer kocht?", one tile per
  // profile (132 px, avatar 64) and the tile "Neues Profil", which turns into the inline form. Without
  // profiles the form stands there directly with the name field focused; Enter creates the profile.
  // The choice is remembered per device (profile store) and opens ?next= or the recipe list.
  // Loaded by routes/ProfilePick.svelte as its own chunk; choosing an existing profile needs no form, so
  // the form is one more chunk that loads when "Neues Profil" is tapped or no profile exists (NF-01).
  // An outdated list (e.g. after 401 PROFILE_UNKNOWN, F-02) reloads when the screen opens.
  import { onMount, tick } from 'svelte';
  import type { AvatarToken } from '../../../../shared/schemas.ts';
  import type { Profile } from '../../../../shared/types.ts';
  import { de } from '../../i18n/de.ts';
  import { dl } from '../../i18n/de-screens-lazy.ts';
  import { errorMessage, ping, post } from '../../lib/api.ts';
  import { ChunkRetry, mayReloadForChunk } from '../../lib/chunk-retry.ts';
  import { lazy } from '../../lib/lazy-routes.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { paths, safeNext } from '../../lib/routes.ts';
  import { connection } from '../../state/connection.svelte.ts';
  import { profile } from '../../state/profile.svelte.ts';
  import AppMark from '../AppMark.svelte';
  import Avatar from '../Avatar.svelte';
  import Banner from '../Banner.svelte';
  import EmptyState from '../EmptyState.svelte';
  import Icon from '../Icon.svelte';

  const loadForm = lazy(() => import('./ProfileForm.svelte'));
  // A failed form chunk loads again once the server answers: by a reload (lib/chunk-retry.ts, NF-09).
  const formChunk = new ChunkRetry(() => 'form');

  let formOpen = $state(router.query.get('neu') === '1');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let addTile: HTMLButtonElement | undefined = $state();

  const list = $derived(profile.list);
  const empty = $derived(profile.status === 'ready' && list.length === 0);
  const showForm = $derived(formOpen || empty);

  onMount(() => {
    if (profile.stale) void profile.load();
    return connection.onReconnect(() => {
      if (formChunk.failed && mayReloadForChunk()) location.reload();
    });
  });

  /** Cancel: the tile "Neues Profil" comes back and takes the focus again (NF-11). */
  function closeForm(): void {
    formOpen = false;
    error = null;
    void tick().then(() => addTile?.focus());
  }

  function done(): void {
    router.navigate(safeNext(router.query.get('next')) ?? paths.recipes(), { replace: true });
  }

  function choose(id: number): void {
    profile.select(id);
    done();
  }

  async function create(name: string, avatar: AvatarToken): Promise<void> {
    busy = true;
    error = null;
    try {
      // Profile management needs no active profile (Kap. 7.1).
      const res = await post<{ profile: Profile }>('/profiles', { name, avatar }, { profile: false });
      const created = res.profile;
      profile.upsert(created);
      profile.select(created.id);
      // Initials of the others may change ("Anna" next to "Andreas", F-03).
      void profile.load();
      done();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet form(cancel: boolean)}
  {#await formChunk.track(loadForm())}
    <div class="form-pending" aria-hidden="true"></div>
  {:then mod}
    <mod.default
      submitLabel={dl.profilePick.create}
      {busy}
      {error}
      autofocus
      onsubmit={create}
      oncancel={cancel ? closeForm : undefined}
    />
  {:catch}
    <EmptyState
      title={de.connection.routeFailed}
      illustration={false}
      actionLabel={de.common.retry}
      actionIcon="refresh"
      onaction={async () => {
        if (await ping()) location.reload();
      }}
    />
  {/await}
{/snippet}

<div class="page">
  <div class="head">
    <AppMark />
    <h1 class="title-screen">{de.titles.profile}</h1>
    <p class="lead">{empty ? dl.profilePick.leadEmpty : dl.profilePick.lead}</p>
  </div>

  {#if profile.notice}
    <Banner message={profile.notice} icon="info" />
  {/if}

  {#if profile.status === 'error' && list.length === 0}
    <EmptyState
      title={profile.error?.message ?? de.profile.loadFailed}
      illustration={false}
      actionLabel={de.common.retry}
      actionIcon="refresh"
      onaction={() => profile.load()}
    />
  {:else if empty}
    <div class="card">{@render form(false)}</div>
  {:else}
    <ul class="tiles" aria-busy={list.length === 0}>
      {#if list.length === 0}
        {#each [1, 2] as n (n)}
          <li class="tile skeleton" aria-hidden="true"></li>
        {/each}
      {/if}
      {#each list as p (p.id)}
        <li>
          <button type="button" class="tile" onclick={() => choose(p.id)}>
            <Avatar initials={p.initials} avatar={p.avatar} size={64} />
            <span class="name">{p.name}</span>
          </button>
        </li>
      {/each}
      {#if showForm}
        <li class="card wide">{@render form(true)}</li>
      {:else if list.length > 0}
        <li>
          <button
            bind:this={addTile}
            type="button"
            class="tile add"
            onpointerdown={() => loadForm().catch(() => {})}
            onclick={() => (formOpen = true)}
          >
            <span class="plus"><Icon name="plus" size={28} strokeWidth={2.2} /></span>
            <span class="name">{de.profile.newProfile}</span>
          </button>
        </li>
      {/if}
    </ul>
  {/if}

  <p class="hint">{de.profile.hint}</p>
</div>

<style>
  /* Artboard HandyProfil: 56 px top, 24 px sides, 28 px between blocks. */
  .page {
    display: flex;
    flex-direction: column;
    gap: 28px;
    max-width: 640px;
    margin: 0 auto;
    padding: calc(56px + var(--safe-top)) 24px calc(32px + var(--safe-bottom));
  }

  .head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .title-screen {
    font-size: 2.5rem;
  }

  .lead {
    font-size: 1.0625rem;
    color: var(--color-text-muted);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 0;
    list-style: none;
  }

  @media (min-width: 600px) {
    .tiles {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .tile {
    width: 100%;
    height: 132px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-step);
    font-weight: 700;
  }

  .tile:active {
    background: var(--color-subtle);
  }

  .tile.add {
    border: 2px dashed var(--color-border-strong);
    background: transparent;
  }

  .tile.skeleton {
    border-color: transparent;
    background: var(--color-subtle);
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plus {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-border-strong);
    border-radius: 32px;
  }

  .card {
    padding: 20px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-surface);
  }

  .card.wide {
    grid-column: 1 / -1;
  }

  /* Room of the form while its chunk loads (no layout jump). */
  .form-pending {
    height: 250px;
  }

  .hint {
    font-size: var(--text-label);
    line-height: 1.5;
    color: var(--color-text-muted);
  }
</style>
