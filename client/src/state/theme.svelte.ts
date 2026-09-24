/**
 * Color scheme preference (NF-14): system, light or dark, per device in localStorage "theme".
 * The inline script in index.html applies a stored choice before the first paint; this store keeps
 * the data-theme attribute in sync afterwards. The UI switch follows in M5 ("Mehr → Darstellung").
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';

class ThemeState {
  preference = $state<ThemePreference>('system');

  init(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage blocked (private mode): follow the system scheme.
    }
    this.preference = stored === 'light' || stored === 'dark' ? stored : 'system';
    this.#apply();
  }

  set(preference: ThemePreference): void {
    this.preference = preference;
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Not persisted; the choice still applies until the page reloads.
    }
    this.#apply();
  }

  #apply(): void {
    const root = document.documentElement;
    if (this.preference === 'system') delete root.dataset.theme;
    else root.dataset.theme = this.preference;
  }
}

export const theme = new ThemeState();
