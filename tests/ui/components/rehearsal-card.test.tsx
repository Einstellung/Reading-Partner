// The rehearsal decision card (src/ui/components/reader/RehearsalCard.tsx): that
// the registry covers its kind, that the card is a receipt rather than an editor,
// and that a recorded decision survives a reopened conversation. Rendered as a
// plain function call and walked as an element tree — no DOM needed.
// Run: bun test.

import { expect, test } from "bun:test";
import { CARD_REGISTRY } from "../../../src/ui/components/chat/cardRegistry";
import { RehearsalDecisionCard } from "../../../src/ui/components/reader/RehearsalCard";
import { Button } from "../../../src/ui/components/ui/button";
import { isPersistableCardKind } from "../../../src/ui/components/chat/chatParts";
import type { RehearsalDecisionCardData } from "../../../src/reading/rehearsal/cards";

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
  const el = node as { props?: Record<string, any> };
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
  if (el.props && "children" in el.props) controls(el.props.children, out);
  return out;
}

const payload: RehearsalDecisionCardData = {
  kind: "rehearsal-decision",
  chapter: 3,
  title: "Endings",
  include: true,
  points: ["the 1962 data does the work", "contrast with chapter 2"],
  figure: "[fig:7]",
  note: "the reader wants to open with this",
};

test("the registry has a component for the card's kind", () => {
  expect(CARD_REGISTRY["rehearsal-decision"]).toBe(RehearsalDecisionCard);
});

test("the card shows what was written down", () => {
  const shown = texts(RehearsalDecisionCard({ payload, surface: "call", dispatch: () => {} }));
  const joined = shown.join(" ");
  expect(joined).toContain("Endings");
  expect(joined).toContain("3");
  expect(joined).toContain("In the talk");
  expect(joined).toContain("the 1962 data does the work");
  expect(joined).toContain("[fig:7]");
  expect(joined).toContain("the reader wants to open with this");
});

test("a cut chapter says so, and shows no points it does not have", () => {
  const cut: RehearsalDecisionCardData = {
    kind: "rehearsal-decision",
    chapter: 2,
    title: "Middlegame",
    include: false,
    points: [],
  };
  const joined = texts(RehearsalDecisionCard({ payload: cut, surface: "call", dispatch: () => {} })).join(" ");
  expect(joined).toContain("Cut");
  expect(joined).not.toContain("In the talk");
});

// Correcting a decision is a sentence to the AI, which re-records it and raises a
// fresh card. A row of buttons here would be a second, worse editor.
test("the card raises nothing: it has no controls", () => {
  expect(controls(RehearsalDecisionCard({ payload, surface: "call", dispatch: () => {} }))).toHaveLength(0);
});

// A rehearsal runs over several sittings, so a receipt the reader cannot find
// again tomorrow is not a receipt.
test("the decision card is durable", () => {
  expect(isPersistableCardKind("rehearsal-decision")).toBe(true);
});
