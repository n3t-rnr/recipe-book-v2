<script lang="ts">
  // Zubereitung (F-11, generator editorSteps()): numbered rows with a 36 px number, a textarea (17 px,
  // at least 128 px, grows with the text) and the step menu (Nach oben, Nach unten, Entfernen). Empty
  // steps are dropped on save (lib/editor.ts); removing is immediate with "Rückgängig" (F-35). Moves
  // are announced by the row menu itself (its live region; the page's one is inert behind the sheet).
  import { onMount, tick } from 'svelte';
  import { LIMITS } from '../../../../shared/constants.ts';
  import { deEditor } from '../../i18n/de-editor.ts';
  import { emptyStep, errorKey, type FieldErrors, moveItem, type StepItem } from '../../lib/editor.ts';
  import Button from '../Button.svelte';
  import IconButton from '../IconButton.svelte';
  import FieldError from './FieldError.svelte';
  import RowMenu from './RowMenu.svelte';

  interface Props {
    steps: StepItem[];
    errors: FieldErrors;
    onundo: (message: string, undo: () => void) => void;
  }

  let { steps = $bindable(), errors, onundo }: Props = $props();

  const uid = $props.id();
  const MIN_HEIGHT = 128;
  let menuKey = $state<string | null>(null);
  let addRow: HTMLDivElement | undefined = $state();

  const menuIndex = $derived(menuKey === null ? -1 : steps.findIndex((s) => s.key === menuKey));
  const full = $derived(steps.length >= LIMITS.steps);

  const areas: Record<string, HTMLTextAreaElement | null> = {};
  const fieldSizing = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

  /** Grows a textarea with its text where CSS field-sizing is missing (Firefox, older Safari). */
  function fit(el: HTMLTextAreaElement | null | undefined): void {
    if (fieldSizing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(MIN_HEIGHT, el.scrollHeight + 3)}px`;
  }

  // Rows that appear with text (restored draft, undo, taken-over list) start at their full height.
  $effect(() => {
    for (const step of steps) fit(areas[step.key]);
  });

  onMount(() => {
    const refit = (): void => {
      for (const step of steps) fit(areas[step.key]);
    };
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  });

  async function focusStep(key: string): Promise<void> {
    await tick();
    document.getElementById(`${uid}-step-${key}`)?.focus();
  }

  function add(): void {
    if (full) return;
    const step = emptyStep();
    steps.push(step);
    void focusStep(step.key);
  }

  function move(delta: -1 | 1): void {
    moveItem(steps, menuIndex, menuIndex + delta);
  }

  function remove(): void {
    const index = menuIndex;
    const step = steps[index];
    if (!step) return;
    menuKey = null;
    steps.splice(index, 1);
    onundo(deEditor.steps.removed, () => {
      if (steps.some((s) => s.key === step.key)) return;
      steps.splice(Math.min(index, steps.length), 0, step);
      void focusStep(step.key);
    });
    void tick().then(() => {
      const next = steps[Math.min(index, steps.length - 1)];
      if (next) document.getElementById(`${uid}-step-${next.key}`)?.focus();
      else addRow?.querySelector('button')?.focus();
    });
  }
</script>

<ol class="steps">
  {#each steps as step, i (step.key)}
    {@const message = errors[errorKey.step(step.key)]}
    <li class="step">
      <span class="number" aria-hidden="true">{i + 1}</span>
      <div class="body">
        <textarea
          id="{uid}-step-{step.key}"
          class={['input', 'text', { invalid: message }]}
          aria-label={deEditor.steps.step(i + 1)}
          placeholder={deEditor.steps.placeholder}
          aria-invalid={message ? 'true' : undefined}
          aria-describedby={message ? `${uid}-step-${step.key}-error` : undefined}
          bind:this={areas[step.key]}
          bind:value={step.text}
          oninput={(e) => fit(e.currentTarget)}
        ></textarea>
        <FieldError id="{uid}-step-{step.key}-error" {message} />
      </div>
      <IconButton icon="dotsV" label={deEditor.steps.menu} haspopup="dialog" onclick={() => (menuKey = step.key)} />
    </li>
  {/each}
</ol>
<FieldError message={errors.steps} />
<div class="add" bind:this={addRow}>
  <Button variant="outline" size={44} icon="plus" disabled={full} onclick={add}>
    <span class="visually-hidden">{deEditor.steps.addLabel}</span><span aria-hidden="true">{deEditor.steps.add}</span>
  </Button>
</div>
{#if full}<p class="limit">{deEditor.steps.limit(LIMITS.steps)}</p>{/if}

{#if menuKey !== null && menuIndex !== -1}
  <RowMenu
    title={deEditor.menu.step(menuIndex + 1)}
    meta={deEditor.menu.position(menuIndex + 1, steps.length)}
    canUp={menuIndex > 0}
    canDown={menuIndex < steps.length - 1}
    onup={() => move(-1)}
    ondown={() => move(1)}
    onremove={remove}
    onclose={() => (menuKey = null)}
  />
{/if}

<style>
  .steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-tile);
    background: var(--color-surface);
  }

  .number {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    margin-top: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 18px;
    background: var(--color-text);
    color: var(--color-bg);
    font-weight: 700;
  }

  .body {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .text {
    display: block;
    field-sizing: content;
    min-height: 128px;
    font-size: var(--text-body);
  }

  .add {
    display: flex;
  }

  .limit {
    font-size: var(--text-meta);
    color: var(--color-text-muted);
  }
</style>
