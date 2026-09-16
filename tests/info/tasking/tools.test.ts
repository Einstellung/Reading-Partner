// What a tasking run can look in (src/info/tasking/tools.ts, docs/63): the
// cables this device filed, the body behind one of them, and a room's picture.
// Every store is injected, so this runs over records held in memory.
// Run: scripts/t.sh tests/info/tasking/tools.test.ts

import { expect, test } from "bun:test";
import { buildTaskingTools } from "../../../src/info/tasking/tools";
import type { CableDay } from "../../../src/info/cable/types";
import type { PublishedBodies } from "../../../src/info/boxes/publish";
import type { AgentTool } from "../../../src/legion/execute/turn";

const DAYS: Record<string, CableDay> = {
  "2026-09-16": {
    version: 1,
    date: "2026-09-16",
    cables: [
      {
        id: "c-1",
        date: "2026-09-16",
        title: "The ministry raised the tariff to 12%",
        url: "https://x.test/1",
        source: "mofcom",
        sourceName: "商务部",
        publishedAt: "2026-09-15",
        hits: [{ labId: "lab-trade", observables: ["o-a1b2c3"] }],
        summary: "A tariff line moved for the first time since March.",
      },
    ],
  },
  "2026-09-02": {
    version: 1,
    date: "2026-09-02",
    cables: [
      {
        id: "c-2",
        date: "2026-09-02",
        title: "A model release nobody expected",
        url: "https://x.test/2",
        source: "qbitai",
        sourceName: "量子位",
        publishedAt: "2026-09-02",
        hits: [],
      },
    ],
  },
};

const BODIES: PublishedBodies = {
  date: "2026-09-16",
  generatedAt: 1,
  bodies: {
    "c-1": { text: "The rate goes from 8% to 12% on 1 October.", html: "", summaryOnly: false },
  },
};

function tools(over: Parameters<typeof buildTaskingTools>[0] = {}): Map<string, AgentTool> {
  const built = buildTaskingTools({
    cableDates: async () => Object.keys(DAYS).sort((a, b) => b.localeCompare(a)),
    cableDay: async (date) => DAYS[date] ?? null,
    article: async () => null,
    bodies: async () => BODIES,
    labs: async () => [],
    picture: async () => {
      throw new Error("no picture in this test");
    },
    fetchFn: async () => new Response(""),
    ...over,
  });
  return new Map(built.map((t) => [t.name, t]));
}

test("a cable is found by the words in its title, and comes back with what identifies it", async () => {
  const out = String(await tools().get("search_cables")!.execute({ query: "tariff ministry" }));
  expect(out).toContain("[c-1]");
  expect(out).toContain("The ministry raised the tariff to 12%");
  expect(out).toContain("商务部");
  expect(out).toContain("2026-09-16");
  // The other day's cable matches neither word.
  expect(out).not.toContain("c-2");
});

test("a room's cables can be asked for on their own, and a miss says so rather than guessing", async () => {
  const set = tools();
  expect(String(await set.get("search_cables")!.execute({ lab: "lab-trade" }))).toContain("[c-1]");
  const none = String(await set.get("search_cables")!.execute({ query: "semiconductor export ban" }));
  expect(none).toContain("Nothing in");
  expect(none).not.toContain("[c-");
});

test("the body behind a cable is read off the published bodies where the day's cache is gone", async () => {
  const out = String(await tools().get("read_cable")!.execute({ id: "c-1" }));
  expect(out).toContain("The ministry raised the tariff to 12%");
  expect(out).toContain("https://x.test/1");
  expect(out).toContain("The rate goes from 8% to 12% on 1 October.");
});

test("the collecting device's own article cache answers first", async () => {
  const out = String(
    await tools({
      article: async (date, id) =>
        date === "2026-09-16" && id === "c-1" ? { textContent: "the cached full text" } : null,
    })
      .get("read_cable")!
      .execute({ id: "c-1" }),
  );
  expect(out).toContain("the cached full text");
});

test("a cable with no body anywhere says the body is not here instead of describing it", async () => {
  const out = String(await tools().get("read_cable")!.execute({ id: "c-2" }));
  expect(out).toContain("A model release nobody expected");
  expect(out).toContain("not on this device");
});

test("an id nothing on this device has is refused, not invented", async () => {
  expect(String(await tools().get("read_cable")!.execute({ id: "c-9" }))).toContain("No cable");
});
