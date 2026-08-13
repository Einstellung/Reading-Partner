// Where a chat row gets its card components from (src/ui/components/chat/
// cardRegistryContext.ts). The table is assembled above chat/ and handed down by
// the shell, so chat/ never imports info/ or reader/ — the two directories that
// import chat/ for the card protocol. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CardRegistryContext } from "../../../src/ui/components/chat/cardRegistryContext";
import { CARD_REGISTRY } from "../../../src/ui/components/cardRegistry";
import { MessageList } from "../../../src/ui/components/chat/chat";
import type { CardRegistry } from "../../../src/ui/components/chat/chatParts";
import type { ThreadMessage } from "../../../src/ui/components/chat/types";
import type { RehearsalDecisionCardData } from "../../../src/reading/rehearsal/cards";

const DECISION: RehearsalDecisionCardData = {
  kind: "rehearsal-decision",
  chapter: 3,
  title: "Endings",
  include: true,
  points: ["the 1962 data does the work"],
};

function rowWithCard(): ThreadMessage[] {
  return [
    {
      role: "ai",
      text: "",
      ts: 1,
      parts: [{ type: "card", id: "c1", card: { ...DECISION } }],
    },
  ];
}

// A stand-in for the real table: nothing else in the app renders this string, so
// seeing it means the lookup went through the context and not through a module
// the chat imported for itself.
const STUB_TEXT = "stub card stood in for the real one";
const STUB: CardRegistry = {
  ...CARD_REGISTRY,
  "rehearsal-decision": () => <p>{STUB_TEXT}</p>,
};

test("the card comes from the registry the host provided, not from chat's own import", () => {
  const html = renderToStaticMarkup(
    <CardRegistryContext.Provider value={STUB}>
      <MessageList messages={rowWithCard()} />
    </CardRegistryContext.Provider>,
  );
  expect(html).toContain(STUB_TEXT);
  // The real card's own wording, which would appear if chat read CARD_REGISTRY
  // directly and ignored what it was given.
  expect(html).not.toContain("Endings");
});

// The negative half is what keeps the import from creeping back: with the static
// table the row would render the real card here, provider or no provider.
test("a chat mounted with no provider renders no card", () => {
  const html = renderToStaticMarkup(<MessageList messages={rowWithCard()} />);
  expect(html).not.toContain("Endings");
  expect(html).not.toContain(STUB_TEXT);
});

test("the shells' table still covers every kind the union declares", () => {
  const html = renderToStaticMarkup(
    <CardRegistryContext.Provider value={CARD_REGISTRY}>
      <MessageList messages={rowWithCard()} />
    </CardRegistryContext.Provider>,
  );
  expect(html).toContain("Endings");
});
