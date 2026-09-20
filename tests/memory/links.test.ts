// The two read-side links over a list of observations
// (src/memory/observations/links.ts): anchor -> observations, and the
// `m-<16hex>` mentions the distiller writes into bodies unprompted.
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
  const a = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["ann-1"] });
  const b = obs("m-bbbbbbbbbbbbbbbb", { annotations: ["ann-1", "ann-2"] });
  const index = buildAnchorIndex([a, b]);
  expect(observationsForAnnotation(index, "ann-1")).toEqual([a, b]);
  expect(observationsForAnnotation(index, "ann-2")).toEqual([b]);
  expect(observationsForAnnotation(index, "ann-3")).toEqual([]);
});

test("annotation ids and message ids stay in separate namespaces", () => {
  const a = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["x"] });
  const b = obs("m-bbbbbbbbbbbbbbbb", { messages: ["x"] });
  const index = buildAnchorIndex([a, b]);
  expect(observationsForAnnotation(index, "x")).toEqual([a]);
  expect(observationsForMessage(index, "x")).toEqual([b]);
});

test("buckets keep the caller's order, so a newest-first list reads newest first", () => {
  const newer = obs("m-bbbbbbbbbbbbbbbb", { annotations: ["ann-1"], updated: "2026-07-20" });
  const older = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["ann-1"], updated: "2026-07-02" });
  const index = buildAnchorIndex([newer, older]); // store.list() order
  expect(observationsForAnnotation(index, "ann-1").map((e) => e.id)).toEqual([
    "m-bbbbbbbbbbbbbbbb",
    "m-aaaaaaaaaaaaaaaa",
  ]);
});

test("an anchor listed twice on one observation lists that observation once", () => {
  const a = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["ann-1", "ann-1"] });
  expect(observationsForAnnotation(buildAnchorIndex([a]), "ann-1")).toEqual([a]);
});

test("siblings are the other observations on this one's evidence, itself excluded", () => {
  const a = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["ann-1"], messages: ["t:10"] });
  const b = obs("m-bbbbbbbbbbbbbbbb", { annotations: ["ann-1"] });
  const c = obs("m-cccccccccccccccc", { messages: ["t:10"] });
  const far = obs("m-dddddddddddddddd", { annotations: ["ann-9"] });
  const index = buildAnchorIndex([a, b, c, far]);
  expect(anchorSiblings(index, a).map((e) => e.id)).toEqual(["m-bbbbbbbbbbbbbbbb", "m-cccccccccccccccc"]);
  expect(anchorSiblings(index, far)).toEqual([]);
});

test("an observation sharing both a mark and a message is one sibling, not two", () => {
  const a = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["ann-1"], messages: ["t:10"] });
  const b = obs("m-bbbbbbbbbbbbbbbb", { annotations: ["ann-1"], messages: ["t:10"] });
  expect(anchorSiblings(buildAnchorIndex([a, b]), a).map((e) => e.id)).toEqual(["m-bbbbbbbbbbbbbbbb"]);
});

// --- observation -> observation ---

test("mentions are found in prose, de-duplicated, in order of first appearance", () => {
  const text = "见 m-bbbbbbbbbbbbbbbb 与 m-aaaaaaaaaaaaaaaa（同一处），后来 m-bbbbbbbbbbbbbbbb 又被改写。";
  expect(mentionedIds(text)).toEqual(["m-bbbbbbbbbbbbbbbb", "m-aaaaaaaaaaaaaaaa"]);
});

test("a longer hex run is not an id, and neither is the tail of another token", () => {
  // Without the trailing boundary the first sixteen characters of a longer
  // hash would read as an id; without the leading one, so would the end of a
  // hyphenated token or a UUID segment.
  expect(
    mentionedIds("hash m-0123456789abcdef01 and xm-0123456701234567 and 4e-m-0123456701234567"),
  ).toEqual([]);
  expect(mentionedIds("(m-0123456701234567) [m-89abcdef89abcdef] 见m-abcdef01abcdef01")).toEqual([
    "m-0123456701234567",
    "m-89abcdef89abcdef",
    "m-abcdef01abcdef01",
  ]);
});

test("two mentions with nothing but a separator between them both resolve", () => {
  expect(mentionedIds("m-aaaaaaaaaaaaaaaa,m-bbbbbbbbbbbbbbbb")).toEqual([
    "m-aaaaaaaaaaaaaaaa",
    "m-bbbbbbbbbbbbbbbb",
  ]);
});

test("an observation quoting its own id is prose about itself, not a link", () => {
  const a = obs("m-aaaaaaaaaaaaaaaa", { body: "m-aaaaaaaaaaaaaaaa 记的是 m-bbbbbbbbbbbbbbbb 的后续。" });
  expect(mentionedIds(a.body, a.id)).toEqual(["m-bbbbbbbbbbbbbbbb"]);
});

test("mentions resolve against the ids that exist and the rest are reported as dangling", () => {
  const target = obs("m-bbbbbbbbbbbbbbbb");
  const a = obs("m-aaaaaaaaaaaaaaaa", { body: "follows m-bbbbbbbbbbbbbbbb, corrects m-cccccccccccccccc" });
  const { resolved, dangling } = resolveReferences(a, observationsById([a, target]));
  expect(resolved).toEqual([target]);
  expect(dangling).toEqual(["m-cccccccccccccccc"]);
});

test("a wider known set resolves the same body wider — the seam cross-topic recall uses", () => {
  // Mentions never cross a topic directory today because the store is scoped
  // per topic, not because the text is. Handing in a map merged from several
  // topics is the whole change.
  const mine = obs("m-aaaaaaaaaaaaaaaa", { body: "同 m-bbbbbbbbbbbbbbbb" });
  const otherTopic = obs("m-bbbbbbbbbbbbbbbb");
  expect(resolveReferences(mine, observationsById([mine])).dangling).toEqual(["m-bbbbbbbbbbbbbbbb"]);
  expect(resolveReferences(mine, observationsById([mine, otherTopic])).resolved).toEqual([
    otherTopic,
  ]);
});

test("only the body is scanned; a summary is one line of index text", () => {
  const a: Observation = { ...obs("m-aaaaaaaaaaaaaaaa"), summary: "see m-bbbbbbbbbbbbbbbb", body: "no ids here" };
  expect(resolveReferences(a, observationsById([a, obs("m-bbbbbbbbbbbbbbbb")])).resolved).toEqual([]);
});
