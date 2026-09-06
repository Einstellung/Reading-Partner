// localStorage as the two methods a per-device view preference needs, so a test
// can pass a plain object and a webview that refuses storage is one `null`.
//
// Shared rather than redeclared per preference: the reader's panel (docs/54)
// and the shell sidebar (docs/51) are the same kind of choice — this device's
// layout, read synchronously so the first frame is already the one the reader
// left — and they should not drift apart in how they reach the slot.

export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Absent or throwing in a webview that disallows storage, in which case every
// preference falls back to its default and still holds for the session.
export function browserPrefStore(win: Window): PrefStore | null {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}
