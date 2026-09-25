<script lang="ts">
  // Chip input for tags (generator tagEditor(), F-17 core): Moonstone chips with a 44 px × button,
  // text field "Tag hinzufügen …". Enter or comma adds, duplicates by normalize() collapse, at most 20.
  // Removing is immediate with "Rückgängig" (F-35). Autocomplete and frequent tags follow in M4 (F-18).
  import { deEditor } from '../../i18n/de-editor.ts';
  import { addTags } from '../../lib/editor.ts';
  import Icon from '../Icon.svelte';
  import FieldError from './FieldError.svelte';

  interface Props {
    tags: string[];
    /** Text typed but not yet added; the editor commits it before saving. */
    pending: string;
    inputId: string;
    /** Error from validation or the server (field "tags"). */
    error?: string | undefined;
    onundo: (message: string, undo: () => void) => void;
  }

  let { tags = $bindable(), pending = $bindable(), inputId, error, onundo }: Props = $props();

  let message = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();

  const shown = $derived(message ?? error);
  const errorId = $derived(`${inputId}-error`);
  const hintId = $derived(`${inputId}-hint`);

  function add(text: string): string[] {
    const result = addTags(tags, text);
    if (result.tags.length !== tags.length) tags = result.tags;
    message = result.error;
    return result.rejected;
  }

  /** Ctrl/Cmd+Enter falls through to the form, which saves and commits the pending text first (NF-11). */
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (pending.trim() === '') return;
    pending = add(pending).join(', ');
  }

  function oninput(): void {
    if (!pending.includes(',')) {
      message = null;
      return;
    }
    const cut = pending.lastIndexOf(',');
    const rest = pending.slice(cut + 1).trimStart();
    const rejected = add(pending.slice(0, cut));
    pending = [...rejected, rest].filter((part) => part !== '').join(', ');
  }

  function onblur(): void {
    if (pending.trim() !== '') pending = add(pending).join(', ');
  }

  function remove(index: number): void {
    const tag = tags[index];
    if (tag === undefined) return;
    tags = tags.filter((_, i) => i !== index);
    message = null;
    input?.focus();
    onundo(deEditor.tags.removed(tag), () => {
      if (tags.includes(tag)) return;
      tags = [...tags.slice(0, index), tag, ...tags.slice(index)];
    });
  }
</script>

<div class={['box', { invalid: shown !== undefined && shown !== null }]}>
  {#each tags as tag, i (tag)}
    <span class="chip">
      {tag}
      <button type="button" class="remove" aria-label={deEditor.tags.remove(tag)} onclick={() => remove(i)}>
        <Icon name="close" size={18} strokeWidth={2.4} />
      </button>
    </span>
  {/each}
  <input
    bind:this={input}
    bind:value={pending}
    id={inputId}
    class="tag-input"
    type="text"
    placeholder={deEditor.tags.placeholder}
    autocomplete="off"
    enterkeyhint="enter"
    aria-invalid={shown ? 'true' : undefined}
    aria-describedby={shown ? `${hintId} ${errorId}` : hintId}
    {onkeydown}
    {oninput}
    {onblur}
  />
</div>
<p id={hintId} class="visually-hidden">{deEditor.tags.hint}</p>
<!-- Errors of the add action (duplicate, limit) are announced; validation and server errors are not. -->
<FieldError id={errorId} message={shown ?? undefined} live={message !== null} />

<style>
  .box {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-row);
    background: var(--color-input-bg);
  }

  /* The field's focus: 2 px text border plus focus ring (component sheet), on the whole box. */
  .box:focus-within {
    padding: 5.5px;
    border: 2px solid var(--color-text);
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .box.invalid {
    padding: 5.5px;
    border: 2px solid var(--color-primary-text);
  }

  .chip {
    height: 44px;
    display: flex;
    align-items: center;
    padding-left: 16px;
    border-radius: 22px;
    background: var(--color-secondary);
    color: var(--color-ink);
    font-size: var(--text-label);
    font-weight: 600;
    white-space: nowrap;
    max-width: 100%;
  }

  .remove {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--color-ink);
  }

  .remove:focus-visible {
    outline-color: var(--color-ink);
    outline-offset: -4px;
  }

  .tag-input {
    flex-grow: 1;
    min-width: 120px;
    height: 44px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-size: 1rem;
    outline: none;
  }
</style>
