// What observation_update will accept as evidence. The message id is never a
// tool parameter: the model cites a transcript line number and the mount turns
// it back into "<threadId>:<ts>" (transcript.ts), so an anchor that resolves to
// nothing has no way in.

import { expect, test } from "bun:test";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import { ObservationFileStore } from "../../src/memory/observations/store";
import { buildObservationTools } from "../../src/memory/observations/tools";
import { JULY_17, makeFakeFs } from "./fakefs";

function mount(opts: Parameters<typeof buildObservationTools>[1] = {}) {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore("t", fs, () => JULY_17);
  const adapter = new FileObservationAdapter(store);
  const write = buildObservationTools(adapter, opts).find((t) => t.name === "observation_update")!;
  return { store, write };
}

const CREATE = {
  action: "create",
  type: "stuck-point",
  summary: "Stuck on the key/query split",
  body: "Asked on 2026-07-17.",
};

test("an index is stored as the anchor of the line it was printed against", async () => {
  // Line 2 came from a folded aside, so its anchor is that aside's thread —
  // the case that produced 66 of the 76 broken anchors on disk.
  const { store, write } = mount({ messageAnchors: ["lesson-1:10", "aside-2:20", "lesson-1:30"] });
  await write.execute({ ...CREATE, messageIndices: [2] });
  expect((await store.list())[0].anchors.messageIds).toEqual(["aside-2:20"]);
});

test("indices are stored sorted and de-duplicated, in the transcript's order", async () => {
  const { store, write } = mount({ messageAnchors: ["t:10", "t:20", "t:30"] });
  await write.execute({ ...CREATE, messageIndices: [3, 1, 3] });
  expect((await store.list())[0].anchors.messageIds).toEqual(["t:10", "t:30"]);
});

test("the schema bounds an index to the lines actually rendered", () => {
  const { write } = mount({ messageAnchors: ["t:10", "t:20"] });
  const schema = write.parameters as { properties: Record<string, any> };
  expect(schema.properties.messageIndices.items).toMatchObject({
    type: "integer",
    minimum: 1,
    maximum: 2,
  });
  // And the id form is gone: there is no string parameter left to invent one in.
  expect(schema.properties.messageIds).toBeUndefined();
});

test("an out-of-range index is refused rather than stored", async () => {
  const { store, write } = mount({ messageAnchors: ["t:10", "t:20"] });
  await expect(write.execute({ ...CREATE, messageIndices: [3] })).rejects.toThrow(
    "not a transcript line (1-2)",
  );
  expect(await store.list()).toHaveLength(0);
});

test("a mount with no transcript offers no message parameter at all", () => {
  const { write } = mount({});
  const schema = write.parameters as { properties: Record<string, any> };
  expect(schema.properties.messageIndices).toBeUndefined();
});

test("requireAnchor refuses a create with nothing pointing back at it", async () => {
  const { store, write } = mount({ messageAnchors: ["t:10"], requireAnchor: true });
  await expect(write.execute({ ...CREATE })).rejects.toThrow("requires evidence");
  await expect(write.execute({ ...CREATE, annotationIds: [] })).rejects.toThrow("requires evidence");
  expect(await store.list()).toHaveLength(0);
  // Either kind of anchor satisfies it, so the marks pass — which has annotation
  // ids and no transcript — is not broken by the rule.
  await write.execute({ ...CREATE, annotationIds: ["ann-1"] });
  expect(await store.list()).toHaveLength(1);
});

test("the marks pass can satisfy requireAnchor with annotation ids alone", async () => {
  const { store, write } = mount({ requireAnchor: true });
  await expect(write.execute({ ...CREATE })).rejects.toThrow("requires evidence");
  await write.execute({ ...CREATE, annotationIds: ["ann-1"] });
  expect((await store.list())[0].anchors).toEqual({ annotationIds: ["ann-1"], messageIds: [] });
});

// The live reading and retell turns mount these tools mid-conversation, where
// there is no listing to cite. Requiring an anchor there would refuse every
// observation the reader's own conversation produces.
test("without requireAnchor a create with no evidence still goes through", async () => {
  const { store, write } = mount({});
  await write.execute({ ...CREATE });
  expect((await store.list())[0].anchors).toEqual({ annotationIds: [], messageIds: [] });
});
