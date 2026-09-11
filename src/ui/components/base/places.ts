// The places the soul can take the reader to (docs/67), minus React: which
// places there are, what each one is for, and which screen each one opens.
// Beside shell-nav.ts because it is the same kind of table — the sidebar's
// version of it is what a finger reaches, this is what a sentence reaches — and
// because both shells navigate by naming a HomeScreen.
//
// One table for both shells. The phone draws fewer screens, so it registers a
// subset (PHONE_PLACES); what a place is stays the same sentence either way,
// since it describes what is there and not how that shell draws it.

import type { Place } from "../../../desk";
import type { HomeScreen } from "./shell-nav";

export const PLACE_IDS = ["today", "briefing", "topics", "sources", "settings"] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

// The phone has no shelf: nothing on its home screen leads to the library, so
// there is nowhere for a place named "topics" to go.
export const PHONE_PLACES: readonly PlaceId[] = ["today", "briefing", "sources", "settings"];

// One sentence each, written for the reader rather than for the model: these
// are what the soul reads out when it shows somebody around.
export const PLACE_ABOUT: Record<PlaceId, string> = {
  today: "Where the reader lands when the app opens: what is open now, and where to carry on.",
  briefing: "Today's briefing: what came in overnight from the sources the reader follows.",
  topics: "The shelf: the reader's topics and the books kept in each of them.",
  sources: "Where the briefing comes from: the list of sources it is drawn from.",
  settings: "The settings: the providers and model behind you, and how this device behaves.",
};

export function screenForPlace(id: PlaceId): HomeScreen {
  switch (id) {
    case "today":
      return "vestibule";
    case "briefing":
      return "briefing";
    case "topics":
      return "library";
    case "sources":
      return "sources";
    case "settings":
      return "settings";
  }
}

export interface ShellPlaceMoves {
  // Where the shell goes. The phone folds "vestibule" and "library" into its own
  // home on the way in, which is why this is named after a screen and not after
  // a place.
  goToScreen: (screen: HomeScreen) => void;
  // How this shell leaves the reader, on a shell that has one. Every place is a
  // screen of the app around the book, and those are not drawn while a book is
  // open: going anywhere from inside a book closes the book first. Left out by
  // the phone, which opens no books.
  reader?: { isOpen: () => boolean; close: () => void };
}

/** The shell's places, in the order the soul is shown them. */
export function shellPlaces(
  moves: ShellPlaceMoves,
  ids: readonly PlaceId[] = PLACE_IDS,
): Place[] {
  return ids.map((id) => ({
    id,
    about: PLACE_ABOUT[id],
    go: () => {
      if (moves.reader?.isOpen()) moves.reader.close();
      moves.goToScreen(screenForPlace(id));
    },
  }));
}
