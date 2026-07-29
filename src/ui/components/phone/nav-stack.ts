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

// Whether a back has anywhere to go in the stack itself. False on home, the
// floor. Not the whole answer for a shell — see resolveBack.
export function canGoBack(stack: NavStack): boolean {
  return stack.length > 1;
}

// What a back does. An overlay drawn over the screens — the info call — is not
// a stack entry, and back has to close it rather than navigate underneath it:
// popping while it is up leaves the overlay on screen and drops the reader on a
// screen they never chose, which is what they see the moment they hang up.
//
// "none" is what leaves the gesture inert and hands the Android button back to
// the system, so it has to account for the overlay too: with one open on home
// there is something to go back from, even though the stack is at its floor.
export type BackAction = "dismissOverlay" | "pop" | "none";

export function resolveBack(stack: NavStack, overlayOpen: boolean): BackAction {
  if (overlayOpen) return "dismissOverlay";
  return canGoBack(stack) ? "pop" : "none";
}

export function backIsAvailable(stack: NavStack, overlayOpen: boolean): boolean {
  return resolveBack(stack, overlayOpen) !== "none";
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
