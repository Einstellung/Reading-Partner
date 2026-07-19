// Unit tests for the slides plan parser (src/slides/plan.ts). Run: bun test.

import { expect, test } from "bun:test";
import { parseSlidePlan, planUserMessage } from "../../src/slides/plan";

test("parseSlidePlan reads title, kinds, provenance, and asset slots", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "My Talk",
      slides: [
        { title: "Opening", kind: "title" },
        { title: "The core idea", kind: "content", bookId: "b1", sourceChapters: [1, 2] },
        { title: "A picture", kind: "content", bookId: "b1", illustration: { prompt: "a bridge" } },
        { title: "The data", kind: "content", bookId: "b1", figure: { bookId: "b1", figId: "3" } },
        { title: "Wrap", kind: "closing" },
      ],
    }),
  );
  expect(deck.title).toBe("My Talk");
  expect(deck.slides.map((s) => s.kind)).toEqual(["title", "content", "content", "content", "closing"]);
  expect(deck.slides[1]).toMatchObject({ bookId: "b1", sourceChapters: [1, 2] });
  expect(deck.slides[2].illustration).toEqual({ prompt: "a bridge" });
  expect(deck.slides[3].figure).toEqual({ bookId: "b1", figId: "3" });
});

test("parseSlidePlan tolerates fences and preamble", () => {
  const deck = parseSlidePlan('Here you go:\n```json\n{"title":"T","slides":[{"title":"S","kind":"section"}]}\n```');
  expect(deck.title).toBe("T");
  expect(deck.slides).toHaveLength(1);
});

test("parseSlidePlan defaults an unknown kind to content and drops a bodyless content slide", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "T",
      slides: [
        { title: "Real", kind: "weird" },
        { kind: "content" }, // no title -> dropped
      ],
    }),
  );
  expect(deck.slides).toHaveLength(1);
  expect(deck.slides[0].kind).toBe("content");
});

test("parseSlidePlan lower-cases figIds and inherits bookId from the slide", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "T",
      slides: [{ title: "S", kind: "content", bookId: "b9", figure: { figId: "4B" } }],
    }),
  );
  expect(deck.slides[0].figure).toEqual({ bookId: "b9", figId: "4b" });
});

test("parseSlidePlan keeps at most one asset slot (figure wins)", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "T",
      slides: [
        {
          title: "S",
          kind: "content",
          bookId: "b1",
          illustration: { prompt: "x" },
          figure: { figId: "2" },
        },
      ],
    }),
  );
  expect(deck.slides[0].figure).toBeDefined();
  expect(deck.slides[0].illustration).toBeUndefined();
});

test("parseSlidePlan throws on an empty deck", () => {
  expect(() => parseSlidePlan(JSON.stringify({ title: "T", slides: [] }))).toThrow();
  expect(() => parseSlidePlan("not json")).toThrow();
});

test("planUserMessage includes each book's material, figures, and the instruction", () => {
  const msg = planUserMessage(
    [
      { bookId: "b1", title: "Book One", material: "the overview", figures: [{ id: "1", caption: "Fig 1: a plot" }] },
    ],
    "a talk for engineers",
  );
  expect(msg).toContain("Book One");
  expect(msg).toContain("bookId: b1");
  expect(msg).toContain("the overview");
  expect(msg).toContain("1: Fig 1: a plot");
  expect(msg).toContain("a talk for engineers");
});

test("planUserMessage handles an empty instruction", () => {
  const msg = planUserMessage([{ bookId: "b", title: "B", material: "m", figures: [] }], "");
  expect(msg).toContain("No specific talk instruction");
});
