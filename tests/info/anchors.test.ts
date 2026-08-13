// What one info conversation is anchored to (src/info/companion/anchors.ts):
// which thread it writes to, what the corner position card recalls, and — the
// part with a rule in it — which of the briefing's tiers the article card's one
// line comes from. Pure: no React, no filesystem, no provider. Run: bun test.

import { expect, test } from "bun:test";
import {
  articleAnchor,
  articleReason,
  briefingAnchor,
  noBriefingAnchor,
  onboardingAnchor,
} from "../../src/info/companion/anchors";
import type { CompanionContext } from "../../src/info/companion/chat";
import type { Briefing, BriefingItemMeta } from "../../src/info/briefing/types";

const CTX: CompanionContext = { profile: "Reads robotics.", sources: [], collecting: true };

function meta(patch: Partial<BriefingItemMeta> = {}): BriefingItemMeta {
  return {
    title: "A paper",
    url: "https://example.com/a",
    source: "s1",
    sourceName: "Example",
    publishedAt: "2026-07-25",
    ...patch,
  };
}

// One item id in every tier, so the tiers can be removed one at a time and the
// next reason down has to be the one that shows.
function briefing(patch: Partial<Briefing> = {}): Briefing {
  return {
    date: "2026-07-25",
    generatedAt: 1_700_000_000_000,
    overview: "Two real papers, the rest is vendor noise.",
    mustRead: [{ itemId: "x", reason: "must-read reason" }],
    oneLiners: [{ itemId: "x", line: "one-liner line" }],
    outOfLane: [{ itemId: "x", reason: "out-of-lane reason" }],
    filtered: [{ itemId: "y", category: "vendor PR" }],
    items: { x: meta({ title: "The paper", sourceName: "Example" }), y: meta({ title: "Dropped" }) },
    ...patch,
  };
}

test("the briefing and the no-briefing anchor are the same conversation", () => {
  const withOne = briefingAnchor(briefing(), CTX);
  const without = noBriefingAnchor(CTX, { error: null, notices: [] });
  expect(withOne.threadId).toBe("briefing");
  expect(without.threadId).toBe(withOne.threadId);
  expect(withOne.position.line).toBe("Two real papers, the rest is vendor noise.");
});

test("with no briefing the card says what is known, error first, then the notice", () => {
  expect(noBriefingAnchor(CTX, { error: "no provider", notices: ["Last seen 2h ago"] }).position.line).toBe(
    "no provider",
  );
  expect(noBriefingAnchor(CTX, { error: null, notices: ["Last seen 2h ago"] }).position.line).toBe(
    "Last seen 2h ago",
  );
  expect(noBriefingAnchor(CTX, { error: null, notices: [] }).position.line).toBe("Not collected yet");
});

// The order is the order the tiers are read in. An item can sit in more than one
// (a must-read also gets a line in some briefings), and the reason written for
// the tier the reader will actually see it in is the one worth recalling.
test("the article card's line is the must-read reason, then the one-liner, then out-of-lane", () => {
  const b = briefing();
  expect(articleReason(b, "x")).toBe("must-read reason");
  expect(articleReason({ ...b, mustRead: [] }, "x")).toBe("one-liner line");
  expect(articleReason({ ...b, mustRead: [], oneLiners: [] }, "x")).toBe("out-of-lane reason");
});

// A filtered item, or one from another day, is in no tier. The card shows no
// line rather than borrowing the briefing's overview.
test("an item in no tier has no line", () => {
  expect(articleReason(briefing(), "y")).toBe(null);
  expect(articleReason(briefing(), "nothing-like-this")).toBe(null);
});

test("an article's thread is the item's, and its card carries the item's own words", () => {
  const anchor = articleAnchor(briefing(), "x", "the full body text", CTX);
  expect(anchor.threadId).toBe("x");
  expect(anchor.emptyTitle).toBe("The paper");
  expect(anchor.position).toEqual({
    title: "The paper",
    sourceName: "Example",
    line: "must-read reason",
  });
  expect(anchor.systemPrompt).toContain("the full body text");
});

test("onboarding opens its own thread in add-source mode", () => {
  const anchor = onboardingAnchor("zh-CN");
  expect(anchor.threadId).toBe("onboarding");
  expect(anchor.mode).toBe("add-source");
  expect(anchor.onboarding).toBe(true);
  // The onboarding half of the add-source prompt, not the bare tool guide.
  expect(anchor.systemPrompt).toContain("first run");
});
