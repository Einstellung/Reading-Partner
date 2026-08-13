// Where a chat row gets its card components from (src/ui/components/chat/
// cardRegistryContext.ts). The table is assembled above chat/ and handed down by
// the shell, so chat/ never imports info/ or reader/ — the two directories that
// import chat/ for the card protocol. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { CardRegistryContext } from "../../../src/ui/components/chat/cardRegistryContext";
import { CardRegistryProvider } from "../../../src/ui/components/CardRegistryProvider";
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

// What the shells mount, rendered: the component both of them wrap their chat
// in has to hand down the assembled table, and the table has to carry every kind
// the union declares.
test("the provider the shells mount renders the real card", () => {
  const html = renderToStaticMarkup(
    <CardRegistryProvider>
      <MessageList messages={rowWithCard()} />
    </CardRegistryProvider>,
  );
  expect(html).toContain("Endings");
});

const SRC = fileURLToPath(new URL("../../../src", import.meta.url));

// The shells themselves. Read as source and not rendered: App.tsx is 1400 lines
// of hooks over Tauri and a chat is nowhere near the top of either tree, so
// mounting one in a test is not on. What can be checked is that the wrapper is
// there at all, which is the whole failure — a shell that drops it renders every
// card as nothing, with no error and no failing type, and only this test says so.
test("both shells wrap their chat in the provider", () => {
  for (const shell of ["App.tsx", "PhoneApp.tsx"]) {
    const source = readFileSync(join(SRC, shell), "utf8");
    expect(`${shell}: ${source.includes("<CardRegistryProvider>")}`).toBe(`${shell}: true`);
    expect(`${shell}: ${source.includes("</CardRegistryProvider>")}`).toBe(`${shell}: true`);
  }
});
