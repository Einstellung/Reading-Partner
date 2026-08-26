// The talk arrangement card (src/ui/components/reader/TalkArrangementCard.tsx):
// that the registry covers its kind, that each of the four writes reads back as
// what landed, and that it is a receipt rather than an editor. Rendered as plain
// function calls and walked as an element tree — no DOM needed.
// Run: bun test.

import { expect, test } from "bun:test";
import { CARD_REGISTRY } from "../../../src/ui/components/cardRegistry";
import { TalkArrangementCard } from "../../../src/ui/components/reader/TalkArrangementCard";
import { Button } from "../../../src/ui/components/ui/button";
import type { TalkArrangementCardData } from "../../../src/reading/retell/cards";

// The card is built out of small presentational components, so the walker has to
// call a function component rather than stop at it — the eyebrow and the badge
// are props of one, not children of it.
function texts(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const c of node) texts(c, out);
    return out;
  }
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const el = node as { type?: unknown; props?: Record<string, any> };
  if (typeof el.type === "function") return texts((el.type as Function)(el.props), out);
  if (el.props && "children" in el.props) texts(el.props.children, out);
  return out;
}

function controls(node: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const c of node) controls(c, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const el = node as { type?: unknown; props?: Record<string, any> };
  if (el.type === "button" || el.type === Button) out.push(el);
  if (typeof el.type === "function") return controls((el.type as Function)(el.props), out);
  if (el.props && "children" in el.props) controls(el.props.children, out);
  return out;
}

const shown = (payload: TalkArrangementCardData) =>
  texts(TalkArrangementCard({ payload, surface: "call", dispatch: () => {} })).join(" ");

test("the registry has a component for the card's kind", () => {
  expect(CARD_REGISTRY["talk-arrangement"]).toBe(TalkArrangementCard);
});

test("a spine write shows the through-line and who it is for", () => {
  const joined = shown({
    kind: "talk-arrangement",
    change: "spine",
    spine: {
      thesis: "The eye throws most of it away",
      backbone: ["what arrives", "what is discarded"],
      audience: "people who never took a vision course",
      conventions: ["no English acronyms"],
      excluded: ["the psychophysics"],
    },
  });
  expect(joined).toContain("The eye throws most of it away");
  expect(joined).toContain("people who never took a vision course");
  expect(joined).toContain("what is discarded");
  expect(joined).toContain("no English acronyms");
  expect(joined).toContain("the psychophysics");
});

test("a block write shows its place and the head of what was written", () => {
  const joined = shown({
    kind: "talk-arrangement",
    change: "segment",
    body: [
      "## Why the eye is not a camera",
      "",
      "ask what they think the retina sends",
      "",
      "[fig:3] the ganglion map",
      "",
      "$$",
      "x^2 + y^2",
      "$$",
      "",
      "and the line that pays it back",
    ].join("\n"),
    position: 2,
    total: 5,
  });
  expect(joined).toContain("Block 2 of 5");
  expect(joined).toContain("Why the eye is not a camera");
  expect(joined).toContain("ask what they think the retina sends");
  // A receipt, not a second place to read the note: past a few lines it is cut,
  // and it is never handed to the markdown renderer.
  expect(joined).toContain("…");
  expect(joined).not.toContain("and the line that pays it back");
});

test("a dropped segment and a moved one each say what happened", () => {
  const dropped = shown({
    kind: "talk-arrangement",
    change: "removed",
    title: "The detour",
    total: 4,
  });
  expect(dropped).toContain("Dropped");
  expect(dropped).toContain("The detour");
  expect(dropped).toContain("4");

  const moved = shown({
    kind: "talk-arrangement",
    change: "moved",
    title: "The payoff",
    position: 6,
    total: 6,
  });
  expect(moved).toContain("Moved");
  expect(moved).toContain("The payoff");
  expect(moved).toContain("6");
});

// The conversation is the correction UI: changing the talk is a sentence to the
// AI, not a button here.
test("the card carries no controls", () => {
  const payload: TalkArrangementCardData = {
    kind: "talk-arrangement",
    change: "segment",
    body: "## A",
    position: 1,
    total: 1,
  };
  expect(controls(TalkArrangementCard({ payload, surface: "call", dispatch: () => {} }))).toHaveLength(0);
});
