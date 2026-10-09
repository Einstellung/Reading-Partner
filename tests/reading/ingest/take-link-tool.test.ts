// take_link (src/reading/ingest/take-link-tool.ts): the links are read off the
// reader's message and numbered here, the model names one by number or says
// "all", and each starts an intake and raises its card without waiting.
// Run: scripts/t.sh tests/reading/ingest/take-link-tool.test.ts

import { expect, test } from "bun:test";
import {
  buildTakeLinkTool,
  extractLinks,
  linkTurnNote,
  takenResult,
  linksToTake,
  type TakeLinkDeps,
} from "../../../src/reading/ingest/take-link-tool";
import type { IntakeCard } from "../../../src/reading/ingest/intake-card";
import type { BoxOrigin } from "../../../src/box";

test("links come out in order, once each, without the punctuation the sentence put after them", () => {
  expect(
    extractLinks("see https://a.test/x, and (https://b.test/y). Also https://a.test/x again!"),
  ).toEqual(["https://a.test/x", "https://b.test/y"]);
});

test("Chinese written against a link is the sentence, not the address", () => {
  expect(extractLinks("看看这个https://x.com/robotbird01/status/2107026689935200274，挺好的")).toEqual([
    "https://x.com/robotbird01/status/2107026689935200274",
  ]);
  expect(extractLinks("「https://a.test/p?q=1」")).toEqual(["https://a.test/p?q=1"]);
});

test("a parenthesis the address opened stays with it", () => {
  expect(extractLinks("https://en.wikipedia.org/wiki/Lisp_(programming_language)")).toEqual([
    "https://en.wikipedia.org/wiki/Lisp_(programming_language)",
  ]);
});

test("a message with no address has no links", () => {
  expect(extractLinks("http:// and www.example.com are not links")).toEqual([]);
});

test("the links numbered are the latest reader message that has any", () => {
  const history = [
    { role: "user", text: "https://old.test/a" },
    { role: "user", text: "https://new.test/b https://new.test/c" },
    { role: "ai", text: "https://ai.test/never" },
    { role: "user", text: "take the second one in" },
  ];
  expect(linksToTake(history)).toEqual(["https://new.test/b", "https://new.test/c"]);
  expect(linksToTake([{ role: "user", text: "nothing" }])).toEqual([]);
});

test("the app note numbers the links and the topics, and is empty without links", () => {
  const note = linkTurnNote(["https://a.test/x", "https://b.test/y"], [{ name: "Brief" }, { name: "pi" }]);
  expect(note).toContain("1. https://a.test/x\n2. https://b.test/y");
  expect(note).toContain("1. Brief\n2. pi");
  expect(note).toContain("take_link");
  expect(linkTurnNote([], [{ name: "Brief" }])).toBe("");
});

test("the app note asks for the reply in the reader's language, naming the app's for a bare link", () => {
  const note = linkTurnNote(["https://a.test/x"], [], "简体中文");
  expect(note).toContain("Reply in the language the reader writes in");
  expect(note).toContain("in 简体中文");
});

const ORIGIN: BoxOrigin = { place: "door", date: "2026-10-09" };

function harness(links: string[], over: Partial<TakeLinkDeps> = {}) {
  const started: { url: string; origin: BoxOrigin }[] = [];
  const cards: IntakeCard[] = [];
  let n = 0;
  const tool = buildTakeLinkTool({
    links: () => links,
    origin: ORIGIN,
    start: async (url, origin) => {
      started.push({ url, origin });
      return { intakeId: `in-${++n}` };
    },
    topics: async () => [{ id: "t-brief" }, { id: "t-pi" }],
    raiseCard: (card) => cards.push(card),
    language: () => "简体中文",
    ...over,
  });
  return { tool, started, cards };
}

test("a number starts that one link at the door and raises its card; the result is short and has a receipt", async () => {
  const h = harness(["https://a.test/x", "https://b.test/y"]);
  const out = await h.tool.execute({ link: "2" });
  expect(h.started).toEqual([{ url: "https://b.test/y", origin: ORIGIN }]);
  expect(h.cards).toEqual([{ kind: "link-intake", intakeId: "in-1" }]);
  expect(typeof out).toBe("object");
  const result = out as { text: string; receipt: { summary: string } };
  expect(result.text).toContain("The card is up");
  expect(result.text).not.toContain("https://");
  expect(result.receipt.summary).toBe("b.test");
  expect(h.tool.effect).toBe("write");
  expect(h.tool.gate).toBe("card");
  // The card stands for the call: no receipt or trace line under the reply.
  expect(h.tool.quiet).toBe(true);
});

test("the result says the fetch has not happened, keeps the reply short and off the topic, and names the language", async () => {
  const h = harness(["https://a.test/x"]);
  const { text } = (await h.tool.execute({ link: "1", topic: 2 })) as { text: string };
  expect(text).toContain("The fetch runs in the background and nothing has been read or filed yet.");
  expect(text).toContain("one short sentence");
  expect(text).toContain("say nothing about what it contains, its length, whether or where it is saved, or which topic fits");
  expect(text).toContain("in 简体中文");
  expect(takenResult(2, ["link 3 (c.test): no"], "English")).toContain("2 cards are up");
  expect(takenResult(2, ["link 3 (c.test): no"], "English")).toContain("Not started: link 3 (c.test): no");
});

test("all starts every link, one card each", async () => {
  const h = harness(["https://a.test/x", "https://b.test/y"]);
  await h.tool.execute({ link: "all" });
  expect(h.started.map((s) => s.url)).toEqual(["https://a.test/x", "https://b.test/y"]);
  expect(h.cards.map((c) => c.intakeId)).toEqual(["in-1", "in-2"]);
});

test("a topic number becomes the card's suggestion by id; one off the list is ignored", async () => {
  const h = harness(["https://a.test/x"]);
  await h.tool.execute({ link: "1", topic: 2 });
  await h.tool.execute({ link: "1", topic: 9 });
  expect(h.cards).toEqual([
    { kind: "link-intake", intakeId: "in-1", suggestedTopicId: "t-pi" },
    { kind: "link-intake", intakeId: "in-2" },
  ]);
});

test("a number off the list starts nothing and says what the numbers are", async () => {
  const h = harness(["https://a.test/x", "https://b.test/y"]);
  expect(await h.tool.execute({ link: "3" })).toContain("from 1 to 2");
  expect(h.started).toEqual([]);
});

test("no link anywhere starts nothing", async () => {
  const h = harness([]);
  expect(await h.tool.execute({ link: "all" })).toContain("no link");
  expect(h.cards).toEqual([]);
});

test("a run the runner refuses is the model's error, with no card", async () => {
  const h = harness(["https://a.test/x"], {
    start: async () => {
      throw new Error("the runner is not accepting work");
    },
  });
  await expect(h.tool.execute({ link: "1" })).rejects.toThrow(/not accepting/);
  expect(h.cards).toEqual([]);
});
