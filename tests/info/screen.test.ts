// The screening stage (src/info/briefing/screen.ts): the prompt it sends, the
// replies it accepts, and the two pure rules the funnel's cost guarantee rests
// on — batching every item exactly once, and a cap that cuts by confidence and
// reports what it cut. No network, no model. Run: bun test.

import { expect, test } from "bun:test";
import {
  capKept,
  fillMissingVerdicts,
  parseScreenVerdicts,
  screenBatches,
  screenSystemPrompt,
  screenUserMessage,
  SCREEN_BATCH_SIZE,
  SCREEN_SUMMARY_CHARS,
} from "../../src/info/briefing/screen";
import { GUESS_BEGIN, GUESS_END } from "../../src/observation/guess";
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

test("the prompt asks one question and forbids a quota", () => {
  const p = screenSystemPrompt();
  expect(p).toContain("worth fetching the full text");
  expect(p).toContain("NO quota");
  // The judgement is absolute: nothing about picking the best N of a batch.
  expect(p).toContain("Judge every item on its own merits, absolutely");
  expect(p).toContain("Never balance across sources");
  // It is not triage: no tiers, no summaries, no merging.
  expect(p).toContain("NOT ranking");
  expect(p).toContain("confidence");
  expect(p).not.toContain("mustRead");
});

test("the language directive follows the app setting, and there is only one of it", () => {
  expect(screenSystemPrompt()).toContain("in English (the UI language)");
  const zh = screenSystemPrompt("zh-CN");
  expect(zh).toContain("Write each `why` in 简体中文");
  expect(zh).not.toContain("in English (the UI language)");
});

test("the user message carries headline, source, date and blurb — never a body", () => {
  const msg = screenUserMessage("I read robotics papers.", [
    item("1", { summary: "A short blurb.", textContent: "THE WHOLE ARTICLE" }),
  ]);
  expect(msg).toContain("I read robotics papers.");
  expect(msg).toContain("id: 1 | The Source | 2026-08-10");
  expect(msg).toContain("title: Title 1");
  expect(msg).toContain("blurb: A short blurb.");
  // Fetching the body is the decision being made, so the body is never input.
  expect(msg).not.toContain("THE WHOLE ARTICLE");
});

test("a long blurb is trimmed, and a missing one is stated rather than faked", () => {
  const msg = screenUserMessage("", [
    item("1", { summary: "x".repeat(SCREEN_SUMMARY_CHARS + 500) }),
    item("2"),
  ]);
  expect(msg).toContain("(no profile set)");
  expect(msg).toContain("blurb: (none)");
  expect(msg).not.toContain("x".repeat(SCREEN_SUMMARY_CHARS + 1));
});

test("the AI's guesses are labelled apart from what the reader declared", () => {
  const profile = [
    "I work on robots.",
    "",
    GUESS_BEGIN,
    "- prefers hardware over theory | basis: marks on ch.3 | since: 2026-07-01",
    GUESS_END,
  ].join("\n");
  const msg = screenUserMessage(profile, [item("1")]);
  expect(msg).toContain("READER PROFILE (what the reader has told us themselves)");
  expect(msg).toContain("AI GUESSES ABOUT THE READER (our own inferences, unconfirmed)");
  expect(msg.indexOf("I work on robots.")).toBeLessThan(msg.indexOf("AI GUESSES"));
});

test("verdicts parse, tolerating a markdown fence and clamping confidence", () => {
  const reply =
    "```json\n" +
    JSON.stringify({
      verdicts: [
        { id: "a", keep: true, why: "new benchmark", confidence: 3 },
        { id: "b", keep: false, why: "vendor PR", confidence: 9 },
        { id: "c", keep: false, why: "recap", confidence: -1 },
      ],
    }) +
    "\n```";
  const out = parseScreenVerdicts(reply, new Set(["a", "b", "c"]));
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts.map((v) => v.keep)).toEqual([true, false, false]);
  expect(out.verdicts.map((v) => v.confidence)).toEqual([3, 3, 0]);
});

test("verdicts for ids that were not asked about are dropped, duplicates ignored", () => {
  const reply = JSON.stringify({
    verdicts: [
      { id: "a", keep: false, why: "", confidence: 2 },
      { id: "a", keep: true, why: "", confidence: 2 },
      { id: "invented", keep: true, why: "", confidence: 3 },
    ],
  });
  const out = parseScreenVerdicts(reply, new Set(["a", "b"]));
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts).toEqual([{ id: "a", keep: false, why: "", confidence: 2 }]);
});

test("a verdict with no keep flag is repaired to a keep, not to a drop", () => {
  const out = parseScreenVerdicts(
    JSON.stringify({ verdicts: [{ id: "a", why: "unsure", confidence: 1 }] }),
    new Set(["a"]),
  );
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.verdicts[0].keep).toBe(true);
});

test("an unusable reply fails so the caller can retry instead of dropping the batch", () => {
  expect(parseScreenVerdicts("no json here", new Set(["a"])).ok).toBe(false);
  expect(parseScreenVerdicts("{ not json", new Set(["a"])).ok).toBe(false);
  expect(parseScreenVerdicts(JSON.stringify({ items: [] }), new Set(["a"])).ok).toBe(false);
  // Every verdict was for an unknown id: nothing usable came back.
  expect(
    parseScreenVerdicts(
      JSON.stringify({ verdicts: [{ id: "z", keep: true, why: "", confidence: 1 }] }),
      new Set(["a"]),
    ).ok,
  ).toBe(false);
});

test("ids the reply never mentioned come back as keeps", () => {
  const filled = fillMissingVerdicts(
    ["a", "b", "c"],
    [{ id: "b", keep: false, why: "PR", confidence: 3 }],
  );
  expect(filled.map((v) => [v.id, v.keep])).toEqual([
    ["a", true],
    ["b", false],
    ["c", true],
  ]);
});

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

test("under the cap nothing is cut", () => {
  const ids = ["a", "b", "c"];
  expect(capKept(ids, new Map(), 120)).toEqual({ ids, cappedOut: 0 });
});

test("over the cap the least confident go, ties break on discovery order, and the count is reported", () => {
  const ids = ["a", "b", "c", "d"];
  const confidence = new Map([
    ["a", 1],
    ["b", 3],
    ["c", 1],
    ["d", 0],
  ]);
  const out = capKept(ids, confidence, 3);
  // b is surest; a and c tie at 1 and a came first; d is cut.
  expect(out).toEqual({ ids: ["a", "b", "c"], cappedOut: 1 });
  // The survivors keep discovery order, not confidence order.
  expect(out.ids).toEqual(["a", "b", "c"]);
});
