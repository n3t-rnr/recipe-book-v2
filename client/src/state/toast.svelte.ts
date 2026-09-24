/**
 * Toast queue (F-35): one toast at a time, 8 s by default, optionally with "Rückgängig" or another
 * action. The host component (components/Toast.svelte) shows `current` and runs the timer.
 */
import { de } from '../i18n/de.ts';

export type ToastAction = () => Promise<void> | void;

export interface ToastOptions {
  /** Shows "Rückgängig"; the callback restores the previous state. */
  undo?: ToastAction;
  /** Any other action, e.g. { label: 'Erneut versuchen', run } after a timeout (Kap. 6.6). */
  action?: { label: string; run: ToastAction };
  durationMs?: number;
}

export interface ToastItem {
  id: number;
  message: string;
  actionLabel: string | null;
  run: ToastAction | null;
  durationMs: number;
}

export const TOAST_DURATION_MS = 8000;

class ToastState {
  items = $state<ToastItem[]>([]);
  /** true while the action of the visible toast runs (button disabled). */
  busy = $state(false);
  #seq = 0;

  get current(): ToastItem | null {
    return this.items[0] ?? null;
  }

  show(message: string, options: ToastOptions = {}): number {
    const id = ++this.#seq;
    const action = options.undo ? { label: de.common.undo, run: options.undo } : options.action;
    this.items.push({
      id,
      message,
      actionLabel: action?.label ?? null,
      run: action?.run ?? null,
      durationMs: options.durationMs ?? TOAST_DURATION_MS,
    });
    return id;
  }

  dismiss(id: number): void {
    const index = this.items.findIndex((t) => t.id === id);
    if (index !== -1) this.items.splice(index, 1);
    if (index === 0) this.busy = false;
  }

  /** Runs the action of a toast and removes it; a failing action shows a short error toast. */
  async act(id: number): Promise<void> {
    const item = this.items.find((t) => t.id === id);
    if (!item?.run || this.busy) return;
    this.busy = true;
    try {
      await item.run();
      this.dismiss(id);
    } catch (err) {
      this.dismiss(id);
      this.show(err instanceof Error && err.name === 'ApiError' ? err.message : de.toast.actionFailed);
    } finally {
      this.busy = false;
    }
  }
}

export const toast = new ToastState();
