// The receipt a side conversation leaves on the one it came off
// (src/ui/components/reader/AsideCard.tsx): that the registry covers its kind,
// that it is durable, that it says where the reader stepped out and back into
// which conversation — which for one pulled out of a reply is the only door
// there is — and that a run of them collapses to one line.
//
// A real DOM, because the rows are nested components inside a native
// disclosure. What each row says is decided in src/reading/aside.ts and tested
// in tests/reading/aside.test.ts. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { CARD_REGISTRY } from "../../../src/ui/components/cardRegistry";
import { AsideReceiptCard } from "../../../src/ui/components/reader/AsideCard";
import { isPersistableCardKind } from "../../../src/ui/components/chat/chatParts";
import type { CardAction } from "../../../src/ui/components/chat/chatParts";
import type { AsideReceiptCardData } from "../../../src/reading/aside";
import { useDom } from "../../support/dom";

const { cleanup, render } = await useDom();
afterEach(cleanup);

const one: AsideReceiptCardData = {
  kind: "aside",
  items: [
    {
      threadId: "aside-1",
      span: "attention heads",
      question: "what is a head, concretely?",
      page: 96,
    },
  ],
};

function draw(payload: AsideReceiptCardData) {
  const raised: CardAction[] = [];
  const view = render(
    <AsideReceiptCard payload={payload} surface="call" dispatch={(a) => raised.push(a)} />,
  );
  return {
    raised,
    text: view.container.textContent ?? "",
    rows: [...view.container.querySelectorAll("button")],
    summary: view.container.querySelector("summary"),
  };
}

test("the registry has a component for the card's kind", () => {
  expect(CARD_REGISTRY.aside).toBe(AsideReceiptCard);
});

// Losing the row on reopen would lose the conversation: one opened on words out
// of a reply has no mark and no page, so the lesson's transcript is the only
// place it exists.
test("the receipt is durable", () => {
  expect(isPersistableCardKind("aside")).toBe(true);
});

test("one aside is one row, saying where it was asked and what was asked", () => {
  const { text, rows, summary } = draw(one);
  expect(text).toContain("what is a head, concretely?");
  expect(text).toContain("Aside");
  expect(text).toContain("p.96");
  expect(rows).toHaveLength(1);
  // Nothing to collapse, so nothing to open.
  expect(summary).toBeNull();
});

test("pressing a row navigates back into that conversation", () => {
  const { raised, rows } = draw(one);
  rows[0].click();
  expect(raised).toEqual([{ kind: "navigate", to: "aside", arg: "aside-1" }]);
});

// The records already on disk carry one aside's fields at the top level and no
// `items`. Nothing migrates them, so the row has to read them as they are.
test("a receipt written before items still draws its row", () => {
  const { text, rows } = draw({
    kind: "aside",
    threadId: "aside-old",
    span: "residual stream",
    question: "why add it back?",
  });
  expect(rows).toHaveLength(1);
  expect(text).toContain("why add it back?");
  // No page on it, so the words it was pulled out of stand in.
  expect(text).toContain("residual stream");
});

test("several asides collapse to a count, and each row is its own door", () => {
  const three: AsideReceiptCardData = {
    kind: "aside",
    items: [
      { threadId: "aside-1", span: "s1", question: "q1", page: 96 },
      { threadId: "aside-2", span: "s2", question: "q2", page: 99 },
      { threadId: "aside-3", span: "s3", question: "q3" },
    ],
  };
  const { raised, rows, summary, text } = draw(three);
  expect(summary?.textContent).toContain("3 questions while you were reading");
  // Collapsed is the element's own state (a native disclosure), so the rows are
  // in the tree either way.
  expect(rows).toHaveLength(3);
  expect(text).toContain("q3");
  rows[2].click();
  expect(raised).toEqual([{ kind: "navigate", to: "aside", arg: "aside-3" }]);
});
