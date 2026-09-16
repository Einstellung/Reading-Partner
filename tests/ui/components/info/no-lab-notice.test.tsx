// The briefing card when the bureau has no open room.
//
// The collection gate (info/program/live.ts) and the pipeline both decline
// without one, silently, while the source polling keeps running — so the card is
// the only thing that can tell the reader the day stopped arriving and why. This
// is the test that it does, and that it does not say it before the labs file has
// answered. Run: scripts/t.sh tests/ui/components/info/no-lab-notice.test.tsx

import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../../support/dom";

const { act, cleanup, render } = await useDom();
afterEach(cleanup);

// Imported after the window is up, for the reason launch-placeholder.test.tsx
// gives: react-dom decides once, at evaluation, whether it is in a browser.
const { BriefingCardBody } = await import("../../../../src/ui/components/info/HomeCard");
const { NO_LAB_NOTICE } = await import("../../../../src/ui/components/info/no-labs");

function card(over: { noLabs: boolean | null; collecting?: boolean; onAsk?: () => void }) {
  return (
    <BriefingCardBody
      snap={null}
      ready
      configured
      hasSources
      noLabs={over.noLabs}
      collecting={over.collecting ?? true}
      notices={[]}
      onAsk={over.onAsk ?? (() => {})}
      onStop={() => {}}
      onOpen={() => {}}
      onOpenSettings={() => {}}
      onStartSubscribing={() => {}}
    />
  );
}

async function paint(node: React.ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(node);
  });
  return result;
}

test("no open room: the card says nothing is being collected and what to do", async () => {
  const { container } = await paint(card({ noLabs: true }));

  expect(container.textContent ?? "").toContain(NO_LAB_NOTICE);
  // Not the sentence it replaces: a briefing is not on its way.
  expect(container.textContent ?? "").not.toContain("Today's is on its way");
});

test("the notice leads to the conversation, which is the only way to open a room", async () => {
  let asked = 0;
  const { container } = await paint(card({ noLabs: true, onAsk: () => (asked += 1) }));

  const button = container.querySelector("button");
  expect(button?.textContent).toBe("Tell the companion");
  await act(async () => {
    button?.click();
  });
  expect(asked).toBe(1);
});

test("a reader is told too: the labs file is the bureau's, not this machine's", async () => {
  const { container } = await paint(card({ noLabs: true, collecting: false }));

  expect(container.textContent ?? "").toContain(NO_LAB_NOTICE);
  expect(container.textContent ?? "").not.toContain("built on the computer that collects");
});

test("before the labs file answers the card holds its placeholder", async () => {
  const { container } = await paint(card({ noLabs: null }));

  expect(container.querySelectorAll("[data-placeholder='card-body']").length).toBe(1);
  expect(container.textContent ?? "").not.toContain(NO_LAB_NOTICE);
});

test("with a room open the card is back to waiting for today's briefing", async () => {
  const { container } = await paint(card({ noLabs: false }));

  expect(container.textContent ?? "").toContain("Today's is on its way");
  expect(container.textContent ?? "").not.toContain(NO_LAB_NOTICE);
});
