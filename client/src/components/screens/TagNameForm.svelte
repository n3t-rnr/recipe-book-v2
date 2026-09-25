<script lang="ts">
  // Name field of the tag page (Kap. 6.3 „Tags“): inline rename in a row and „Neuer Tag“ above the list.
  // No artboard: the 44 px input of the component sheet (generator input()), a primary 44 px button and
  // „Abbrechen“ as a text button. Like the sheet's compact fields (Menge, Zutat, „Tag hinzufügen …“) the
  // placeholder repeats the label, so the empty „Neuer Tag“ field is labelled visibly too (NF-11). Focus
  // and selection on mount; Enter submits, Escape cancels from the field and from both buttons. The client
  // check (checkTagName) runs first; the parent sends the request and passes a server error back.
  import { onMount, untrack } from 'svelte';
  import { LIMITS } from '../../../../shared/constants.ts';
  import { de } from '../../i18n/de.ts';
  import { dt } from '../../i18n/de-screens-tags.ts';
  import { checkTagName } from '../../lib/tag-page.ts';
  import Button from '../Button.svelte';
  import FieldError from '../editor/FieldError.svelte';

  interface Props {
    /** Start value: the current name (rename) or the search text („Tag ‚…‘ anlegen“). */
    value?: string;
    /** „Speichern“ (rename) or „Anlegen“ (new tag). */
    submitLabel: string;
    /** Request running: the button shows it and blocks a second submit (NF-09). */
    busy?: boolean;
    /** Error of the last request (400 VALIDATION), shown below the field. */
    error?: string | null;
    /** Called with the checked name (whitespace collapsed and trimmed). */
    onsubmit: (name: string) => void;
    oncancel: () => void;
  }

  let { value: initial = '', submitLabel, busy = false, error = null, onsubmit, oncancel }: Props = $props();

  const id = $props.id();
  // The form owns its text from here on; the prop only seeds it.
  let value = $state(untrack(() => initial));
  let local = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();

  const message = $derived(local ?? error ?? undefined);

  onMount(() => {
    input?.focus();
    input?.select();
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (busy) return;
    const checked = checkTagName(value);
    if ('error' in checked) {
      local = checked.error;
      input?.focus();
      return;
    }
    local = null;
    onsubmit(checked.name);
  }

  /** Escape anywhere in the form (field, „Speichern“, „Abbrechen“) cancels, like closing a sheet. */
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    oncancel();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (delegated Escape of the field and buttons inside) -->
<form class="form" novalidate onsubmit={submit} {onkeydown}>
  <div class="field">
    <input
      bind:this={input}
      bind:value
      class={['input', { invalid: message }]}
      type="text"
      aria-label={dt.name}
      placeholder={dt.name}
      maxlength={LIMITS.tagName}
      autocomplete="off"
      enterkeyhint="done"
      aria-invalid={message ? 'true' : undefined}
      aria-describedby={message ? `${id}-error` : undefined}
    />
    <!-- Raised by the submit, while the focus stays in the field: announced at once. -->
    <FieldError id="{id}-error" {message} live />
  </div>
  <div class="actions">
    <Button type="submit" size={44} {busy}>{submitLabel}</Button>
    <Button variant="text" onclick={oncancel}>{de.common.cancel}</Button>
  </div>
</form>

<style>
  .form {
    display: flex;
    flex: 1 1 100%;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px 16px;
    min-width: 0;
  }

  .field {
    display: flex;
    flex: 1 1 12rem;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  /* Component sheet input() with h 44 and 16 px text; focus 2 px text-colored border plus ring. */
  .input {
    height: 44px;
    width: 100%;
    padding: 0 12px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-input);
    background: var(--color-input-bg);
    color: var(--color-text);
    font-size: 1rem;
  }

  /* The thicker border must not move the text. */
  .input:focus {
    padding: 0 11.5px;
    border: 2px solid var(--color-text);
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .input.invalid {
    padding: 0 11.5px;
    border: 2px solid var(--color-primary-text);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }
</style>
