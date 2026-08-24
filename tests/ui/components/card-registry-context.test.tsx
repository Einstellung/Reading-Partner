// Where a chat row gets its card components from (src/ui/components/chat/
// cardRegistryContext.ts). The table is assembled above chat/ and handed down by
// the shell, so chat/ never imports info/ or reader/ — the two directories that
// import chat/ for the card protocol. Run: bun test.

import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CardPayload, CardRegistry } from "../../../src/ui/components/chat/chatParts";
import type { ThreadMessage } from "../../../src/ui/components/chat/types";
import type { RetellDecisionCardData } from "../../../src/reading/retell/cards";
import { useDom } from "../../support/dom";
import { hushShell } from "../../support/shell";

// The last two tests mount a shell around a real chat, so this file needs a
// document. Everything React renders into one has to be evaluated after the
// window is up, which is why the imports below are dynamic (tests/support/
// dom.ts) — a static import of anything that reaches react-dom would decide,
// once and for the whole run, that there is no browser.
const { act, cleanup, render } = await useDom();
afterEach(cleanup);

const { CardRegistryContext } = await import("../../../src/ui/components/chat/cardRegistryContext");
const { CardRegistryProvider } = await import("../../../src/ui/components/CardRegistryProvider");
const { CARD_REGISTRY } = await import("../../../src/ui/components/cardRegistry");
const { MessageList } = await import("../../../src/ui/components/chat/chat");
const InfoHomeModule = await import("../../../src/ui/components/info/InfoHome");

const DECISION: RetellDecisionCardData = {
  kind: "retell-decision",
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
  "retell-decision": () => <p>{STUB_TEXT}</p>,
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

// A thread written by an older version carries card kinds this one may no
// longer have a component for — a drawn diagram, from before that feature was
// removed. The lookup misses, that row renders nothing, and the conversation
// around it comes out as it always did.
test("a card kind with no component is skipped and the rest of the thread renders", () => {
  const stale = { kind: "diagram", diagram: { nodes: [] } } as unknown as CardPayload;
  const messages: ThreadMessage[] = [
    { role: "ai", text: "the words above the picture", ts: 1 },
    { role: "ai", text: "", ts: 2, parts: [{ type: "card", id: "old", card: stale }] },
    { role: "user", text: "and the question after it", ts: 3 },
  ];
  const html = renderToStaticMarkup(
    <CardRegistryProvider>
      <MessageList messages={messages} />
    </CardRegistryProvider>,
  );
  expect(html).toContain("the words above the picture");
  expect(html).toContain("and the question after it");
});

// The shells themselves. Each mounts InfoHome where its screens go, and every
// chat either of them shows is under that point in the tree — so a chat is put
// there and asked to render a card. Under the provider the card comes out;
// orphaned, the same chat renders nothing at all and says nothing about it,
// which is what the test above ("a chat mounted with no provider renders no
// card") is the control for.
//
// This replaces a read of the shells' source for "<CardRegistryProvider>" and
// "</CardRegistryProvider>" appearing somewhere in the file, which is true of a
// shell whose closing tag sits against its opening one with every chat outside
// both.
//
// InfoHome is swapped for the chat rather than driven into opening its own: the
// info call arrives through the briefing pipeline and an agent turn, neither of
// which belongs in this test. The swap is spyOn on the module's default export
// (docs/pitfall/122), so the shells are mounted exactly as they are written.
function ChatProbe() {
  return <MessageList messages={rowWithCard()} />;
}

for (const [shell, load] of [
  ["App", () => import("../../../src/App")],
  ["PhoneApp", () => import("../../../src/PhoneApp")],
] as const) {
  test(`a chat where ${shell} mounts its screens renders its card`, async () => {
    const restore = hushShell();
    const spy = spyOn(InfoHomeModule, "default").mockImplementation(ChatProbe);
    try {
      const Shell = (await load()).default;
      const { container } = render(<Shell />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.textContent).toContain("Endings");
      expect(container.textContent).toContain("the 1962 data does the work");
    } finally {
      spy.mockRestore();
      restore();
    }
  });
}
