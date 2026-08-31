// The two read-side links over a list of observations
// (src/memory/observations/links.ts): anchor -> observations, and the
// `m-<8hex>` mentions the distiller writes into bodies unprompted.
//
// The numbers quoted here were measured on the owner's store on 2026-08-31:
// 143 observations across 3 topics, 285 mentions in 81 bodies, 278 distinct
// source-target pairs, none dangling and none crossing a topic directory.

import { expect, test } from "bun:test";
import {
  anchorSiblings,
  buildAnchorIndex,
  mentionedIds,
  observationsById,
  observationsForAnnotation,
  observationsForMessage,
  resolveReferences,
} from "../../src/memory/observations/links";
import type { Observation, ObservationType } from "../../src/memory/observations/types";

function obs(
  id: string,
  opts: {
    annotations?: string[];
    messages?: string[];
    body?: string;
    type?: ObservationType;
    updated?: string;
  } = {},
): Observation {
  return {
    id,
    type: opts.type ?? "stuck-point",
    summary: `summary of ${id}`,
    body: opts.body ?? "",
    created: "2026-07-01",
    updated: opts.updated ?? "2026-07-01",
    anchors: { annotationIds: opts.annotations ?? [], messageIds: opts.messages ?? [] },
  };
}

// --- anchor -> observations ---

test("an anchor maps to every observation that cites it", () => {
  const a = obs("m-aaaaaaaa", { annotations: ["ann-1"] });
  const b = obs("m-bbbbbbbb", { annotations: ["ann-1", "ann-2"] });
  const index = buildAnchorIndex([a, b]);
  expect(observationsForAnnotation(index, "ann-1")).toEqual([a, b]);
  expect(observationsForAnnotation(index, "ann-2")).toEqual([b]);
  expect(observationsForAnnotation(index, "ann-3")).toEqual([]);
});

test("annotation ids and message ids stay in separate namespaces", () => {
  const a = obs("m-aaaaaaaa", { annotations: ["x"] });
  const b = obs("m-bbbbbbbb", { messages: ["x"] });
  const index = buildAnchorIndex([a, b]);
  expect(observationsForAnnotation(index, "x")).toEqual([a]);
  expect(observationsForMessage(index, "x")).toEqual([b]);
});

test("buckets keep the caller's order, so a newest-first list reads newest first", () => {
  const newer = obs("m-bbbbbbbb", { annotations: ["ann-1"], updated: "2026-07-20" });
  const older = obs("m-aaaaaaaa", { annotations: ["ann-1"], updated: "2026-07-02" });
  const index = buildAnchorIndex([newer, older]); // store.list() order
  expect(observationsForAnnotation(index, "ann-1").map((e) => e.id)).toEqual([
    "m-bbbbbbbb",
    "m-aaaaaaaa",
  ]);
});

test("an anchor listed twice on one observation lists that observation once", () => {
  const a = obs("m-aaaaaaaa", { annotations: ["ann-1", "ann-1"] });
  expect(observationsForAnnotation(buildAnchorIndex([a]), "ann-1")).toEqual([a]);
});

test("siblings are the other observations on this one's evidence, itself excluded", () => {
  const a = obs("m-aaaaaaaa", { annotations: ["ann-1"], messages: ["t:10"] });
  const b = obs("m-bbbbbbbb", { annotations: ["ann-1"] });
  const c = obs("m-cccccccc", { messages: ["t:10"] });
  const far = obs("m-dddddddd", { annotations: ["ann-9"] });
  const index = buildAnchorIndex([a, b, c, far]);
  expect(anchorSiblings(index, a).map((e) => e.id)).toEqual(["m-bbbbbbbb", "m-cccccccc"]);
  expect(anchorSiblings(index, far)).toEqual([]);
});

test("an observation sharing both a mark and a message is one sibling, not two", () => {
  const a = obs("m-aaaaaaaa", { annotations: ["ann-1"], messages: ["t:10"] });
  const b = obs("m-bbbbbbbb", { annotations: ["ann-1"], messages: ["t:10"] });
  expect(anchorSiblings(buildAnchorIndex([a, b]), a).map((e) => e.id)).toEqual(["m-bbbbbbbb"]);
});

// --- observation -> observation ---

test("mentions are found in prose, de-duplicated, in order of first appearance", () => {
  const text = "见 m-bbbbbbbb 与 m-aaaaaaaa（同一处），后来 m-bbbbbbbb 又被改写。";
  expect(mentionedIds(text)).toEqual(["m-bbbbbbbb", "m-aaaaaaaa"]);
});

test("a longer hex run is not an id, and neither is the tail of another token", () => {
  // Without the trailing boundary the first eight characters of a longer hash
  // would read as an id; without the leading one, so would the end of a
  // hyphenated token or a UUID segment.
  expect(mentionedIds("hash m-0123456789ab and xm-01234567 and 4e-m-01234567")).toEqual([]);
  expect(mentionedIds("(m-01234567) [m-89abcdef] 见m-abcdef01")).toEqual([
    "m-01234567",
    "m-89abcdef",
    "m-abcdef01",
  ]);
});

test("two mentions with nothing but a separator between them both resolve", () => {
  expect(mentionedIds("m-aaaaaaaa,m-bbbbbbbb")).toEqual(["m-aaaaaaaa", "m-bbbbbbbb"]);
});

test("an observation quoting its own id is prose about itself, not a link", () => {
  const a = obs("m-aaaaaaaa", { body: "m-aaaaaaaa 记的是 m-bbbbbbbb 的后续。" });
  expect(mentionedIds(a.body, a.id)).toEqual(["m-bbbbbbbb"]);
});

test("mentions resolve against the ids that exist and the rest are reported as dangling", () => {
  const target = obs("m-bbbbbbbb");
  const a = obs("m-aaaaaaaa", { body: "follows m-bbbbbbbb, corrects m-cccccccc" });
  const { resolved, dangling } = resolveReferences(a, observationsById([a, target]));
  expect(resolved).toEqual([target]);
  expect(dangling).toEqual(["m-cccccccc"]);
});

test("a wider known set resolves the same body wider — the seam cross-topic recall uses", () => {
  // Mentions never cross a topic directory today because the store is scoped
  // per topic, not because the text is. Handing in a map merged from several
  // topics is the whole change.
  const mine = obs("m-aaaaaaaa", { body: "同 m-bbbbbbbb" });
  const otherTopic = obs("m-bbbbbbbb");
  expect(resolveReferences(mine, observationsById([mine])).dangling).toEqual(["m-bbbbbbbb"]);
  expect(resolveReferences(mine, observationsById([mine, otherTopic])).resolved).toEqual([
    otherTopic,
  ]);
});

test("only the body is scanned; a summary is one line of index text", () => {
  const a: Observation = { ...obs("m-aaaaaaaa"), summary: "see m-bbbbbbbb", body: "no ids here" };
  expect(resolveReferences(a, observationsById([a, obs("m-bbbbbbbb")])).resolved).toEqual([]);
});
