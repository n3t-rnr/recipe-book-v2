<script lang="ts">
  // Segmented control of the generator (segmented(): filter sheet „Alle müssen passen | Einer reicht“, later
  // the editor's text-mode switch): 44 px options in a 1.5 px outlined pill, the checked one inverted with
  // weight 700. A radiogroup with a roving tabindex instead of the artboard's tablist, because a choice
  // takes effect at once and shows no panel (NF-11: arrow keys select). Lazily loaded chunks only (NF-01).
  import { radioKeys } from '../lib/radio-keys.ts';

  interface Props {
    /** Accessible name of the group, e.g. „Tag-Verknüpfung“. */
    label: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    value: string;
    onchange: (value: string) => void;
  }

  let { label, options, value, onchange }: Props = $props();

  const buttons: Array<HTMLButtonElement | undefined> = $state([]);

  function onkeydown(event: KeyboardEvent, index: number): void {
    const next = radioKeys(event.key, index, options.length);
    const option = next === null ? undefined : options[next];
    if (next === null || !option) return;
    event.preventDefault();
    onchange(option.value);
    buttons[next]?.focus();
  }
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option, i (option.value)}
    <button
      bind:this={buttons[i]}
      type="button"
      class={['option', { checked: option.value === value }]}
      role="radio"
      aria-checked={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      onclick={() => onchange(option.value)}
      onkeydown={(event) => onkeydown(event, i)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: flex;
    padding: 3px;
    border: 1.5px solid var(--color-border-strong);
    border-radius: 26px;
  }

  .option {
    height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-label);
    font-weight: 600;
    white-space: nowrap;
  }

  .checked {
    background: var(--color-text);
    color: var(--color-bg);
    font-weight: 700;
  }
</style>
