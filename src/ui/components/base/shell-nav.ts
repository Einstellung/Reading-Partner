// The tablet/desktop shell's left sidebar, minus React (docs/51): which items it
// has, which screen each one opens, and which one is lit for the screen that is
// showing. None of it touches the DOM, so the rendering can change without
// re-deriving any of it (CLAUDE.md).
//
// HomeScreen lives here rather than in InfoHome.tsx because this is what maps it
// to the sidebar, and a type in a .tsx would drag React into every test that
// wants to assert the mapping. InfoHome re-exports it, so its importers are
// unchanged.

// The launch layer in front of the library. "library" belongs to App, which
// renders the shelf; it is in the union so the two navigate through one setter.
// "settings" is one of them too: it is a page of the content area with the
// sidebar still beside it, not a screen laid over the app (docs/51).
export type HomeScreen =
  | "vestibule"
  | "library"
  | "briefing"
  | "article"
  | "sources"
  | "settings";

export type ShellNavId = "today" | "briefing" | "topics" | "settings";

// Top to bottom, in the order a day uses them: what is open now, what came in
// overnight, everything else. Settings is a nav id but not one of these — it is
// pinned to the bottom of the sidebar, away from the day's three.
export const SHELL_NAV_ITEMS: readonly { id: ShellNavId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "briefing", label: "Briefing" },
  { id: "topics", label: "Topics" },
];

// Where an item goes. The shelf is what Topics opens; a topic that is already
// open stays open, which is App's business and not this table's.
export function screenForNav(id: ShellNavId): HomeScreen {
  switch (id) {
    case "today":
      return "vestibule";
    case "briefing":
      return "briefing";
    case "topics":
      return "library";
    case "settings":
      return "settings";
  }
}

// Which item is lit. The briefing's two side rooms — the source list and an
// opened article — are still the briefing: they are reached from it and go back
// to it, and an unlit sidebar would say the reader had left the app's map.
// Null while the reader is open, where the sidebar is not drawn at all.
export function activeNavFor(screen: HomeScreen | null): ShellNavId | null {
  switch (screen) {
    case "vestibule":
      return "today";
    case "briefing":
    case "article":
    case "sources":
      return "briefing";
    case "library":
      return "topics";
    case "settings":
      return "settings";
    default:
      return null;
  }
}
