// The opening-intent chips (src/ui/components/chat/IntentChips.tsx). What the
// render layer owes the table: one chip per intent showing its label, a press
// sending its message and not its label, and no chips at all for an empty set.
// Rendered as a plain function call and walked as an element tree — no DOM
// needed. Run: bun test.

import { expect, test } from "bun:test";
import IntentChips from "../../../src/ui/components/chat/IntentChips";
import { Button } from "../../../src/ui/components/ui/button";
import { MARK_INTENTS, openingIntents } from "../../../src/reading/intents";

type El = { type?: unknown; props?: Record<string, any> };

function buttons(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const c of node) buttons(c, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const el = node as El;
  if (el.type === Button) out.push(el);
  if (el.props && "children" in el.props) buttons(el.props.children, out);
  return out;
}

test("one chip per intent, labelled the way the table says", () => {
  const chips = buttons(IntentChips({ intents: MARK_INTENTS, onPick: () => {} }));
  expect(chips.map((c) => c.props?.children)).toEqual(MARK_INTENTS.map((i) => i.label));
});

test("a press sends the intent's message, not the chip's label", () => {
  const sent: string[] = [];
  const chips = buttons(IntentChips({ intents: MARK_INTENTS, onPick: (m) => void sent.push(m) }));
  for (const chip of chips) chip.props?.onClick();
  expect(sent).toEqual(MARK_INTENTS.map((i) => i.message));
});

// The bubble is 360px wide and narrower on a phone, so the row has to wrap
// rather than push its way out of the panel.
test("the row wraps", () => {
  const row = IntentChips({ intents: MARK_INTENTS, onPick: () => {} }) as El;
  expect(String(row.props?.className)).toContain("flex-wrap");
});

// The touch target is the button variant table's job, not this call site's
// (docs/30) — a `coarse:` here would be the second place to keep true.
test("the chips carry no touch-target class of their own", () => {
  const chips = buttons(IntentChips({ intents: MARK_INTENTS, onPick: () => {} }));
  for (const chip of chips) {
    expect(chip.props?.size).toBe("chip");
    expect(String(chip.props?.className ?? "")).not.toContain("coarse:");
  }
});

test("an empty set renders nothing", () => {
  expect(IntentChips({ intents: [], onPick: () => {} })).toBeNull();
});

// The book-level conversation is that empty set (docs/09, 2026-08-20): the
// reader types. Read through openingIntents rather than as a literal `[]`, so
// putting a chip back on that entry fails here too.
test("the book-level conversation draws no chip row", () => {
  expect(IntentChips({ intents: openingIntents(true), onPick: () => {} })).toBeNull();
  expect(buttons(IntentChips({ intents: openingIntents(false), onPick: () => {} }))).not.toHaveLength(
    0,
  );
});
