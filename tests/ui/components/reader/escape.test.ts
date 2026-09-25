// What Escape closes in the desktop shell (src/ui/components/reader/escape.ts)
// and the rack's tool as the reader view takes it (reader-tool.ts). Run: bun test.

import { expect, test } from "bun:test";
import { escapeTarget, type EscapeState } from "../../../../src/ui/components/reader/escape";
import { readerTool } from "../../../../src/ui/components/reader/reader-tool";
import { AI_PEN_COLOR } from "../../../../src/reading/session/use-marks";

const idle: EscapeState = {
  readerSettings: false,
  settingsShowing: false,
  quoteHighlight: false,
  call: null,
  popup: false,
  sidebarOpen: false,
  sidebarColumn: false,
};

test("nothing open: Escape does nothing", () => {
  expect(escapeTarget(idle)).toBeNull();
});

test("the topmost layer wins, in order", () => {
  const all: EscapeState = {
    readerSettings: true,
    settingsShowing: true,
    quoteHighlight: true,
    call: { aside: { from: "chat" } },
    popup: true,
    sidebarOpen: true,
    sidebarColumn: false,
  };
  expect(escapeTarget(all)).toBe("reader-settings");
  expect(escapeTarget({ ...all, readerSettings: false })).toBe("settings");
  expect(escapeTarget({ ...all, readerSettings: false, settingsShowing: false })).toBe("quote-highlight");
  const noOverlays = { ...all, readerSettings: false, settingsShowing: false, quoteHighlight: false };
  expect(escapeTarget(noOverlays)).toBe("aside");
  expect(escapeTarget({ ...noOverlays, call: {} })).toBe("call");
  expect(escapeTarget({ ...noOverlays, call: null })).toBe("popup");
  expect(escapeTarget({ ...noOverlays, call: null, popup: false })).toBe("sidebar");
});

test("the sidebar drawer closes, the column stays", () => {
  expect(escapeTarget({ ...idle, sidebarOpen: true })).toBe("sidebar");
  expect(escapeTarget({ ...idle, sidebarOpen: true, sidebarColumn: true })).toBeNull();
});

test("the rack's tools map to the reader view's", () => {
  expect(readerTool("none", "#111")).toEqual({ type: "pointer" });
  expect(readerTool("navlock", "#111")).toEqual({ type: "navlock" });
  expect(readerTool("highlight", "#111")).toEqual({ type: "highlight", color: "#111" });
  expect(readerTool("ai", "#111")).toEqual({ type: "underline", color: AI_PEN_COLOR });
});
