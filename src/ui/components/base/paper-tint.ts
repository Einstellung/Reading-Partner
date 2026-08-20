// The paper tint: where the choice is kept and how it reaches the page. The
// palette itself is in styles.css under `[data-tint="paper"]`; all this decides
// is whether that attribute is on <html>.
//
// One switch with one step, applied to the whole app rather than to the reader
// alone. A tint that stopped at the page would put a cream sheet inside white
// chrome, which is a harder contrast than the white page it replaced.
//
// localStorage rather than settings.json or device.json, for two reasons. It is
// a per-device view preference like the sidebar's open state (topic-nav.ts), so
// syncing it would carry a daylight desk's choice onto a phone read at night.
// And it is read synchronously: device.json is loaded over an async bridge, so a
// tint that waited for it would paint one white frame at every launch, which is
// the exact flash this switch exists to remove.

// The contract the reader's page tinting is written against: this attribute,
// this value, and absent — not a second value — when the tint is off. Anything
// that wants to style the tinted app selects on `[data-tint="paper"]` and needs
// no `:not()` for the other case.
export const TINT_ATTRIBUTE = "data-tint";
export const PAPER_TINT = "paper";

export const PAPER_TINT_KEY = "paper-tint";

// Only the two methods this needs, so the tests can pass a plain object.
export interface TintStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Off unless the slot holds exactly the on marker. A hand-edited or half-written
// value reads as off rather than on: the app's own palette is the one every
// screenshot and every colour decision was made against, and an unreadable
// storage must not silently move the whole app off it.
export function readPaperTint(store: TintStore | null): boolean {
  try {
    return store?.getItem(PAPER_TINT_KEY) === "1";
  } catch {
    // A storage that throws on read is a storage that is not there.
    return false;
  }
}

export function writePaperTint(store: TintStore | null, on: boolean): void {
  try {
    store?.setItem(PAPER_TINT_KEY, on ? "1" : "0");
  } catch {
    // Full or disabled storage: the choice still holds for this session.
  }
}

// Only what applying the tint calls, so a test needs no DOM.
export interface TintRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function applyPaperTint(root: TintRoot | null, on: boolean): void {
  if (!root) return;
  if (on) root.setAttribute(TINT_ATTRIBUTE, PAPER_TINT);
  else root.removeAttribute(TINT_ATTRIBUTE);
}

// Absent or throwing in a webview that disallows storage, in which case the tint
// is off every launch and the switch still works for the session.
export function browserTintStore(win: Window): TintStore | null {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

// The whole startup path: read the stored choice and put it on <html>. Called
// from main.tsx before React mounts, so the first frame the user sees is already
// the right colour.
export function initPaperTint(win: Window): boolean {
  const on = readPaperTint(browserTintStore(win));
  applyPaperTint(win.document?.documentElement ?? null, on);
  return on;
}
