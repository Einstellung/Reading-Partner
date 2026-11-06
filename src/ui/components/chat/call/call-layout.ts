// How much of the window a live call takes, and what happens when something
// inside it opens another screen. Both follow from one thing the host decides:
// whether the call keeps corner cards (docs/03).
//
// With them the call and its content trade places — the content shrinks into a
// pip while the chat is the main screen, and tapping either one swaps them — so
// opening a screen underneath only has to shrink the chat.
//
// Without them (the phone shell, docs/22) the chat is a screen of the
// navigation stack: it fills the shell, nothing can shrink it, and the swapped
// layout does not exist rather than being unreachable. Opening another screen
// has to end the call, or the reader would ask for a screen and stay looking at
// the conversation.

export type CallLayout = "chat-main" | "chat-pip";

export function callLayout(pipCards: boolean, swapped: boolean): CallLayout {
  return pipCards && swapped ? "chat-pip" : "chat-main";
}

// What a card's "open that screen" does to the call it was tapped in.
export type CallNavigation = "swap" | "hang-up";

export function navigateAway(pipCards: boolean): CallNavigation {
  return pipCards ? "swap" : "hang-up";
}

// Whether the call is tapped out of the way, and for which ask. Asking again —
// a new anchor, even on the same thread — brings the chat back to the main
// screen; a swap set for an earlier ask does not carry over to the new one.
export interface CallSwap<K> {
  key: K;
  swapped: boolean;
}

export function swappedFor<K>(swap: CallSwap<K>, key: K): boolean {
  return swap.swapped && swap.key === key;
}

// Where the chat pip sits over an info screen: below the screen's sticky top
// bar, whose right end holds the screen's own Ask button.
export const INFO_CHAT_PIP_CORNER = "absolute right-3 top-20 z-50";
