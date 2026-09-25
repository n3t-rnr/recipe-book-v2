<script lang="ts">
  // "Mehr" /mehr (Kap. 6.3): the active profile (switch, rename, change color, delete; F-03, F-04) and
  // the sub-pages Papierkorb, Anderes Gerät verbinden and Status. Deleting a profile names the ratings
  // and favorites that go with it and asks first (F-35); the last profile cannot be deleted (409
  // LAST_PROFILE, the server's German message). Appearance, data and "Über" follow with M5/M6.
  import { onMount, tick } from 'svelte';
  import type { AvatarToken } from '../../../shared/schemas.ts';
  import type { Profile } from '../../../shared/types.ts';
  import Avatar from '../components/Avatar.svelte';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import ProfileSheet from '../components/ProfileSheet.svelte';
  import ProfileForm from '../components/screens/ProfileForm.svelte';
  import ScreenHeader from '../components/screens/ScreenHeader.svelte';
  import { de } from '../i18n/de.ts';
  import { dl } from '../i18n/de-screens-lazy.ts';
  import { del, errorMessage, patch } from '../lib/api.ts';
  import { paths } from '../lib/routes.ts';
  import { profile } from '../state/profile.svelte.ts';
  import { toast } from '../state/toast.svelte.ts';

  let sheetOpen = $state(false);
  let editing = $state(false);
  let confirming = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let editButton: HTMLElement | null | undefined = $state();

  const current = $derived(profile.current);

  onMount(() => {
    // Fresh counts for the delete question (F-04) and names changed on other devices.
    void profile.load();
  });

  /** Closes the form; "Bearbeiten" comes back and takes the focus again (NF-11). */
  function closeForm(): void {
    editing = false;
    error = null;
    void tick().then(() => editButton?.focus());
  }

  async function save(p: Profile, name: string, avatar: AvatarToken): Promise<void> {
    busy = true;
    error = null;
    try {
      const res = await patch<{ profile: Profile }>(`/profiles/${p.id}`, { name, avatar });
      profile.upsert(res.profile);
      closeForm();
      toast.show(dl.more.saved);
      // Initials of the others may change with the new name (F-03).
      void profile.load();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function remove(p: Profile): Promise<void> {
    busy = true;
    try {
      await del(`/profiles/${p.id}`);
      confirming = false;
      toast.show(dl.more.deleted(p.name));
      // The active profile is gone: the store opens the profile choice (F-02).
      profile.remove(p.id);
    } catch (err) {
      confirming = false;
      // After a timeout "Erneut versuchen" repeats the confirmed delete (NF-09).
      toast.error(err, () => remove(p));
    } finally {
      busy = false;
    }
  }

  const links = [
    { href: paths.trash, title: de.titles.trash, hint: dl.more.trashHint },
    { href: paths.connect, title: de.titles.connect, hint: dl.more.connectHint },
    { href: paths.status, title: de.titles.status, hint: dl.more.statusHint },
  ];
</script>

<div class="page">
  <ScreenHeader title={de.titles.more} />

  <div class="body">
    <section class="section" aria-labelledby="more-profile">
      <h2 id="more-profile" class="title-section">{dl.more.profile}</h2>
      {#if current}
        <div class="card">
          {#if editing}
            <ProfileForm
              name={current.name}
              avatar={current.avatar}
              submitLabel={de.common.save}
              {busy}
              {error}
              autofocus
              onsubmit={(name, avatar) => save(current, name, avatar)}
              oncancel={closeForm}
            />
          {:else}
            <div class="who">
              <Avatar initials={current.initials} avatar={current.avatar} size={64} />
              <div class="who-text">
                <p class="name">{current.name}</p>
                <p class="counts">{dl.more.counts(current.ratingCount, current.favoriteCount)}</p>
              </div>
            </div>
            <div class="actions">
              <Button variant="outline" size={44} icon="users" onclick={() => (sheetOpen = true)}>
                {dl.more.switch}
              </Button>
              <Button
                bind:element={editButton}
                variant="outline"
                size={44}
                icon="pencil"
                onclick={() => (editing = true)}
              >
                {dl.more.edit}
              </Button>
              <Button variant="text" icon="trash" onclick={() => (confirming = true)}>{dl.more.delete}</Button>
            </div>
          {/if}
        </div>
      {:else}
        <div class="card">
          <p class="counts">{dl.more.noProfile}</p>
          <div class="actions">
            <Button variant="outline" size={44} icon="users" href={paths.profile({ next: paths.more })}>
              {dl.more.choose}
            </Button>
          </div>
        </div>
      {/if}
    </section>

    <section class="section" aria-labelledby="more-app">
      <h2 id="more-app" class="title-section">{dl.more.app}</h2>
      <ul class="links">
        {#each links as link (link.href)}
          <li>
            <a class="link" href={link.href}>
              <span class="link-text">
                <span class="link-title">{link.title}</span>
                <span class="link-hint">{link.hint}</span>
              </span>
              <Icon name="chevRight" size={22} />
            </a>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</div>

{#if sheetOpen}
  <ProfileSheet onclose={() => (sheetOpen = false)} />
{/if}

{#if confirming && current}
  {@const p = current}
  <Dialog
    alert
    initialFocus="cancel"
    title={dl.more.deleteTitle(p.name)}
    text={dl.more.deleteText(p.ratingCount, p.favoriteCount)}
    onclose={() => (confirming = false)}
  >
    {#snippet actions()}
      <Button size={52} full icon="trash" {busy} onclick={() => remove(p)}>{dl.more.delete}</Button>
      <Button variant="outline" size={52} full onclick={() => (confirming = false)}>{de.common.cancel}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .page {
    max-width: 760px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 20px 20px 32px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .title-section {
    font-size: 1.375rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-surface);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .who-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-family: var(--font-display);
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: break-word;
  }

  .counts {
    font-size: var(--text-label);
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    list-style: none;
  }

  /* Row like "Weitere Angaben" of the editor artboard: 60 px, 16 px sides, 18 px radius. */
  .link {
    min-height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-tile);
    background: var(--color-surface);
    color: var(--color-text);
    text-decoration: none;
  }

  .link:active {
    background: var(--color-subtle);
  }

  .link-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .link-title {
    font-size: var(--text-body);
    font-weight: 700;
  }

  .link-hint {
    font-size: var(--text-meta);
    color: var(--color-text-muted);
  }
</style>
