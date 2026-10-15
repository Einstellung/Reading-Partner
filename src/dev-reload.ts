// A dev build on a device loads every module (about 1300) through Tauri's dev
// proxy, one request each, and over the dev hotspot one of them now and then
// fails to send (pitfall 609). One failed module fails the whole shell import
// and the page stays black, so a dev build reloads instead, a few times at most.

export const RELOAD_LIMIT = 5;
const KEY = "rp-dev-shell-reloads";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Call when the shell import failed. True when it reloaded; false once the
 *  limit is spent, and the count starts over for the next manual reload. */
export function reloadAfterFailedShell(store: Store, reload: () => void): boolean {
  const n = Number(store.getItem(KEY) || 0);
  if (n >= RELOAD_LIMIT) {
    store.removeItem(KEY);
    return false;
  }
  store.setItem(KEY, String(n + 1));
  reload();
  return true;
}

/** Call once the shell is in: the next failure gets the full count again. */
export function shellLoaded(store: Store): void {
  store.removeItem(KEY);
}
