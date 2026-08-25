// The topic sidebar minus React: which sections it has, whether it starts
// expanded or collapsed on this device, and where that choice is remembered
// (docs/31, "界面"). None of it touches the DOM, so the rendering can change
// without re-deriving any of it (CLAUDE.md).

export type TopicSection = "materials" | "retell" | "observations";

export const TOPIC_SECTIONS: readonly { id: TopicSection; label: string }[] = [
  { id: "materials", label: "Materials" },
  { id: "retell", label: "Retell" },
  { id: "observations", label: "AI observations" },
];

export const DEFAULT_SECTION: TopicSection = "materials";

// What the sidebar is decided from: viewport width and pointer type, never the
// operating system (CLAUDE.md). Same two measurements the shell choice uses
// (platform/app/shell.ts), for the same reason — an OS check would collapse the
// sidebar on a landscape iPad and leave it open on a phone-sized window.
export interface TopicNavEnv {
  // Viewport width in CSS pixels.
  width: number;
  // Whether the primary pointer is a finger.
  coarsePointer: boolean;
}

// Tailwind's `lg`. Below it a labelled column costs the shelf a card's worth of
// width, which is why a portrait iPad (834) starts collapsed while a landscape
// one (1194) does not.
export const NAV_EXPAND_MIN_WIDTH = 1024;

// A fine pointer means a desktop window, which starts expanded at any width: it
// has hover, a cursor, and the user resized it themselves.
export function defaultNavOpen(env: TopicNavEnv): boolean {
  return !env.coarsePointer || env.width >= NAV_EXPAND_MIN_WIDTH;
}

// Only the two methods this needs, so the tests can pass a plain object.
export interface NavStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const NAV_OPEN_KEY = "topic-nav-open";

// The stored choice, or the device's default when there is none. Anything else
// in the slot (a hand-edited value, a half-written one) reads as absent rather
// than as false: a bad string must not permanently hide the sidebar.
export function readNavOpen(store: NavStore | null, env: TopicNavEnv): boolean {
  try {
    const raw = store?.getItem(NAV_OPEN_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // A storage that throws on read is a storage that is not there.
  }
  return defaultNavOpen(env);
}

export function writeNavOpen(store: NavStore | null, open: boolean): void {
  try {
    store?.setItem(NAV_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Full or disabled storage: the choice still holds for this session.
  }
}

// localStorage rather than settings.json: this is a per-device view preference,
// and settings sync (platform/sync) would carry the desktop's expanded sidebar
// onto the iPad, which is the one place it should be collapsed. Absent or
// throwing in a webview that disallows it, in which case the default applies
// every launch.
export function browserNavStore(win: Window): NavStore | null {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readNavEnv(win: Window): TopicNavEnv {
  return {
    width: win.innerWidth,
    coarsePointer: win.matchMedia?.("(pointer: coarse)").matches ?? false,
  };
}
