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
