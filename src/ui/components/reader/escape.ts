// What Escape closes in the desktop shell: whatever is topmost. Reader settings,
// else Settings, else an AI-cited quote overlay, else a side conversation (which
// steps back to the one it came off rather than out of both), else the open
// call, else the annotation popup, else the sidebar drawer. The sidebar column
// covers nothing, so Escape leaves it.

export interface EscapeState {
  readerSettings: boolean;
  settingsShowing: boolean;
  quoteHighlight: boolean;
  call: { aside?: unknown } | null | undefined;
  popup: boolean;
  sidebarOpen: boolean;
  sidebarColumn: boolean;
}

export type EscapeTarget =
  | "reader-settings"
  | "settings"
  | "quote-highlight"
  | "aside"
  | "call"
  | "popup"
  | "sidebar";

export function escapeTarget(s: EscapeState): EscapeTarget | null {
  if (s.readerSettings) return "reader-settings";
  if (s.settingsShowing) return "settings";
  if (s.quoteHighlight) return "quote-highlight";
  if (s.call?.aside) return "aside";
  if (s.call) return "call";
  if (s.popup) return "popup";
  if (s.sidebarOpen && !s.sidebarColumn) return "sidebar";
  return null;
}
