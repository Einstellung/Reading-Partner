// The receipt a side conversation leaves on the one it came off
// (src/ui/components/reader/AsideCard.tsx): that the registry covers its kind,
// that it is durable, and that pressing it goes back into the conversation it
// stands for — which for one pulled out of a reply is the only door there is.
// Rendered as a plain function call and walked as an element tree — no DOM
// needed. Run: bun test.

import { expect, test } from "bun:test";
import { CARD_REGISTRY } from "../../../src/ui/components/cardRegistry";
import { AsideReceiptCard } from "../../../src/ui/components/reader/AsideCard";
import { isPersistableCardKind } from "../../../src/ui/components/chat/chatParts";
import type { CardAction } from "../../../src/ui/components/chat/chatParts";
import type { AsideReceiptCardData } from "../../../src/reading/aside";

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

const payload: AsideReceiptCardData = {
  kind: "aside",
  threadId: "aside-1",
  span: "attention heads",
  question: "what is a head, concretely?",
};

test("the registry has a component for the card's kind", () => {
  expect(CARD_REGISTRY.aside).toBe(AsideReceiptCard);
});

// Losing the chip on reopen would lose the conversation: one opened on words out
// of a reply has no mark and no page, so the lesson's transcript is the only
// place it exists.
test("the receipt is durable", () => {
  expect(isPersistableCardKind("aside")).toBe(true);
});

test("the chip says which question was stepped out to ask", () => {
  const shown = texts(AsideReceiptCard({ payload, surface: "call", dispatch: () => {} })).join(" ");
  expect(shown).toContain("what is a head, concretely?");
  expect(shown).toContain("Aside");
});

test("pressing it navigates back into that conversation", () => {
  const raised: CardAction[] = [];
  const el = AsideReceiptCard({ payload, surface: "call", dispatch: (a) => raised.push(a) }) as {
    props: { onClick(): void };
  };
  el.props.onClick();
  expect(raised).toEqual([{ kind: "navigate", to: "aside", arg: "aside-1" }]);
});
