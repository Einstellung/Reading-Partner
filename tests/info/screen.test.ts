// The screening stage (src/info/collect/screen.ts): the rooms it screens
// against, the prompt it sends, the replies it accepts, and the two pure rules
// the funnel's cost guarantee rests on — batching every item exactly once, and a
// cap that cuts by confidence and reports what it cut. No network, no model.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  fillMissingVerdicts,
  keepVerdict,
  parseScreenVerdicts,
  screenBatches,
  screenSystemPrompt,
  screenTargets,
  screenUserMessage,
  selectKept,
  targetsForItem,
  type ScreenTarget,
  type ScreenVerdict,
  SCREEN_BATCH_SIZE,
  SCREEN_SUMMARY_CHARS,
} from "../../src/info/collect/screen";
import { emptyPicture } from "../../src/info/picture/picture";
import type { Observable, Picture } from "../../src/info/picture/types";
import type { Lab } from "../../src/info/labs/types";
import type { InfoItem } from "../../src/info/sources/item";

function item(id: string, over: Partial<InfoItem> = {}): InfoItem {
  return {
    id,
    source: "s",
    sourceName: "The Source",
    title: `Title ${id}`,
    url: `https://x/${id}`,
    publishedAt: "2026-08-10",
    ...over,
  };
}

function lab(id: string, over: Partial<Lab> = {}): Lab {
  return {
    id,
    name: `Room ${id}`,
    kind: "lab",
    status: "active",
    charter: { scope: `everything about ${id}`, questions: [], topicId: null },
    sources: [],
    createdAt: 1,
    ...over,
  };
}

function observable(id: string, text: string, over: Partial<Observable> = {}): Observable {
  return { id, text, addedOn: "2026-08-01", ...over };
}

function picture(labId: string, observables: Observable[]): Picture {
  return { ...emptyPicture(labId), observables };
}

function target(labId: string, over: Partial<ScreenTarget> = {}): ScreenTarget {
  return { labId, name: `Room ${labId}`, scope: `scope of ${labId}`, observables: [], sources: [], ...over };
}

// --- targets ----------------------------------------------------------------

test("targets are the open rooms, carrying the observables their picture still watches", () => {
  const labs = [
    lab("lab-a", { sources: ["s1"] }),
    lab("lab-b"),
    lab("lab-gone", { status: "archived" }),
  ];
  const pictures = new Map([
    [
      "lab-a",
      picture("lab-a", [
        observable("o-aaa111", "mass production announcements"),
        observable("o-aaa222", "an old thing", { retiredOn: "2026-08-05" }),
      ]),
    ],
  ]);
  const targets = screenTargets(labs, pictures);
  expect(targets.map((t) => t.labId)).toEqual(["lab-a", "lab-b"]);
  expect(targets[0].observables).toEqual([
    { id: "o-aaa111", text: "mass production announcements" },
  ]);
  expect(targets[0].sources).toEqual(["s1"]);
  // A room with no picture yet screens at scope level.
  expect(targets[1].observables).toEqual([]);
});

test("a lookup function works the same as a map", () => {
  const targets = screenTargets([lab("lab-a")], (id) =>
    id === "lab-a" ? picture("lab-a", [observable("o-1", "x")]) : undefined,
  );
  expect(targets[0].observables).toEqual([{ id: "o-1", text: "x" }]);
});

test("a claimed source is screened for its claimants alone; an unclaimed one for everybody", () => {
  const targets = [target("lab-a", { sources: ["mine"] }), target("lab-b")];
  expect(targetsForItem(targets, item("1", { source: "mine" })).map((t) => t.labId)).toEqual([
    "lab-a",
  ]);
  expect(targetsForItem(targets, item("2", { source: "nobodys" })).map((t) => t.labId)).toEqual([
    "lab-a",
    "lab-b",
  ]);
});

// --- the prompt -------------------------------------------------------------

test("the prompt asks which observables were hit and forbids a quota", () => {
  const p = screenSystemPrompt();
  expect(p).toContain("which rooms' observables does it hit");
  expect(p).toContain("NO quota");
  expect(p).toContain("Judge every item on its own merits, absolutely");
  expect(p).toContain("Never invent a hit");
  // It is not the analyst: no tiers, no summaries, no merging.
  expect(p).toContain("NOT ranking");
  expect(p).toContain("confidence");
  expect(p).not.toContain("mustRead");
  // The profile left screening with the rooms' arrival.
  expect(p).not.toContain("READER PROFILE");
});

test("the empty observable list is allowed only for a room that has none", () => {
  const p = screenSystemPrompt();
  expect(p).toContain("only when the room lists no observables at");
  expect(p).toContain("that room is not hit");
});

test("the language directive follows the app setting, and there is only one of it", () => {
  expect(screenSystemPrompt()).toContain("in English (the UI language)");
  const zh = screenSystemPrompt("zh-CN");
  expect(zh).toContain("Write the `outside` reason in 简体中文");
  expect(zh).not.toContain("in English (the UI language)");
});

test("the user message prints every room's scope and every observable id verbatim", () => {
  const msg = screenUserMessage(
    [
      target("lab-a", {
        name: "Robotics",
        scope: "Chinese humanoid manufacturing",
        observables: [
          { id: "o-aaa111", text: "mass production announcements" },
          { id: "o-aaa222", text: "supplier moves" },
        ],
      }),
      target("lab-b", { scope: "power grids" }),
    ],
    [item("1")],
  );
  expect(msg).toContain("lab: lab-a | Robotics");
  expect(msg).toContain("scope: Chinese humanoid manufacturing");
  expect(msg).toContain("1. o-aaa111 — mass production announcements");
  expect(msg).toContain("2. o-aaa222 — supplier moves");
  expect(msg).toContain("scope: power grids");
  // A room with nothing to watch yet says so rather than showing an empty list.
  expect(msg).toContain("observables: (none yet");
});

test("the user message carries headline, source, date and blurb — never a body", () => {
  const msg = screenUserMessage(
    [target("lab-a")],
    [item("1", { summary: "A short blurb.", textContent: "THE WHOLE ARTICLE" })],
  );
  expect(msg).toContain("id: 1 | The Source | 2026-08-10");
  expect(msg).toContain("title: Title 1");
  expect(msg).toContain("blurb: A short blurb.");
  // Fetching the body is the decision being made, so the body is never input.
  expect(msg).not.toContain("THE WHOLE ARTICLE");
});

test("a long blurb is trimmed, and a missing one is stated rather than faked", () => {
  const msg = screenUserMessage(
    [target("lab-a")],
    [item("1", { summary: "x".repeat(SCREEN_SUMMARY_CHARS + 500) }), item("2")],
  );
  expect(msg).toContain("blurb: (none)");
  expect(msg).not.toContain("x".repeat(SCREEN_SUMMARY_CHARS + 1));
});

// --- parsing ----------------------------------------------------------------

const TARGETS: ScreenTarget[] = [
  target("lab-a", {
    observables: [
      { id: "o-a1", text: "one" },
      { id: "o-a2", text: "two" },
    ],
  }),
  target("lab-b"),
];

function reply(verdicts: unknown[]): string {
  return JSON.stringify({ verdicts });
}

test("hits parse, tolerating a markdown fence, and confidence clamps to 0-1", () => {
  const raw =
    "```json\n" +
    reply([
      { id: "a", hits: [{ labId: "lab-a", observables: ["o-a1", "o-a2"] }], confidence: 0.8 },
      { id: "b", hits: [{ labId: "lab-b", observables: [] }], confidence: 3 },
      { id: "c", hits: [], confidence: -1 },
    ]) +
    "\n```";
  const out = parseScreenVerdicts(raw, TARGETS, new Set(["a", "b", "c"]));
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts[0].hits).toEqual([{ labId: "lab-a", observables: ["o-a1", "o-a2"] }]);
  // A room with no observables is hit at scope level.
  expect(out.verdicts[1].hits).toEqual([{ labId: "lab-b", observables: [] }]);
  expect(out.verdicts.map((v) => v.confidence)).toEqual([0.8, 1, 0]);
  expect(out.verdicts.map(keepVerdict)).toEqual([true, true, false]);
});

test("an unknown observable id is dropped and the rest of the hit stands", () => {
  const out = parseScreenVerdicts(
    reply([{ id: "a", hits: [{ labId: "lab-a", observables: ["o-a1", "o-invented"] }], confidence: 1 }]),
    TARGETS,
    new Set(["a"]),
  );
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts[0].hits).toEqual([{ labId: "lab-a", observables: ["o-a1"] }]);
});

test("a hit whose observable ids were all invented is dropped when the room has observables", () => {
  const out = parseScreenVerdicts(
    reply([
      { id: "a", hits: [{ labId: "lab-a", observables: ["o-nope"] }], confidence: 1 },
      { id: "b", hits: [{ labId: "lab-a", observables: [] }], confidence: 1 },
    ]),
    TARGETS,
    new Set(["a", "b"]),
  );
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  // Neither survives: lab-a lists observables, so a hit on it has to name one.
  expect(out.verdicts.map((v) => v.hits)).toEqual([[], []]);
});

test("an unknown lab id is dropped, and a repeated one does not double the hit", () => {
  const out = parseScreenVerdicts(
    reply([
      {
        id: "a",
        hits: [
          { labId: "lab-invented", observables: [] },
          { labId: "lab-b", observables: [] },
          { labId: "lab-b", observables: [] },
        ],
        confidence: 0.5,
      },
    ]),
    TARGETS,
    new Set(["a"]),
  );
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts[0].hits).toEqual([{ labId: "lab-b", observables: [] }]);
});

test("an outside flag survives with its reason; a blank one does not", () => {
  const out = parseScreenVerdicts(
    reply([
      { id: "a", hits: [], outside: "  a court just struck the whole thing down  ", confidence: 0.9 },
      { id: "b", hits: [], outside: "   ", confidence: 0.1 },
    ]),
    TARGETS,
    new Set(["a", "b"]),
  );
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts[0].outside).toBe("a court just struck the whole thing down");
  expect(keepVerdict(out.verdicts[0])).toBe(true);
  expect(out.verdicts[1].outside).toBeUndefined();
});

test("verdicts for ids that were not asked about are dropped, duplicates ignored", () => {
  const out = parseScreenVerdicts(
    reply([
      { id: "a", hits: [{ labId: "lab-b", observables: [] }], confidence: 0.5 },
      { id: "a", hits: [], confidence: 0.5 },
      { id: "invented", hits: [{ labId: "lab-b", observables: [] }], confidence: 1 },
    ]),
    TARGETS,
    new Set(["a", "b"]),
  );
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts).toEqual([
    { id: "a", hits: [{ labId: "lab-b", observables: [] }], confidence: 0.5 },
  ]);
});

test("a batch where nothing hit anything is an ordinary reply, not a failure", () => {
  const out = parseScreenVerdicts(reply([]), TARGETS, new Set(["a"]));
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts).toEqual([]);
});

test("an unusable reply fails so the caller can retry instead of dropping the batch", () => {
  expect(parseScreenVerdicts("no json here", TARGETS, new Set(["a"])).ok).toBe(false);
  expect(parseScreenVerdicts("{ not json", TARGETS, new Set(["a"])).ok).toBe(false);
  expect(parseScreenVerdicts(JSON.stringify({ items: [] }), TARGETS, new Set(["a"])).ok).toBe(false);
  // It answered, but about ids nobody asked for: nothing usable came back.
  expect(
    parseScreenVerdicts(
      reply([{ id: "z", hits: [{ labId: "lab-b", observables: [] }], confidence: 1 }]),
      TARGETS,
      new Set(["a"]),
    ).ok,
  ).toBe(false);
});

test("ids the reply never mentioned come back as hitting nothing", () => {
  const filled = fillMissingVerdicts(
    ["a", "b", "c"],
    [{ id: "b", hits: [{ labId: "lab-a", observables: ["o-a1"] }], confidence: 0.7 }],
  );
  expect(filled.map((v) => [v.id, keepVerdict(v)])).toEqual([
    ["a", false],
    ["b", true],
    ["c", false],
  ]);
});

// --- batching and the cap ---------------------------------------------------

test("batching covers every item exactly once, in order", () => {
  const items = Array.from({ length: 125 }, (_, i) => `i${i}`);
  const batches = screenBatches(items);
  expect(batches.map((b) => b.length)).toEqual([50, 50, 25]);
  expect(batches.flat()).toEqual(items);
  expect(SCREEN_BATCH_SIZE).toBe(50);
  // A degenerate size does not lose items.
  expect(screenBatches(items, 0).flat()).toEqual(items);
  expect(screenBatches([]).length).toBe(0);
});

function verdict(id: string, hit: boolean, confidence = 0.5, outside?: string): ScreenVerdict {
  return {
    id,
    hits: hit ? [{ labId: "lab-a", observables: ["o-a1"] }] : [],
    ...(outside ? { outside } : {}),
    confidence,
  };
}

test("under the cap every item that hit something goes on, and the misses do not", () => {
  const out = selectKept([verdict("a", true), verdict("b", false), verdict("c", true)], 120);
  expect(out).toEqual({ ids: ["a", "c"], cappedOut: 0 });
});

test("over the cap the least confident go, ties break on discovery order, and the count is reported", () => {
  const out = selectKept(
    [verdict("a", true, 0.3), verdict("b", true, 0.9), verdict("c", true, 0.3), verdict("d", true, 0)],
    3,
  );
  // b is surest; a and c tie at 0.3 and a came first; d is cut.
  expect(out).toEqual({ ids: ["a", "b", "c"], cappedOut: 1 });
  // The survivors keep discovery order, not confidence order.
  expect(out.ids).toEqual(["a", "b", "c"]);
});

test("the out-of-lane item is never cut by the cap", () => {
  const out = selectKept(
    [verdict("a", true, 0.9), verdict("b", false, 0, "nothing covers this"), verdict("c", true, 0.8)],
    1,
  );
  expect(out).toEqual({ ids: ["b"], cappedOut: 2 });
});

test("only the first outside flag of the day survives", () => {
  const out = selectKept(
    [
      verdict("first", false, 0.2, "the striking one"),
      verdict("second", false, 0.9, "also striking"),
      verdict("third", true, 0.1),
    ],
    120,
  );
  expect(out.ids).toEqual(["first", "third"]);
});

test("a later outside flag still goes on when it hit a room anyway", () => {
  const out = selectKept(
    [verdict("first", false, 0.2, "the striking one"), verdict("second", true, 0.9, "also")],
    120,
  );
  expect(out.ids).toEqual(["first", "second"]);
});
