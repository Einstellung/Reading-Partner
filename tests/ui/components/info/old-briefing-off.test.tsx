// The old daily briefing's UI switched off (src/info/old-briefing.ts): its chat
// cards draw nothing, and the phone home leads with the briefs instead of the
// briefing card. Both checked with the switch forced each way, so the shape it
// comes back to stays covered. Run: scripts/t.sh tests/ui/components/info/old-briefing-off.test.tsx

import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../../support/dom";

const { act, cleanup, render } = await useDom();
afterEach(cleanup);

// Imported after the window is up, for the reason launch-placeholder.test.tsx
// gives: react-dom decides once, at evaluation, whether it is in a browser.
const cards = await import("../../../../src/ui/components/info/InfoCards");
const { default: PhoneHome } = await import("../../../../src/ui/components/phone/PhoneHome");

const OLD_KINDS = [
  "probe-confirm",
  "briefing-progress",
  "briefing-ready",
  "briefing-failed",
  "lab-proposal",
  "lab-archive",
] as const;

test("with the old briefing's UI off its cards draw nothing and the rest are untouched", () => {
  const off = cards.infoCardRegistry(false);
  const on = cards.infoCardRegistry(true);
  for (const kind of OLD_KINDS) {
    expect(off[kind]).not.toBe(on[kind]);
    expect((off[kind] as () => null)()).toBeNull();
  }
  expect(on["briefing-ready"]).toBe(cards.BriefingReadyCard);
  expect(on["probe-confirm"]).toBe(cards.ProbeConfirmCard);
  // The door files with the topic card too, and meals are not the briefing's.
  for (const kind of ["topic-proposal", "meals-draft", "meals-applied"] as const) {
    expect(off[kind]).toBe(on[kind]);
  }
  expect(cards.INFO_CARD_REGISTRY["lab-proposal"]).toBe(off["lab-proposal"]);
});

const LAUNCH = {
  snap: null,
  ready: true,
  configured: true,
  hasSources: true,
  noLabs: false,
  collecting: true,
  notices: [],
  onAsk: () => {},
  onStop: () => {},
  onOpenBriefing: () => {},
  onOpenSettings: () => {},
  onStartSubscribing: () => {},
};

async function home(over: { oldBriefing?: boolean; savedCount: number | null }) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <PhoneHome
        launch={LAUNCH}
        savedCount={over.savedCount}
        onOpenSaved={() => {}}
        onOpenBriefs={() => {}}
        continueBook={null}
        onContinue={() => {}}
        onOpenLibrary={() => {}}
        settingsAlert={false}
        meals={true}
        onOpenMeals={() => {}}
        companionShown={true}
        onToggleCompanion={() => {}}
        oldBriefing={over.oldBriefing}
      />,
    );
  });
  return result.container.textContent ?? "";
}

test("off, the phone home leads with the briefs and shows Saved only when something is kept", async () => {
  const empty = await home({ savedCount: 0 });
  expect(empty).not.toContain("Today's briefing");
  expect(empty).not.toContain("Saved");
  expect(empty.indexOf("Briefs")).toBeGreaterThan(-1);
  expect(empty.indexOf("Briefs")).toBeLessThan(empty.indexOf("Meals"));
  cleanup();

  const kept = await home({ savedCount: 2 });
  expect(kept).toContain("Saved");
});

test("on, the briefing card is back on top and Saved is always there", async () => {
  const text = await home({ savedCount: 0, oldBriefing: true });
  expect(text).toContain("Today's briefing");
  expect(text).toContain("Saved");
  expect(text.indexOf("Today's briefing")).toBeLessThan(text.indexOf("Briefs"));
});
