// The phone shell's navigation stack (docs/22). Pure — no React, no DOM — so
// the one definition of "back" can be read and tested on its own.
//
// The shell used to hold a flat `screen` plus two loose pieces of state (the
// opened saved article, the settings overlay), and every top bar wrote its own
// destination into it. Here every screen is an entry, home is the floor, and
// back is `pop`. The three things that trigger a back — a top bar button, the
// left-edge swipe, the Android system button — all end up in the same function.
//
// Settings is an entry like any other even though it draws as a full-screen
// overlay: it is always pushed last, so `baseScreen` hands the shell the screen
// that keeps rendering underneath it.

import type { SavedArticle } from "../../../reading/saved-articles";

export type ScreenKind =
  | "home"
  | "briefing"
  | "article"
  | "sources"
  | "saved"
  | "savedArticle"
  | "settings";

// Only the opened saved article carries anything: the record itself, the way the
// shell used to keep it beside `screen`.
export type PhoneScreen =
  | { kind: "home" }
  | { kind: "briefing" }
  | { kind: "article" }
  | { kind: "sources" }
  | { kind: "saved" }
  | { kind: "savedArticle"; article: SavedArticle }
  | { kind: "settings" };

export type PayloadFreeKind = Exclude<ScreenKind, "savedArticle">;

export type NavStack = readonly PhoneScreen[];

export const HOME: PhoneScreen = { kind: "home" };

// The stack the shell boots with. Home is the floor and is never popped.
export const INITIAL_STACK: NavStack = [HOME];

export function screen(kind: PayloadFreeKind): PhoneScreen {
  return { kind };
}

export function top(stack: NavStack): PhoneScreen {
  return stack[stack.length - 1] ?? HOME;
}

// Whether a back has anywhere to go. False on home, which is where the swipe
// must not engage and where the Android button belongs to the system.
export function canGoBack(stack: NavStack): boolean {
  return stack.length > 1;
}

// Back. Identity at the floor, so a caller never has to check first.
export function back(stack: NavStack): NavStack {
  return canGoBack(stack) ? stack.slice(0, -1) : stack;
}

export function push(stack: NavStack, next: PhoneScreen): NavStack {
  return [...stack, next];
}

// Navigate to a screen the way InfoHome asks for it: by naming a destination
// rather than a direction. A destination already on the stack is a back — the
// article's top bar asks for "briefing", which is where it was opened from — so
// it unwinds to that entry instead of stacking a second copy. Anything else is
// a push.
//
// The unwind keeps the entry that is already there, payload and all, which is
// why a screen that carries one (savedArticle) is pushed directly instead.
export function goTo(stack: NavStack, next: PhoneScreen): NavStack {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === next.kind) return stack.slice(0, i + 1);
  }
  return push(stack, next);
}

// The screen that draws the page itself: the top one, or the one below Settings
// while Settings is up. Settings covers the viewport, so what it covers keeps
// its scroll position and its state instead of unmounting.
export function baseScreen(stack: NavStack): PhoneScreen {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind !== "settings") return stack[i];
  }
  return HOME;
}
