// The composer's voice-input default (src/ui/components/chat/chat.tsx). Voice is a base
// capability: the mic renders unless a caller explicitly opts out, or the host
// cannot record. Covered two ways — the pure prop resolver, and a static render
// that proves the mic button is actually in (or out of) the DOM. Run: bun test.

import { test, expect, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The render tests stand in for a desktop host: capture is a Rust command
// compiled `#[cfg(desktop)]`, and without the plugin the composer would rightly
// hide the mic (see hasNativeRecorder). This says nothing about the prop rules,
// which the resolver tests cover directly.
mock.module("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));
import { Composer, resolveComposerVoice } from "../../../src/ui/components/chat/chat";

// The mic button's title/aria-label; its presence in the markup means the mic
// rendered.
const MIC = "Hold to talk";

test("resolveComposerVoice: mic is on by default, glossary defaults empty", () => {
  expect(resolveComposerVoice(undefined, true)).toEqual({ glossary: "" });
});

test("resolveComposerVoice: an enrichment object keeps the mic on and carries the glossary", () => {
  expect(resolveComposerVoice({ glossary: "Attention Is All You Need" }, true)).toEqual({
    glossary: "Attention Is All You Need",
  });
});

test("resolveComposerVoice: only voice={false} disables the mic", () => {
  expect(resolveComposerVoice(false, true)).toBeNull();
});

test("resolveComposerVoice: a host with no recorder hides the mic whatever the prop says", () => {
  expect(resolveComposerVoice(undefined, false)).toBeNull();
  expect(resolveComposerVoice({ glossary: "CD-LAM" }, false)).toBeNull();
});

test("Composer renders the mic by default with no voice prop", () => {
  const html = renderToStaticMarkup(<Composer onSend={() => {}} placeholder="Ask…" />);
  expect(html).toContain(MIC);
});

test("Composer hides the mic when explicitly disabled with voice={false}", () => {
  const html = renderToStaticMarkup(
    <Composer onSend={() => {}} placeholder="Ask…" voice={false} />,
  );
  expect(html).not.toContain(MIC);
});
