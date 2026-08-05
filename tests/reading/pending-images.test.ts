// The per-thread staging of pasted images (src/reading/pending-images), which is
// what keeps an unsent image on the conversation it was pasted into. Pure.
// Run: bun test.

import { expect, test } from "bun:test";
import { createPendingImages } from "../../src/reading/pending-images";

interface Img {
  id: string;
  status: "loading" | "ready";
}

const img = (id: string, status: Img["status"] = "ready"): Img => ({ id, status });

test("each thread stages into its own list", () => {
  const pending = createPendingImages<Img>(3);
  pending.add("a", img("1"));
  pending.add("b", img("2"));
  expect(pending.images("a")).toEqual([img("1")]);
  expect(pending.images("b")).toEqual([img("2")]);
  expect(pending.images("c")).toEqual([]);
});

test("the cap counts one thread at a time", () => {
  const pending = createPendingImages<Img>(2);
  expect(pending.add("a", img("1"))).toBe(true);
  expect(pending.add("a", img("2"))).toBe(true);
  expect(pending.add("a", img("3"))).toBe(false);
  expect(pending.add("b", img("4"))).toBe(true);
  expect(pending.images("a").map((p) => p.id)).toEqual(["1", "2"]);
  expect(pending.images("b").map((p) => p.id)).toEqual(["4"]);
});

test("a compressed image replaces its placeholder in place", () => {
  const pending = createPendingImages<Img>(3);
  pending.add("a", img("1", "loading"));
  pending.add("a", img("2", "loading"));
  pending.replace("a", "1", img("1"));
  expect(pending.images("a")).toEqual([img("1"), img("2", "loading")]);
});

// The compression outlives the placeholder when the user drops it, or when the
// thread it was pasted into is deleted.
test("replacing an image that is gone puts nothing back", () => {
  const pending = createPendingImages<Img>(3);
  pending.add("a", img("1", "loading"));
  pending.remove("a", "1");
  pending.replace("a", "1", img("1"));
  pending.replace("b", "1", img("1"));
  expect(pending.images("a")).toEqual([]);
  expect(pending.images("b")).toEqual([]);
});

test("sending empties only the thread that sent", () => {
  const pending = createPendingImages<Img>(3);
  pending.add("a", img("1"));
  pending.add("b", img("2"));
  pending.setHint("a", "too many");
  expect(pending.take("a")).toEqual([img("1")]);
  expect(pending.images("a")).toEqual([]);
  expect(pending.hint("a")).toBe("");
  expect(pending.images("b")).toEqual([img("2")]);
});

// The images could not be written to disk, so the send did not happen: they go
// back where they were staged and can be sent again.
test("a send that failed hands its images back", () => {
  const pending = createPendingImages<Img>(3);
  pending.add("a", img("1"));
  const taken = pending.take("a");
  pending.restore("a", taken);
  expect(pending.images("a")).toEqual([img("1")]);
});

test("deleting a conversation drops its staging and leaves the others", () => {
  const pending = createPendingImages<Img>(3);
  pending.add("a", img("1"));
  pending.setHint("a", "no images on this model");
  pending.add("b", img("2"));
  pending.clear("a");
  expect(pending.images("a")).toEqual([]);
  expect(pending.hint("a")).toBe("");
  expect(pending.images("b")).toEqual([img("2")]);
});

test("closing the book drops every thread's staging", () => {
  const pending = createPendingImages<Img>(3);
  pending.add("a", img("1"));
  pending.add("b", img("2"));
  pending.setHint("b", "too many");
  pending.clearAll();
  expect(pending.images("a")).toEqual([]);
  expect(pending.images("b")).toEqual([]);
  expect(pending.hint("b")).toBe("");
});

test("the hint is per thread and clears when set to nothing", () => {
  const pending = createPendingImages<Img>(3);
  pending.setHint("a", "This model can't read images.");
  expect(pending.hint("a")).toBe("This model can't read images.");
  expect(pending.hint("b")).toBe("");
  pending.setHint("a", "");
  expect(pending.hint("a")).toBe("");
});

// The composer re-renders on every list identity change, and the call state it
// hangs off changes on every streamed token.
test("an unchanged list keeps its identity", () => {
  const pending = createPendingImages<Img>(3);
  expect(pending.images("a")).toBe(pending.images("b"));
  pending.add("a", img("1"));
  expect(pending.images("a")).toBe(pending.images("a"));
  pending.remove("a", "1");
  expect(pending.images("a")).toBe(pending.images("b"));
});
