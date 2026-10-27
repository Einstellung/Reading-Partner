// The tablet/desktop shell's left sidebar, minus React (docs/51): which items it
// has, which screen each one opens, and which one is lit for the screen that is
// showing. None of it touches the DOM, so the rendering can change without
// re-deriving any of it (CLAUDE.md).
//
// HomeScreen lives here rather than in InfoHome.tsx because this is what maps it
// to the sidebar, and a type in a .tsx would drag React into every test that
// wants to assert the mapping. InfoHome re-exports it, so its importers are
// unchanged.

import { OLD_BRIEFING_UI_ENABLED } from "../../../info/old-briefing";

// The launch layer in front of the library. "library" belongs to App, which
// renders the shelf; it is in the union so the two navigate through one setter.
// "settings" is one of them too: it is a page of the content area with the
// sidebar still beside it, not a screen laid over the app (docs/51).
export type HomeScreen =
  | "vestibule"
  | "library"
  | "briefing"
  // The info shelf: the brief's issues as books, and the topic volumes
  // (docs/info/88).
  | "briefs"
  | "article"
  | "meals"
  | "meals-shopping"
  | "meals-day"
  | "meals-recipe"
  | "meals-prep"
  | "meals-method"
  | "meals-onboarding"
  | "settings";

export type ShellNavId = "today" | "briefing" | "briefs" | "meals" | "topics" | "settings";

// Top to bottom, in the order a day uses them: what is open now, what came in
// overnight, everything else. Settings is a nav id but not one of these — it is
// pinned to the bottom of the sidebar, away from the day's three.
// The label is a catalog key, looked up at render so a language switch redraws it.
export interface ShellNavItem {
  id: ShellNavId;
  labelKey:
    | "shell.nav.today"
    | "shell.nav.briefing"
    | "shell.nav.briefs"
    | "shell.nav.meals"
    | "shell.nav.topics";
}

export const SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  { id: "today", labelKey: "shell.nav.today" },
  { id: "briefing", labelKey: "shell.nav.briefing" },
  { id: "briefs", labelKey: "shell.nav.briefs" },
  { id: "meals", labelKey: "shell.nav.meals" },
  { id: "topics", labelKey: "shell.nav.topics" },
];

// The items a sidebar actually draws. Meals is opt-in (settings.meals,
// docs/73) and is left out entirely when it is off — not greyed, not a teaser:
// a switch that is off means the reader has said they do not want the line.
// The old daily briefing is left out while its UI is switched off
// (info/old-briefing.ts).
export function shellNavItems(opts: { meals: boolean; oldBriefing?: boolean }): ShellNavItem[] {
  const oldBriefing = opts.oldBriefing ?? OLD_BRIEFING_UI_ENABLED;
  return SHELL_NAV_ITEMS.filter(
    (item) => (item.id !== "meals" || opts.meals) && (item.id !== "briefing" || oldBriefing),
  );
}

// The screen a request actually lands on. While the old briefing's UI is off
// (info/old-briefing.ts) its page and its article are nowhere: a box card from
// it, a card's Open, a place the soul names or a back from an article all land
// on Today instead. Every shell routes its navigation through this.
export function reachableScreen(
  screen: HomeScreen,
  oldBriefing: boolean = OLD_BRIEFING_UI_ENABLED,
): HomeScreen {
  if (!oldBriefing && (screen === "briefing" || screen === "article")) return "vestibule";
  return screen;
}

// Where an item goes. The shelf is what Topics opens; a topic that is already
// open stays open, which is App's business and not this table's.
export function screenForNav(id: ShellNavId): HomeScreen {
  switch (id) {
    case "today":
      return "vestibule";
    case "briefing":
      return "briefing";
    case "briefs":
      return "briefs";
    case "meals":
      return "meals";
    case "topics":
      return "library";
    case "settings":
      return "settings";
  }
}

// Which item is lit. The briefing's side room — an opened article — is still
// the briefing: it is reached from it and goes back to it, and an unlit sidebar
// would say the reader had left the app's map.
// Null while the reader is open, where the sidebar is not drawn at all.
export function activeNavFor(screen: HomeScreen | null): ShellNavId | null {
  switch (screen) {
    case "vestibule":
      return "today";
    case "briefing":
    case "article":
      return "briefing";
    case "briefs":
      return "briefs";
    // The shopping trip and one day are rooms of the meals page: reached from
    // it, going back to it, the same as the briefing's article above.
    case "meals":
    case "meals-shopping":
    case "meals-day":
    case "meals-recipe":
    case "meals-prep":
    case "meals-method":
    case "meals-onboarding":
      return "meals";
    case "library":
      return "topics";
    case "settings":
      return "settings";
    default:
      return null;
  }
}

// Whether the home area draws the launch card (the vestibule) for this screen.
// The briefing screen has nothing to draw when today's briefing does not exist
// (a reader device before sync, a fresh day before collection, no sources), so
// it falls back to the card that already says why.
export function showsLaunchCard(screen: HomeScreen, hasBriefing: boolean): boolean {
  return screen === "vestibule" || (screen === "briefing" && !hasBriefing);
}
