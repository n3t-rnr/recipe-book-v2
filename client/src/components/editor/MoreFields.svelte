<script lang="ts">
  // "Weitere Angaben" (F-06): Portionen and unit, Vorbereitung, Koch-/Backzeit, Quelle, Beschreibung.
  // One-column editor (below 1024 px): collapsed behind the 60 px row of the phone artboard; in the
  // two-column editor from 1024 px (tablet artboard) always open under a label, as a 2-column grid with
  // 14/600 labels.
  import { deEditor } from '../../i18n/de-editor.ts';
  import type { EditorForm, FieldErrors, FieldName } from '../../lib/editor.ts';
  import { fieldPreview } from '../../lib/editor.ts';
  import Icon from '../Icon.svelte';
  import ConflictMark from './ConflictMark.svelte';
  import FieldError from './FieldError.svelte';

  interface Props {
    form: EditorForm;
    errors: FieldErrors;
    collapsible: boolean;
    open: boolean;
    /** Fields with a pending "Meine Änderung übernehmen" (F-07) and the own version. */
    offers: readonly FieldName[];
    mine: EditorForm | null;
    ontakeover: (field: FieldName) => void;
  }

  let { form = $bindable(), errors, collapsible, open = $bindable(), offers, mine, ontakeover }: Props = $props();

  const uid = $props.id();
  const expanded = $derived(!collapsible || open);
</script>

{#snippet offer(field: FieldName)}
  {#if mine && offers.includes(field)}
    <ConflictMark preview={fieldPreview(mine, field)} ontakeover={() => ontakeover(field)} />
  {/if}
{/snippet}

{#snippet cell(field: 'servings' | 'servingsUnit' | 'prepMinutes' | 'cookMinutes', label: string, mode: 'decimal' | 'numeric' | 'text')}
  {@const message = errors[field]}
  <div class="cell">
    <label class="small-label" for="{uid}-{field}">{label}</label>
    <input
      id="{uid}-{field}"
      class={['input', { invalid: message }]}
      type="text"
      inputmode={mode}
      autocomplete="off"
      enterkeyhint="next"
      list={field === 'servingsUnit' ? `${uid}-units` : undefined}
      aria-invalid={message ? 'true' : undefined}
      aria-describedby={message ? `${uid}-${field}-error` : undefined}
      bind:value={form[field]}
    />
    <FieldError id="{uid}-{field}-error" {message} />
    {@render offer(field)}
  </div>
{/snippet}

<section class="more" aria-labelledby="{uid}-heading">
  {#if collapsible}
    <button
      type="button"
      class="toggle"
      aria-expanded={open}
      aria-controls="{uid}-fields"
      onclick={() => (open = !open)}
    >
      <span class="toggle-text">
        <span id="{uid}-heading" class="toggle-title">{deEditor.more.heading}</span>
        <span class="toggle-sub">{deEditor.more.summary}</span>
      </span>
      <Icon name="chevDown" size={22} class={open ? 'flip' : ''} />
    </button>
  {:else}
    <h2 id="{uid}-heading" class="heading">{deEditor.more.heading}</h2>
  {/if}

  {#if expanded}
    <div id="{uid}-fields" class="grid">
      {@render cell('servings', deEditor.more.servings, 'decimal')}
      {@render cell('servingsUnit', deEditor.more.servingsUnit, 'text')}
      {@render cell('prepMinutes', deEditor.more.prep, 'numeric')}
      {@render cell('cookMinutes', deEditor.more.cook, 'numeric')}
      <div class="cell span">
        <label class="small-label" for="{uid}-source">{deEditor.more.source}</label>
        <input
          id="{uid}-source"
          class={['input', { invalid: errors.source }]}
          type="text"
          autocomplete="off"
          enterkeyhint="next"
          placeholder={deEditor.more.sourcePlaceholder}
          aria-invalid={errors.source ? 'true' : undefined}
          aria-describedby={errors.source ? `${uid}-source-error` : undefined}
          bind:value={form.source}
        />
        <FieldError id="{uid}-source-error" message={errors.source} />
        {@render offer('source')}
      </div>
      <div class="cell span">
        <label class="small-label" for="{uid}-description">{deEditor.more.description}</label>
        <textarea
          id="{uid}-description"
          class={['input', 'description', { invalid: errors.description }]}
          aria-invalid={errors.description ? 'true' : undefined}
          aria-describedby={errors.description ? `${uid}-description-error` : undefined}
          bind:value={form.description}
        ></textarea>
        <FieldError id="{uid}-description-error" message={errors.description} />
        {@render offer('description')}
      </div>
    </div>
    <datalist id="{uid}-units">
      {#each deEditor.servingsUnitSuggestions as unit (unit)}
        <option value={unit}></option>
      {/each}
    </datalist>
  {/if}
</section>

<style>
  .more {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .toggle {
    min-height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 16px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-tile);
    background: var(--color-surface);
    text-align: left;
  }

  .toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-title {
    font-size: var(--text-body);
    font-weight: 700;
    line-height: 1.3;
  }

  .toggle-sub {
    font-size: var(--text-meta);
    line-height: 1.4;
    color: var(--color-text-muted);
  }

  .toggle :global(.flip) {
    transform: rotate(180deg);
  }

  .heading {
    font-size: var(--text-label);
    font-weight: 700;
    line-height: var(--leading-body);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .span {
    grid-column: 1 / -1;
  }

  .small-label {
    font-size: var(--text-meta);
    font-weight: 600;
  }

  .description {
    min-height: 128px;
  }
</style>
