// What observation_read prints (describeEntry in src/memory/observations/tools.ts).
// The body's `m-<8hex>` mentions and the anchors it shares with other
// observations are both links the stored data already carries; this is where
// they become something the model can follow without another pass over the
// store.

import { expect, test } from "bun:test";
import type { ObservationAdapter } from "../../src/memory/observations/adapter";
import { buildObservationTools } from "../../src/memory/observations/tools";
import type { Observation, ObservationType } from "../../src/memory/observations/types";

function obs(
  id: string,
  opts: {
    body?: string;
    summary?: string;
    annotations?: string[];
    messages?: string[];
    type?: ObservationType;
  } = {},
): Observation {
  return {
    id,
    type: opts.type ?? "stuck-point",
    summary: opts.summary ?? `summary of ${id}`,
    body: opts.body ?? `body of ${id}`,
    created: "2026-07-01",
    updated: "2026-07-05",
    anchors: { annotationIds: opts.annotations ?? [], messageIds: opts.messages ?? [] },
  };
}

// Read-only adapter over a fixed list: the write path has its own tests, and
// what is under test here is the rendering, not the store.
function readTool(entries: Observation[]) {
  const adapter = {
    listObservations: async () => entries,
  } as unknown as ObservationAdapter;
  return buildObservationTools(adapter).find((t) => t.name === "observation_read")!;
}

test("a mentioned observation is printed with its type and summary", async () => {
  const target = obs("m-bbbbbbbbbbbbbbbb", { type: "correction", summary: "ω is not a ratio" });
  const entry = obs("m-aaaaaaaaaaaaaaaa", { body: "解开的过程记在 m-bbbbbbbbbbbbbbbb。" });
  const out = String(await readTool([entry, target]).execute({ id: "m-aaaaaaaaaaaaaaaa" }));
  expect(out).toContain("Observations this one mentions:");
  expect(out).toContain("- [m-bbbbbbbbbbbbbbbb] (correction, updated 2026-07-05) ω is not a ratio");
});

// Phrased by where the read looked rather than by what became of the id: with
// cross-topic recall the set is this topic plus whichever others the mount was
// given (recall.ts), so a deleted mention and one in a topic nobody handed us
// are the same silence.
test("a mention none of the visible observations hold is named, not printed as a link", async () => {
  const entry = obs("m-aaaaaaaaaaaaaaaa", { body: "取代了 m-cccccccccccccccc。" });
  const out = String(await readTool([entry]).execute({ id: "m-aaaaaaaaaaaaaaaa" }));
  expect(out).toContain("Mentioned but not in the observations you can see: m-cccccccccccccccc.");
  expect(out).not.toContain("Observations this one mentions:");
});

test("observations built on the same mark or message are printed as the same evidence", async () => {
  const entry = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["ann-1"], messages: ["t:10"] });
  const sameMark = obs("m-bbbbbbbbbbbbbbbb", { annotations: ["ann-1"], summary: "same mark" });
  const sameMessage = obs("m-cccccccccccccccc", { messages: ["t:10"], summary: "same turn" });
  const unrelated = obs("m-dddddddddddddddd", { annotations: ["ann-9"] });
  const out = String(
    await readTool([entry, sameMark, sameMessage, unrelated]).execute({ id: "m-aaaaaaaaaaaaaaaa" }),
  );
  expect(out).toContain("Other observations from the same evidence:");
  expect(out).toContain("[m-bbbbbbbbbbbbbbbb]");
  expect(out).toContain("[m-cccccccccccccccc]");
  expect(out).not.toContain("[m-dddddddddddddddd]");
});

test("an observation with no neighbours prints exactly what it always did", async () => {
  const entry = obs("m-aaaaaaaaaaaaaaaa", { annotations: ["ann-1"], messages: ["t:10"] });
  const out = String(await readTool([entry]).execute({ id: "m-aaaaaaaaaaaaaaaa" }));
  expect(out).toBe(
    [
      "id: m-aaaaaaaaaaaaaaaa",
      "type: stuck-point",
      "created: 2026-07-01, updated: 2026-07-05",
      "annotations: ann-1",
      "messages: t:10",
      "",
      "body of m-aaaaaaaaaaaaaaaa",
    ].join("\n"),
  );
});

// The widest body on the owner's store mentions 23 other observations. The ids
// are all still there in the body above the list, so the cap costs a summary
// and not a link.
test("a long mention list is capped and says how many it dropped", async () => {
  const targets = Array.from({ length: 20 }, (_, i) =>
    obs(`m-${(0x10000000 + i).toString(16)}00000000`),
  );
  const entry = obs("m-aaaaaaaaaaaaaaaa", { body: targets.map((t) => t.id).join(" ") });
  const out = String(await readTool([entry, ...targets]).execute({ id: "m-aaaaaaaaaaaaaaaa" }));
  expect(out.split("\n").filter((l) => l.startsWith("- ["))).toHaveLength(12);
  expect(out).toContain("(8 more mentioned in the body above)");
});
