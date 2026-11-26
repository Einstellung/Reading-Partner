// The tablet/desktop shell's left sidebar, minus React (docs/51): which items it
// has, which screen each one opens, and which one is lit for the screen that is
// showing. None of it touches the DOM, so the rendering can change without
// re-deriving any of it (CLAUDE.md).
//
// HomeScreen lives here because this is what maps it to the sidebar, and a type
// in a .tsx would drag React into every test that wants to assert the mapping.

// The launch layer in front of the library. "library" belongs to App, which
// renders the shelf; it is in the union so the two navigate through one setter.
// "settings" is one of them too: it is a page of the content area with the
// sidebar still beside it, not a screen laid over the app (docs/51).
export type HomeScreen =
  | "vestibule"
  | "library"
  | "meals"
  | "meals-shopping"
  | "meals-day"
  | "meals-recipe"
  | "meals-prep"
  | "meals-method"
  | "meals-onboarding"
  | "settings";

export type ShellNavId = "today" | "meals" | "topics" | "settings";

// Top to bottom, in the order a day uses them: what is open now, what came in
// overnight, everything else. Settings is a nav id but not one of these — it is
// pinned to the bottom of the sidebar, away from the day's three.
// The label is a catalog key, looked up at render so a language switch redraws it.
export interface ShellNavItem {
  id: ShellNavId;
  labelKey:
    | "shell.nav.today"
    | "shell.nav.meals"
    | "shell.nav.topics";
}

export const SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  { id: "today", labelKey: "shell.nav.today" },
  { id: "meals", labelKey: "shell.nav.meals" },
  { id: "topics", labelKey: "shell.nav.topics" },
];

// The items a sidebar actually draws. Meals is opt-in (the Meals experiment,
// docs/73) and is left out entirely when it is off — not greyed, not a teaser:
// a switch that is off means the reader has said they do not want the line.
export function shellNavItems(opts: { meals: boolean }): ShellNavItem[] {
  return SHELL_NAV_ITEMS.filter((item) => item.id !== "meals" || opts.meals);
}

// The screen a request actually lands on: Today, for a screen of a line whose
// experiment is off (platform/experiments) — the meals screens while meals is
// hidden. `shown` says which lines are drawn; left out, all are. Every shell
// routes its navigation through this.
export function reachableScreen(screen: HomeScreen, shown: { meals?: boolean } = {}): HomeScreen {
  return hiddenByExperiments(screen, shown) ? "vestibule" : screen;
}

// Whether a screen belongs to a line that is not drawn: the meals page and its
// rooms. A string so the phone's stack kinds, which use the same names, can ask too.
export function hiddenByExperiments(screen: string, shown: { meals?: boolean }): boolean {
  return shown.meals === false && (screen === "meals" || screen.startsWith("meals-"));
}

// Where an item goes. The shelf is what Topics opens; a topic that is already
// open stays open, which is App's business and not this table's.
export function screenForNav(id: ShellNavId): HomeScreen {
  switch (id) {
    case "today":
      return "vestibule";
    case "meals":
      return "meals";
    case "topics":
      return "library";
    case "settings":
      return "settings";
  }
}

// Which item is lit. A room of a page — one day of the week, a recipe — is still
// that page: it is reached from it and goes back to it, and an unlit sidebar
// would say the reader had left the app's map.
// Null while the reader is open, where the sidebar is not drawn at all.
export function activeNavFor(screen: HomeScreen | null): ShellNavId | null {
  switch (screen) {
    case "vestibule":
      return "today";
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
