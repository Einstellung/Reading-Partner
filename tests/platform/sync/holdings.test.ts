// The two pure halves of docs/59 tier 1 and 2: the holdings file itself
// (src/platform/sync/holdings.ts) and the tree-level deletion inference
// (src/platform/sync/infer-deletions.ts). No engine, no IO. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildHoldings,
  holdingsDeviceOf,
  holdingsPath,
  holdingsRemoteName,
  isHoldingsName,
  parseHoldings,
  renderHoldingsPass,
  sameFiles,
  serializeHoldings,
  type Holdings,
  type HoldingsFiles,
} from "../../../src/platform/sync/holdings";
import {
  HOLDINGS_INFER_DELETIONS,
  inferDeletions,
} from "../../../src/platform/sync/infer-deletions";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function holdings(over: Partial<Holdings> & { files: HoldingsFiles }): Holdings {
  return buildHoldings({ device: "d-a", at: 1000, ...over });
}

const local = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([p, hash]) => [p, { hash }]));

// --- the file ---------------------------------------------------------------

test("a remote name names its device, and nothing else does", () => {
  expect(holdingsRemoteName("d-3f9a1c")).toBe("holdings-d-3f9a1c.json");
  expect(holdingsDeviceOf("holdings-d-3f9a1c.json")).toBe("d-3f9a1c");
  expect(holdingsDeviceOf("annotations-abc.json")).toBeNull();
  expect(holdingsDeviceOf("holdings-.json")).toBeNull();
  // A device id becomes a path, so a name that would escape the directory is
  // not a holdings file at all.
  expect(holdingsDeviceOf("holdings-../../secrets.json")).toBeNull();
  expect(isHoldingsName("holdings-d-1.json")).toBe(true);
  expect(holdingsPath("d-1")).toBe("sync-holdings/d-1.json");
});

test("the same tree serialises to the same bytes whatever order it was scanned in", () => {
  const one = serializeHoldings(
    holdings({ files: { "b.json": ["h2", 2], "a.json": ["h1", 1] } }),
  );
  const two = serializeHoldings(
    holdings({ files: { "a.json": ["h1", 1], "b.json": ["h2", 2] } }),
  );
  expect(dec(one)).toBe(dec(two));
  // And a round trip is byte-identical, so a device that republishes what it
  // read publishes the same file.
  expect(dec(serializeHoldings(parseHoldings(one)!))).toBe(dec(one));
});

test("a holdings that is not one parses as null, and a partial one keeps its flag", () => {
  expect(parseHoldings(null)).toBeNull();
  expect(parseHoldings(new TextEncoder().encode("{"))).toBeNull();
  expect(parseHoldings(new TextEncoder().encode('{"v":2,"device":"d","files":{}}'))).toBeNull();
  const partial = parseHoldings(serializeHoldings(holdings({ files: {}, complete: false })))!;
  expect(partial.complete).toBe(false);
  // Written before the field existed reads as complete: no build ever published
  // a partial tree without saying so.
  const old = parseHoldings(new TextEncoder().encode('{"v":1,"device":"d","files":{}}'))!;
  expect(old.complete).toBe(true);
});

test("sameFiles is what decides a republish: paths and hashes only", () => {
  const a: HoldingsFiles = { "a.json": ["h1", 1] };
  expect(sameFiles(a, { "a.json": ["h1", 1] })).toBe(true);
  expect(sameFiles(a, { "a.json": ["h2", 1] })).toBe(false);
  expect(sameFiles(a, { "a.json": ["h1", 1], "b.json": ["h2", 2] })).toBe(false);
  expect(sameFiles(a, {})).toBe(false);
});

// --- the inference ----------------------------------------------------------

test("the shipped build does not infer deletions yet", () => {
  expect(HOLDINGS_INFER_DELETIONS).toBe(false);
});

test("a path the peer dropped and this device still holds unchanged is deleted", () => {
  const out = inferDeletions({
    base: holdings({ files: { "topics.json": ["h1", 5] } }),
    current: holdings({ files: {} }),
    local: local({ "topics.json": "h1" }),
    remoteHashes: new Map([["topics.json", "h1"]]),
  });
  expect(out).toEqual({ deletions: ["topics.json"], contested: [] });
});

test("no cached base infers nothing, however much the peer dropped", () => {
  const out = inferDeletions({
    base: null,
    current: holdings({ files: {} }),
    local: local({ "topics.json": "h1" }),
    remoteHashes: new Map(),
  });
  expect(out.deletions).toEqual([]);
});

test("a delete that meets a local edit loses to the edit", () => {
  const out = inferDeletions({
    base: holdings({ files: { "topics.json": ["h1", 5] } }),
    current: holdings({ files: {} }),
    local: local({ "topics.json": "h2" }),
    remoteHashes: new Map([["topics.json", "h1"]]),
  });
  expect(out).toEqual({ deletions: [], contested: ["topics.json"] });
});

test("a listing that disagrees with the base's hash makes the path unknown", () => {
  const input = {
    base: holdings({ files: { "topics.json": ["h1", 5] } }),
    current: holdings({ files: {} }),
    local: local({ "topics.json": "h1" }),
  };
  // The remote moved on to content the peer's tree never described: whose it is
  // cannot be told this pass, so nothing is concluded.
  expect(inferDeletions({ ...input, remoteHashes: new Map([["topics.json", "h9"]]) }).deletions)
    .toEqual([]);
  // A remote with no hash at all (uploaded before hashing) suppresses nothing:
  // the local comparison is what guards the path.
  expect(inferDeletions({ ...input, remoteHashes: new Map() }).deletions).toEqual([
    "topics.json",
  ]);
});

test("the never-infer list is never inferred", () => {
  for (const path of [
    "observations/meta.json",
    "statements.json",
    "deleted-books.jsonl",
    "observations/deleted-observations.jsonl",
    "info-feedback.jsonl",
  ]) {
    const out = inferDeletions({
      base: holdings({ files: { [path]: ["h1", 5] } }),
      current: holdings({ files: {} }),
      local: local({ [path]: "h1" }),
      remoteHashes: new Map([[path, "h1"]]),
    });
    expect(out.deletions).toEqual([]);
  }
});

test("a retired path is not a deletion", () => {
  const out = inferDeletions({
    base: holdings({ files: { "slides/deck-3.json": ["h1", 5] } }),
    current: holdings({ files: {}, retired: ["slides/deck-3.json"] }),
    local: local({ "slides/deck-3.json": "h1" }),
    remoteHashes: new Map([["slides/deck-3.json", "h1"]]),
  });
  expect(out).toEqual({ deletions: [], contested: [] });
});

test("an incomplete scan on either side is recorded, not read", () => {
  const base = holdings({ files: { "topics.json": ["h1", 5] } });
  const gone = holdings({ files: {} });
  const args = { local: local({ "topics.json": "h1" }), remoteHashes: new Map([["topics.json", "h1"]]) };
  expect(inferDeletions({ ...args, base, current: { ...gone, complete: false } }).deletions).toEqual([]);
  expect(inferDeletions({ ...args, base: { ...base, complete: false }, current: gone }).deletions).toEqual([]);
});

test("a path gone from both sides is not a deletion to execute", () => {
  const out = inferDeletions({
    base: holdings({ files: { "topics.json": ["h1", 5] } }),
    current: holdings({ files: {} }),
    local: local({}),
    remoteHashes: new Map(),
  });
  expect(out).toEqual({ deletions: [], contested: [] });
});

test("the report names both trees and what was concluded", () => {
  const text = renderHoldingsPass({
    self: holdings({ files: { "a.json": ["h1", 1] } }),
    published: true,
    peers: [
      { device: "d-b", cached: holdings({ device: "d-b", files: {} }), current: null },
    ],
    inferred: ["topics.json"],
    contested: [],
    enabled: true,
  });
  expect(text).toContain("self d-a at=1000 files=1 (published)");
  expect(text).toContain("peer d-b cached[at=1000 files=0] now[none]");
  expect(text).toContain("inferred deletions (on): topics.json");
});
