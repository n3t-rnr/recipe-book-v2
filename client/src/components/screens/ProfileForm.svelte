<script lang="ts">
  // Name and avatar color of a profile (F-01, F-04): one text field (1–40 characters) and the 6 avatar
  // colors as a radio group whose swatches preview the initial. Enter submits; the button stays disabled
  // while the name is blank. Used by the profile choice (create) and "Mehr" (rename, change color).
  import { onMount, untrack } from 'svelte';
  import { LIMITS } from '../../../../shared/constants.ts';
  import type { AvatarToken } from '../../../../shared/schemas.ts';
  import { de } from '../../i18n/de.ts';
  import { dl } from '../../i18n/de-screens-lazy.ts';
  import { profile } from '../../state/profile.svelte.ts';
  import Avatar from '../Avatar.svelte';
  import Button from '../Button.svelte';
  import Icon from '../Icon.svelte';

  interface Props {
    name?: string;
    /** Current color; a new profile gets the first color nobody uses yet (like the server, F-01). */
    avatar?: AvatarToken | undefined;
    submitLabel: string;
    /** Request running: blocks a second submit (NF-09). */
    busy?: boolean;
    /** German error below the field, e.g. "Name bereits vergeben" (F-01). */
    error?: string | null;
    autofocus?: boolean;
    onsubmit: (name: string, avatar: AvatarToken) => void;
    oncancel?: (() => void) | undefined;
  }

  let {
    name: initialName = '',
    avatar: initialAvatar,
    submitLabel,
    busy = false,
    error = null,
    autofocus = false,
    onsubmit,
    oncancel,
  }: Props = $props();

  // Avatar tokens in token order; kept here so the entry chunk does not import zod (shared/schemas.ts).
  const TOKENS: readonly AvatarToken[] = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'];

  const id = $props.id();

  function suggestAvatar(): AvatarToken {
    const list = profile.list;
    return TOKENS.find((t) => !list.some((p) => p.avatar === t)) ?? TOKENS[list.length % TOKENS.length] ?? 'avatar-1';
  }

  // The form owns its fields from here on; the props only seed them.
  let value = $state(untrack(() => initialName));
  let avatar = $state<AvatarToken>(untrack(() => initialAvatar ?? suggestAvatar()));
  let input: HTMLInputElement | undefined = $state();

  const blank = $derived(value.trim() === '');
  const letter = $derived((Array.from(value.trim())[0] ?? '').toLocaleUpperCase('de'));

  onMount(() => {
    if (autofocus) input?.focus();
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (blank || busy) return;
    onsubmit(value.trim(), avatar);
  }
</script>

<form class="form" onsubmit={submit} novalidate>
  <div class="field">
    <label class="label" for="{id}-name">{dl.profilePick.name}</label>
    <input
      bind:this={input}
      bind:value
      id="{id}-name"
      class={['input', { invalid: error }]}
      type="text"
      maxlength={LIMITS.profileName}
      autocomplete="off"
      autocapitalize="words"
      enterkeyhint="done"
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    />
    <!-- The error comes from the server after submitting, so it is announced at once (role="alert"). -->
    {#if error}
      <p id="{id}-error" class="error" role="alert"><Icon name="alert" size={18} />{error}</p>
    {/if}
  </div>

  <fieldset class="field colors">
    <legend class="label">{dl.profilePick.color}</legend>
    <div class="swatches">
      {#each TOKENS as token, i (token)}
        <label class={['swatch', { on: avatar === token }]}>
          <input class="visually-hidden" type="radio" name="{id}-avatar" value={token} bind:group={avatar} />
          <Avatar initials={letter} avatar={token} size={48} />
          {#if avatar === token}
            <span class="badge"><Icon name="check" size={14} strokeWidth={3} /></span>
          {/if}
          <span class="visually-hidden">{dl.profilePick.colorLabel(i + 1)}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="actions">
    {#if oncancel}
      <Button variant="outline" size={52} grow onclick={oncancel}>{de.common.cancel}</Button>
    {/if}
    <Button type="submit" size={52} grow disabled={blank} {busy}>{submitLabel}</Button>
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .label {
    padding: 0;
    font-size: var(--text-label);
    font-weight: 700;
  }

  /* Input of the component sheet: 52 px, 17 px text, 1.5 px strong border; focus 2 px plus ring. */
  .input {
    height: 52px;
    width: 100%;
    padding: 0 12px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-input);
    background: var(--color-input-bg);
    color: var(--color-text);
    font-size: 1.0625rem;
  }

  .input:focus-visible {
    border: 2px solid var(--color-text);
  }

  .input.invalid {
    border: 2px solid var(--color-danger-text);
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--color-danger-text);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .swatch {
    position: relative;
    display: flex;
    padding: 3px;
    border: 2px solid transparent;
    border-radius: 29px;
    cursor: pointer;
  }

  /* Selected: ring and check badge, not color alone (NF-13). */
  .swatch.on {
    border-color: var(--color-text);
  }

  .swatch:has(:focus-visible) {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-bg);
    border-radius: 11px;
    background: var(--color-text);
    color: var(--color-bg);
  }

  .actions {
    display: flex;
    gap: 8px;
  }
</style>
