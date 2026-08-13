// The reading end of the briefing (src/info/briefing/reader.ts, docs/36): which
// of the four answers an article gets, and what a reader is told about the
// machine that does the collecting. Run: bun test.

import { expect, test } from "bun:test";
// articleState sanitizes the body it hands over, and the sanitizer parses with
// a DOMParser that bun does not have.
import "../dom";
import {
  articleState,
  collectorNotices,
  sinceLabel,
} from "../../src/info/briefing/reader";
import type { PublishedBodies } from "../../src/info/briefing/publish";
import type { CollectorClaim } from "../../src/info/briefing/handoff";
import type { Briefing } from "../../src/info/briefing/types";

const NOW = 1_800_000_000_000;

function meta(id: string) {
  return {
    title: `title ${id}`,
    url: `https://example.test/${id}`,
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-08-12T00:00:00Z",
  };
}

const briefing: Briefing = {
  date: "2026-08-12",
  generatedAt: 1_000,
  overview: "a day",
  mustRead: [{ itemId: "a", reason: "because" }],
  oneLiners: [{ itemId: "b", line: "the point" }],
  outOfLane: [],
  filtered: [{ itemId: "d", category: "vendor PR" }],
  items: { a: meta("a"), b: meta("b"), d: meta("d") },
};

function bodies(over: Partial<PublishedBodies> = {}): PublishedBodies {
  return {
    date: "2026-08-12",
    generatedAt: 1_000,
    bodies: {
      a: { text: "the text", html: "<p>the text</p>", summaryOnly: false },
      b: { text: "", html: "", summaryOnly: true },
    },
    ...over,
  };
}

test("a tiered item with a body renders it", () => {
  const state = articleState(briefing, bodies(), "a");
  expect(state.kind).toBe("body");
  if (state.kind !== "body") return;
  expect(state.body.text).toBe("the text");
  expect(state.body.html).toBe("<p>the text</p>");
  expect(state.body.summaryOnly).toBe(false);
});

// The HTML arrived over a sync folder and is rendered with
// dangerouslySetInnerHTML, so it goes through the sanitizer on the way out.
test("what came over the wire is sanitized before it is handed over", () => {
  const hostile = bodies({
    bodies: {
      a: { text: "t", html: '<p onclick="steal()">hi</p><script>x</script>', summaryOnly: false },
    },
  });
  const state = articleState(briefing, hostile, "a");
  if (state.kind !== "body") throw new Error("expected a body");
  expect(state.body.html).not.toContain("script");
  expect(state.body.html).not.toContain("onclick");
});

// The two files reconcile independently, so a reader can hold today's briefing
// beside yesterday's bodies. Rather than render the wrong article under the
// right headline it says the text is on its way.
test("a briefing newer than its bodies is a wait, not a wrong article", () => {
  expect(articleState(briefing, bodies({ generatedAt: 999 }), "a").kind).toBe("pending");
  expect(articleState(briefing, null, "a").kind).toBe("pending");
});

// A dropped item never had a body, so no fingerprint can make one appear and
// telling the reader to wait would be a wait with no end.
test("an item triage dropped says what it was dropped for, whatever the bodies say", () => {
  expect(articleState(briefing, bodies(), "d")).toEqual({ kind: "filtered", category: "vendor PR" });
  expect(articleState(briefing, null, "d")).toEqual({ kind: "filtered", category: "vendor PR" });
});

test("a source that only publishes summaries says so", () => {
  expect(articleState(briefing, bodies(), "b").kind).toBe("summaryOnly");
});

test("an item this briefing never carried is unknown", () => {
  expect(articleState(briefing, bodies(), "zzz").kind).toBe("unknown");
  expect(articleState(null, bodies(), "a").kind).toBe("unknown");
});

// --- what the reader is told -------------------------------------------------

function claim(over: Partial<CollectorClaim> = {}): CollectorClaim {
  return {
    deviceId: "desk",
    deviceName: "kestrel",
    platform: "linux",
    hasWebviewFetch: true,
    claimedAt: NOW - 60_000,
    heartbeatAt: NOW,
    lastRunAt: NOW - 60_000,
    lastBriefingDate: "2026-08-12",
    halt: null,
    sources: {},
    sites: {},
    lastAskAt: null,
    ...over,
  };
}

test("a healthy collector needs no explaining", () => {
  expect(collectorNotices({ collector: claim(), online: true }, NOW)).toEqual([]);
});

test("with no collector at all the reader is told to set one up", () => {
  const lines = collectorNotices({ collector: null, online: false }, NOW);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("desktop");
});

// The point of the whole file: nobody is looking at the collector's screen, so
// what it would have said there has to come out on the phone.
test("a collector that stopped checking in says when it last did", () => {
  const lines = collectorNotices(
    { collector: claim({ heartbeatAt: NOW - 5 * 60 * 60_000 }), online: false },
    NOW,
  );
  expect(lines[0]).toBe("kestrel last checked in 5 hours ago.");
});

test("a run that stopped short says why, and a signed-out site says which", () => {
  const lines = collectorNotices(
    {
      collector: claim({
        halt: "no AI provider configured",
        sites: { "www.bloomberg.com": false, "www.ft.com": true },
      }),
      online: true,
    },
    NOW,
  );
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("no AI provider configured");
  expect(lines[1]).toContain("www.bloomberg.com");
  expect(lines[1]).not.toContain("www.ft.com");
});

test("how long ago reads as a shape, not a duration", () => {
  expect(sinceLabel(30_000)).toBe("just now");
  expect(sinceLabel(20 * 60_000)).toBe("20 minutes ago");
  expect(sinceLabel(60 * 60_000)).toBe("1 hour ago");
  expect(sinceLabel(5 * 60 * 60_000)).toBe("5 hours ago");
  expect(sinceLabel(50 * 60 * 60_000)).toBe("2 days ago");
});
