// The index provider registry and the engine's `index` dispatch (docs/69):
// a descriptor naming an unregistered provider fails as a source, a rejected
// query fails as a source, and a provider's items are stamped with the
// descriptor's identity. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { collectAll, collectSource } from "../../../src/info/sources/engine";
import {
  daysBefore,
  indexOf,
  indexProvider,
  indexProviderIds,
  queryInt,
  queryString,
  queryStrings,
  registerIndexProvider,
  resetIndexProvidersForTests,
  type IndexProvider,
} from "../../../src/info/sources/index-provider";
import type { SourceDescriptor } from "../../../src/info/sources/descriptor";
import { formatSignals } from "../../../src/info/sources/item";

afterEach(() => resetIndexProvidersForTests());

const fake: IndexProvider = {
  id: "fake",
  name: "Fake Library",
  hosts: ["fake.example"],
  defaultLimit: 7,
  validateQuery: (q) => (typeof q.topic === "string" ? null : "needs a topic"),
  describeQuery: (q) => `topic ${String(q.topic)}`,
  discover: async (desc, q, deps) => [
    {
      id: "x-1",
      source: "wrong",
      sourceName: "wrong",
      title: `${String(q.topic)} paper`,
      url: "https://fake.example/1",
      publishedAt: deps.today(),
      summaryOnly: true,
      signals: { stars: deps.limit, tags: ["t"] },
    },
  ],
};

function indexDesc(query: Record<string, unknown>, provider = "fake"): SourceDescriptor {
  return {
    id: "src-1",
    name: "Fake topic",
    line: "test",
    enabled: true,
    discovery: { kind: "index", provider, query },
    fulltext: { mode: "none" },
  };
}

// bun runs every test file in one process, so the registry may already hold
// what another file registered at module scope; assert only about "fake".
test("registry: register, look up, list, reset", () => {
  expect(indexProvider("fake")).toBeUndefined();
  registerIndexProvider(fake);
  expect(indexProvider("fake")).toBe(fake);
  expect(indexProviderIds()).toContain("fake");
  expect(indexOf(indexDesc({ topic: "a" }))?.provider.id).toBe("fake");
  expect(indexOf(indexDesc({ topic: "a" }, "nope"))).toBeUndefined();
  resetIndexProvidersForTests();
  expect(indexProvider("fake")).toBeUndefined();
});

test("collectSource: items are stamped with the descriptor's identity and the limit reaches the provider", async () => {
  registerIndexProvider(fake);
  const fixed = Date.UTC(2026, 8, 13, 12);
  const items = await collectSource(indexDesc({ topic: "robots" }), { now: () => fixed });
  expect(items).toHaveLength(1);
  expect(items[0].source).toBe("src-1");
  expect(items[0].sourceName).toBe("Fake topic");
  expect(items[0].title).toBe("robots paper");
  expect(items[0].publishedAt).toBe("2026-09-13");
  // No descriptor limit: the provider's default.
  expect(items[0].signals?.stars).toBe(7);
  const limited = await collectSource({ ...indexDesc({ topic: "r" }), limit: 3 }, { now: () => fixed });
  expect(limited[0].signals?.stars).toBe(3);
});

test("collectSource: an unregistered provider and a rejected query are source failures with a reason", async () => {
  await expect(collectSource(indexDesc({ topic: "a" }, "nope"))).rejects.toThrow(/unknown index provider "nope"/);
  registerIndexProvider(fake);
  await expect(collectSource(indexDesc({}))).rejects.toThrow(/index query rejected.*needs a topic/);
});

test("collectAll: an index source that fails is recorded in health and sinks nothing else", async () => {
  registerIndexProvider(fake);
  const { items, health } = await collectAll([indexDesc({ topic: "a" }), { ...indexDesc({}), id: "src-2" }], {
    now: () => 1000,
  });
  expect(items.map((i) => i.source)).toEqual(["src-1"]);
  expect(health["src-1"].lastItems).toBe(1);
  expect(health["src-2"].lastError).toMatch(/needs a topic/);
});

test("query helpers read loosely typed fields", () => {
  const q = { a: " x ", b: ["p", " q ", 3, ""], c: 4.7, d: -1, e: "" };
  expect(queryString(q, "a")).toBe("x");
  expect(queryString(q, "e")).toBeUndefined();
  expect(queryString(q, "zz")).toBeUndefined();
  expect(queryStrings(q, "b")).toEqual(["p", "q"]);
  expect(queryStrings(q, "a")).toEqual(["x"]);
  expect(queryStrings(q, "zz")).toEqual([]);
  expect(queryInt(q, "c")).toBe(4);
  expect(queryInt(q, "d")).toBeUndefined();
});

test("daysBefore walks the calendar in UTC", () => {
  expect(daysBefore("2026-09-13", 2)).toBe("2026-09-11");
  expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
  expect(daysBefore("2026-01-01", 1)).toBe("2025-12-31");
  expect(daysBefore("2026-09-13", 0)).toBe("2026-09-13");
});

test("formatSignals says only what it has", () => {
  expect(formatSignals(undefined)).toBe("");
  expect(formatSignals({})).toBe("");
  expect(formatSignals({ stars: 1240, starsPeriod: 310 })).toBe("★ 1240 (+310)");
  expect(formatSignals({ starsPeriod: 12 })).toBe("★ +12");
  expect(formatSignals({ upvotes: 87, citations: 12, influentialCitations: 3, tags: ["code", "weights"] })).toBe(
    "↑ 87 · cites 12 (3 influential) · code, weights",
  );
});
