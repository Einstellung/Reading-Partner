// Source descriptor validation + path helpers (src/info/descriptor.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  dotPath,
  pickString,
  validateDescriptor,
} from "../../src/info/descriptor";

const FEED_DESC = {
  id: "x",
  name: "X",
  line: "AI",
  enabled: true,
  discovery: { kind: "feed", url: "https://x/feed" },
  fulltext: { mode: "feed-field", field: "content:encoded" },
};

test("validateDescriptor accepts a well-formed feed descriptor", () => {
  const r = validateDescriptor(FEED_DESC);
  expect(r.ok).toBe(true);
});

test("validateDescriptor accepts json-api with a detail endpoint", () => {
  const r = validateDescriptor({
    id: "j",
    name: "J",
    line: "AI",
    enabled: true,
    discovery: { kind: "json-api", listUrl: "https://j/list", fields: { id: "slug", title: "title" } },
    fulltext: { mode: "detail-endpoint", urlTemplate: "https://j/{id}", contentPath: "content" },
  });
  expect(r.ok).toBe(true);
});

test("validateDescriptor rejects missing id/name/enabled", () => {
  expect(validateDescriptor({ ...FEED_DESC, id: undefined }).ok).toBe(false);
  expect(validateDescriptor({ ...FEED_DESC, name: 3 }).ok).toBe(false);
  expect(validateDescriptor({ ...FEED_DESC, enabled: "yes" }).ok).toBe(false);
});

test("validateDescriptor rejects an unknown discovery kind and a bad fulltext", () => {
  expect(validateDescriptor({ ...FEED_DESC, discovery: { kind: "webring", url: "x" } }).ok).toBe(false);
  expect(validateDescriptor({ ...FEED_DESC, fulltext: { mode: "magic" } }).ok).toBe(false);
});

test("validateDescriptor rejects json-api without required fields", () => {
  const r = validateDescriptor({
    ...FEED_DESC,
    discovery: { kind: "json-api", listUrl: "https://j/list", fields: { title: "t" } },
    fulltext: { mode: "none" },
  });
  expect(r.ok).toBe(false);
});

test("validateDescriptor rejects a listpage that is not paired with fetch-page", () => {
  const r = validateDescriptor({
    ...FEED_DESC,
    discovery: { kind: "listpage", url: "https://x/", linkPattern: "/a/\\d+" },
    fulltext: { mode: "none" },
  });
  expect(r.ok).toBe(false);
});

test("validateDescriptor accepts the reserved stream kind (format-level only)", () => {
  const r = validateDescriptor({
    ...FEED_DESC,
    discovery: { kind: "stream", url: "https://s/flash" },
    fulltext: { mode: "none" },
  });
  expect(r.ok).toBe(true);
});

test("dotPath / pickString read nested fields with candidate fallback", () => {
  const row = { title: { rendered: "Hi" }, published_at: "2026", n: 7 };
  expect(dotPath(row, "title.rendered")).toBe("Hi");
  expect(dotPath(row, "title.missing")).toBeUndefined();
  expect(pickString(row, ["publishedAt", "published_at"])).toBe("2026");
  expect(pickString(row, "n")).toBe("7");
  expect(pickString(row, "nope")).toBe("");
});
