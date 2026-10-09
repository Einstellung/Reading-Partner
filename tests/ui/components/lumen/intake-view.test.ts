// What the intake card shows, read off the intake record
// (src/ui/components/lumen/intake-view.ts).
// Run: scripts/t.sh tests/ui/components/lumen/intake-view.test.ts

import { expect, test } from "bun:test";
import {
  chooseHeadline,
  documentMeta,
  documentToOpen,
  intakeTopicRows,
  intakeView,
  progressLine,
  failureReason,
  reasonText,
  skippedLine,
} from "../../../../src/ui/components/lumen/intake-view";
import type { TopicIntake } from "../../../../src/reading/ingest/topic-intake";
import type { Topic } from "../../../../src/platform/app/topics";

const DOC = {
  hash: "h1",
  title: "pi-durable handbook",
  format: "epub" as const,
  sections: 43,
  pages: 120,
  chars: 90000,
  path: "library/h1.epub",
  sourceUrl: "https://github.com/robotbird/pi-durable-book",
};

function intake(over: Partial<TopicIntake> = {}): TopicIntake {
  return {
    id: "in-1",
    url: "https://x.com/robotbird01/status/1",
    createdAt: 1,
    updatedAt: 1,
    state: "reading",
    host: "x.com",
    documents: [],
    skipped: [],
    topicId: null,
    attachedTo: null,
    ...over,
  };
}

function topic(id: string, name: string, createdAt = 0): Topic {
  return { id, name, createdAt, files: [] } as unknown as Topic;
}

test("before the first read it is loading; read and absent, it was taken in on another device", () => {
  expect(intakeView(null, false)).toEqual({ phase: "loading" });
  expect(intakeView(null, true)).toEqual({ phase: "elsewhere" });
});

test("while reading the list is live, with the host and any pick", () => {
  expect(intakeView(intake(), true)).toEqual({ phase: "choose", picked: null, filed: false, host: "x.com", documents: [] });
  expect(intakeView(intake({ topicId: "t-pi" }), true)).toMatchObject({ phase: "choose", picked: "t-pi", filed: false });
});

test("filed with no pick keeps the list, now saying it is ready", () => {
  const view = intakeView(intake({ state: "filed", host: null, documents: [DOC] }), true);
  expect(view).toMatchObject({ phase: "choose", filed: true, picked: null });
  if (view.phase !== "choose") throw new Error("expected the list");
  expect(progressLine(view)).toBe("Done: pi-durable handbook. Pick a topic to file it.");
  expect(chooseHeadline(view, null)).toBe("Which topic should this go in?");
});

test("a pick while reading says where it will go", () => {
  const view = intakeView(intake({ topicId: "t-pi" }), true);
  if (view.phase !== "choose") throw new Error("expected the list");
  expect(chooseHeadline(view, "pi")).toBe("Going into “pi” once it's read");
  expect(progressLine(view)).toBe("Reading x.com…");
});

test("filed and picked is the receipt, attached or about to be", () => {
  const skipped = [{ url: "https://x.com/robotbird01/status/1", reason: "it has no content of its own" }];
  expect(intakeView(intake({ state: "filed", documents: [DOC], skipped, topicId: "t-pi", attachedTo: "t-pi" }), true)).toEqual({
    phase: "receipt",
    topicId: "t-pi",
    documents: [DOC],
    skipped,
  });
  expect(intakeView(intake({ state: "filed", documents: [DOC], topicId: "t-pi" }), true)).toMatchObject({
    phase: "receipt",
    topicId: "t-pi",
  });
});

test("a failure is only its reason, picked or not", () => {
  expect(intakeView(intake({ state: "failed", reason: "Read x.com. Nothing became a document.", topicId: "t-pi" }), true)).toEqual({
    phase: "failed",
    reason: "Read x.com. Nothing became a document.",
  });
});

test("known reasons are said in the UI language, anything else as written", () => {
  expect(reasonText("Read x.com. Nothing became a document.")).toBe("it was read, but nothing in it could be filed");
  expect(reasonText("it has no content of its own; the post only links out")).toBe("it has no text of its own");
  expect(reasonText("the article is only on the post's page, which this device cannot read; the embed gives only its opening")).toBe(
    "the full text is only on the post's page, which this device can't read",
  );
  expect(reasonText("the t.co link did not resolve")).toBe("the short link didn't open");
  expect(reasonText("socket hang up")).toBe("socket hang up");
  expect(reasonText("could not fetch the link (HTTP 404)")).toBe("the link didn't open (HTTP 404)");
  expect(reasonText("无法抓取该链接（HTTP 503）")).toBe("the link didn't open (HTTP 503)");
  expect(skippedLine({ url: "https://x.com/a/status/1", reason: "the AI did not choose it" })).toBe(
    "Not taken: not related enough, so it was skipped (x.com/a/status/1)",
  );
});

test("a failure's line is a known kind in the UI language with nothing under it, else a plain line over the program's words", () => {
  // The walkthrough's sentence: the ingest's Chinese around a GitHub adapter's English.
  const zh = "无法从 https://github.com/karpathy/this-repo-does-not-exist-xyz 取得可读正文：GitHub has no README for karpathy/this-repo-does-not-exist-xyz, or the repository is private";
  expect(failureReason(zh)).toEqual({ text: "GitHub has no such repository, or it's private", detail: null });
  expect(failureReason("could not get readable text from https://arxiv.org/abs/1: arXiv answered HTTP 404 for the PDF of 1v1")).toEqual({
    text: "the site didn't hand over the document",
    detail: null,
  });
  expect(failureReason("Read x.com. Nothing became a document.")).toEqual({
    text: "it was read, but nothing in it could be filed",
    detail: null,
  });
  // Unknown: the wrapper is taken off and what the program said is the small print.
  expect(failureReason("could not get readable text from https://a.test/x: the page has no article")).toEqual({
    text: "this link couldn't be read",
    detail: "the page has no article",
  });
  expect(failureReason("无法从 https://a.test/x 取得可读正文：the page has no article")).toEqual({
    text: "this link couldn't be read",
    detail: "the page has no article",
  });
  expect(failureReason("socket hang up")).toEqual({ text: "this link couldn't be read", detail: "socket hang up" });
  expect(failureReason("")).toEqual({ text: "this link couldn't be read", detail: null });
});

test("a document's line is its sections or pages and where it came from", () => {
  expect(documentMeta(DOC)).toBe("43 sections · github.com/robotbird/pi-durable-book");
  expect(documentMeta({ ...DOC, sections: 1, pages: 1, sourceUrl: undefined })).toBe("1 page");
  expect(documentMeta({ ...DOC, sections: undefined, pages: 0, sourceUrl: undefined })).toBe("");
});

test("the list is the shelf in order, Lumen's suggestion marked while it exists, else a name in the link, else none", () => {
  const topics = [topic("t-brief", "Brief", 5), topic("t-pi", "pi", 1), topic("t-edge", "Edge models", 2)];
  const rows = intakeTopicRows(topics, { url: "https://example.test/post" }, "t-edge", "t-pi");
  expect(rows.map((r) => [r.id, r.suggested, r.picked])).toEqual([
    ["t-brief", false, false],
    ["t-pi", true, false],
    ["t-edge", false, true],
  ]);
  // A topic named in the link wins once Lumen's pick is gone from the shelf.
  const fallback = intakeTopicRows(topics, { url: "https://github.com/robotbird/pi" }, null, "t-deleted");
  expect(fallback.find((r) => r.suggested)?.id).toBe("t-pi");
  // No pick and no name: nothing is marked, however recently a topic was used.
  expect(intakeTopicRows(topics, { url: "https://github.com/karpathy/nanoGPT" }, null).some((r) => r.suggested)).toBe(false);
  // A pick is exactly what the card marks, even with a name in the link.
  const picked = intakeTopicRows(topics, { url: "https://github.com/robotbird/pi" }, null, "t-edge");
  expect(picked.filter((r) => r.suggested).map((r) => r.id)).toEqual(["t-edge"]);
});

test("打开阅读 opens a document of the receipt, in the topic it was attached to", () => {
  const settled = intake({ state: "filed", documents: [DOC], topicId: "t-pi", attachedTo: "t-pi" });
  expect(documentToOpen(settled, "h1")).toEqual({ hash: "h1", title: DOC.title, topicId: "t-pi", path: DOC.path });
  expect(documentToOpen(intake({ state: "filed", documents: [DOC] }), "h1")).toBeNull();
  expect(documentToOpen(settled, "nope")).toBeNull();
});
