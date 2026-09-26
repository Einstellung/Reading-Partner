// Which words a hold on the phone lesson picks out (docs/74). Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../../../support/dom";

const { cleanup } = await useDom();
const { replySpanAt } = await import("../../../../../src/ui/components/phone/lesson/lesson-aside");

afterEach(cleanup);

function reply(html: string, ts = "1700"): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = `<div data-reply-ts="${ts}">${html}</div>`;
  document.body.append(host);
  return host;
}

test("a press in a paragraph takes that paragraph", () => {
  const host = reply("<p>The first stop.</p><p>The second stop.</p>");
  const second = host.querySelectorAll("p")[1];
  expect(replySpanAt(second.firstChild)).toEqual({ messageTs: 1700, text: "The second stop." });
});

test("a press on something inside a paragraph still takes the paragraph", () => {
  const host = reply("<p>Attention is <em>all</em> you need.</p>");
  const em = host.querySelector("em");
  expect(replySpanAt(em)).toEqual({ messageTs: 1700, text: "Attention is all you need." });
});

test("a press between the blocks takes the whole reply", () => {
  const host = reply("<p>One line.</p>");
  expect(replySpanAt(host.querySelector("[data-reply-ts]"))).toEqual({
    messageTs: 1700,
    text: "One line.",
  });
});

test("a list item is a paragraph", () => {
  const host = reply("<ul><li>WordPiece embeddings</li><li>Segment embeddings</li></ul>");
  const first = host.querySelector("li");
  expect(replySpanAt(first)?.text).toBe("WordPiece embeddings");
});

test("nothing outside a reply picks anything", () => {
  const stray = document.createElement("p");
  stray.textContent = "Take me to BERT.";
  document.body.append(stray);
  expect(replySpanAt(stray)).toBeNull();
});

test("a paragraph with nothing in it picks nothing", () => {
  const host = reply("<p> </p>");
  expect(replySpanAt(host.querySelector("p"))).toBeNull();
});

test("the span is clipped to what the record holds", () => {
  const long = "word ".repeat(200).trim();
  const host = reply(`<p>${long}</p>`);
  const span = replySpanAt(host.querySelector("p"));
  expect(span).not.toBeNull();
  expect((span as { text: string }).text.length).toBeLessThanOrEqual(400);
});
