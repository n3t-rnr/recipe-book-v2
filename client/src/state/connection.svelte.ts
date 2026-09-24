/**
 * Server reachability (F-33, NF-09) and the response headers X-Data-Revision / X-App-Version (F-36).
 * lib/api.ts reports every outcome here; the banner in App.svelte shows `online === false`.
 */
class ConnectionState {
  /** false after a network failure until the next successful response. */
  online = $state(true);
  /** Last X-Data-Revision seen (F-36, used from M5 on). */
  dataRevision = $state<string | null>(null);
  /** Last X-App-Version seen and the one this client started with (update banner, F-36). */
  appVersion = $state<string | null>(null);
  initialAppVersion = $state<string | null>(null);

  #reconnectListeners = new Set<() => void>();

  markOffline(): void {
    this.online = false;
  }

  /** Called after every successful response; notifies views when the server is back (NF-09). */
  markOnline(): void {
    if (this.online) return;
    this.online = true;
    for (const listener of [...this.#reconnectListeners]) listener();
  }

  /**
   * Registers a reload for the current view after the connection returns (online event or a
   * successful retry). Returns the unsubscribe function; call it on destroy.
   */
  onReconnect(listener: () => void): () => void {
    this.#reconnectListeners.add(listener);
    return () => this.#reconnectListeners.delete(listener);
  }

  noteHeaders(dataRevision: string | null, appVersion: string | null): void {
    if (dataRevision !== null) this.dataRevision = dataRevision;
    if (appVersion !== null) {
      this.appVersion = appVersion;
      this.initialAppVersion ??= appVersion;
    }
  }
}

export const connection = new ConnectionState();
