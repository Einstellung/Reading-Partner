// Source descriptor validation + path helpers (src/info/sources/descriptor.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  DEFAULT_POLL_MINUTES,
  DESCRIPTOR_GUIDE,
  dotPath,
  MAX_POLL_MINUTES,
  MIN_POLL_MINUTES,
  pickString,
  pollIntervalMs,
  validateDescriptor,
} from "../../src/info/sources/descriptor";

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

test("DESCRIPTOR_GUIDE lists every discovery kind and fulltext mode, with a valid example", () => {
  for (const kind of ["feed", "listpage", "json-api", "stream"]) expect(DESCRIPTOR_GUIDE).toContain(kind);
  for (const mode of ["feed-field", "fetch-page", "detail-endpoint", "none"]) expect(DESCRIPTOR_GUIDE).toContain(mode);
  // The embedded example parses and validates through the real validator.
  const example = DESCRIPTOR_GUIDE.slice(DESCRIPTOR_GUIDE.indexOf("{ \"id\""));
  expect(validateDescriptor(JSON.parse(example)).ok).toBe(true);
  // Compact — a grammar, not a tutorial.
  expect(DESCRIPTOR_GUIDE.split("\n").length).toBeLessThanOrEqual(30);
});

test("pollMinutes is optional, and an authoring slip is rejected rather than silently defaulted", () => {
  // Every descriptor written before background collection existed omits it.
  expect(validateDescriptor(FEED_DESC).ok).toBe(true);
  expect(validateDescriptor({ ...FEED_DESC, pollMinutes: 30 }).ok).toBe(true);
  expect(validateDescriptor({ ...FEED_DESC, pollMinutes: "2h" }).ok).toBe(false);
  expect(validateDescriptor({ ...FEED_DESC, pollMinutes: 0 }).ok).toBe(false);
  expect(validateDescriptor({ ...FEED_DESC, pollMinutes: -5 }).ok).toBe(false);
});

test("a source with no stated interval is polled at the default, and an absurd one is held to the band", () => {
  expect(pollIntervalMs({})).toBe(DEFAULT_POLL_MINUTES * 60_000);
  expect(pollIntervalMs({ pollMinutes: 45 })).toBe(45 * 60_000);
  expect(pollIntervalMs({ pollMinutes: 1 })).toBe(MIN_POLL_MINUTES * 60_000);
  expect(pollIntervalMs({ pollMinutes: 99_999 })).toBe(MAX_POLL_MINUTES * 60_000);
  // A descriptor off disk is JSON the user (or the AI) wrote; a source whose
  // interval cannot be read is polled at the default, never dropped.
  expect(pollIntervalMs({ pollMinutes: Number.NaN })).toBe(DEFAULT_POLL_MINUTES * 60_000);
});

test("DESCRIPTOR_GUIDE tells the AI what pollMinutes is for, with the numbers it should reach for", () => {
  const guide = DESCRIPTOR_GUIDE;
  expect(guide).toContain("pollMinutes");
  expect(guide).toContain(String(DEFAULT_POLL_MINUTES));
  expect(guide).toContain(`${MIN_POLL_MINUTES}-${MAX_POLL_MINUTES}`);
});

test("dotPath / pickString read nested fields with candidate fallback", () => {
  const row = { title: { rendered: "Hi" }, published_at: "2026", n: 7 };
  expect(dotPath(row, "title.rendered")).toBe("Hi");
  expect(dotPath(row, "title.missing")).toBeUndefined();
  expect(pickString(row, ["publishedAt", "published_at"])).toBe("2026");
  expect(pickString(row, "n")).toBe("7");
  expect(pickString(row, "nope")).toBe("");
});
