// Tool-call syntax that leaked into a stored observation body
// (src/memory/observations/residue.ts). Measured on the owner's store
// 2026-08-28: 29 of 140 bodies carry some, the most recent written 2026-08-27.

import { expect, test } from "bun:test";
import {
  cleanObservationBody,
  stripToolResidue,
} from "../../src/memory/observations/residue";
import { ObservationFileStore } from "../../src/memory/observations/store";
import { JULY_17, makeFakeFs } from "./fakefs";

const NO_ANCHORS = { annotationIds: [], messageIds: [] };

function makeStore() {
  const { fs, files } = makeFakeFs();
  return { store: new ObservationFileStore("topic-1", fs, () => JULY_17), files };
}

// Real entries on disk end with a stray closing tag and a parameter tag: written
// by a model that was mid-tool-call. Harmless on disk, confusing in a prompt
// that is itself about to describe tools.
test("tool-call syntax that leaked into a stored body is stripped", () => {
  const dirty = 'the prescription\n</body>\n<parameter name="summary">x</parameter>';
  expect(stripToolResidue(dirty)).toBe("the prescription\nx");
});

// The half that was invisible: an id written inside a leaked parameter block
// never reached the frontmatter, so no anchor index could see the evidence the
// observation was built on.
test("an annotation id buried in the residue becomes an anchor, and leaves the body", () => {
  const dirty =
    "leads with the formula and loses him\n" +
    '<parameter name="annotationIds">["ann-1", "ann-2"]</parameter>\n' +
    "</body>";
  const cleaned = cleanObservationBody(dirty, NO_ANCHORS);
  expect(cleaned.body).toBe("leads with the formula and loses him");
  expect(cleaned.anchors).toEqual({ annotationIds: ["ann-1", "ann-2"], messageIds: [] });
});

// The shape on disk today: the opening tag with no closing one, the array
// running to the end of the body.
test("an unclosed parameter block is read and removed all the same", () => {
  const dirty =
    "he asked twice\n" +
    '<parameter name="messageIds">["thread-1:1786612739168", "t-0123456789abcdef"]';
  const cleaned = cleanObservationBody(dirty, NO_ANCHORS);
  expect(cleaned.body).toBe("he asked twice");
  expect(cleaned.anchors.messageIds).toEqual(["thread-1:1786612739168", "t-0123456789abcdef"]);
});

test("what the entry already cites is kept, and a repeat of it is not doubled", () => {
  const dirty = 'x\n<parameter name="annotationIds">["ann-1", "ann-3"]</parameter>';
  const cleaned = cleanObservationBody(dirty, {
    annotationIds: ["ann-1", "ann-2"],
    messageIds: ["t-1111111111111111"],
  });
  expect(cleaned.anchors).toEqual({
    annotationIds: ["ann-1", "ann-2", "ann-3"],
    messageIds: ["t-1111111111111111"],
  });
});

test("a body with no residue comes back as it went in", () => {
  const clean = "a paragraph.\n\nand another, with an <em>tag</em> in it.";
  expect(cleanObservationBody(clean, NO_ANCHORS)).toEqual({
    body: clean,
    anchors: NO_ANCHORS,
  });
});

// --- the write path ---

test("a created observation is stored clean, with the buried anchors in its frontmatter", async () => {
  const { store, files } = makeStore();
  const entry = await store.create({
    type: "stuck-point",
    summary: "leads with the formula",
    body:
      "worked example with real numbers, not the formula\n" +
      '<parameter name="annotationIds">["ann-9"]</parameter>\n' +
      "</body>",
    anchors: { annotationIds: [], messageIds: ["t-0123456789abcdef"] },
  });

  expect(entry.body).toBe("worked example with real numbers, not the formula");
  expect(entry.anchors).toEqual({
    annotationIds: ["ann-9"],
    messageIds: ["t-0123456789abcdef"],
  });
  const file = files.get(`memory-topic-1/${entry.id}.md`)!;
  expect(file).toContain("annotations: ann-9");
  expect(file).not.toContain("<parameter");
  expect(file).not.toContain("</body>");
});

test("a rewritten body is cleaned on update and its anchors merge in", async () => {
  const { store } = makeStore();
  const entry = await store.create({
    type: "belief",
    summary: "s",
    body: "b",
    anchors: { annotationIds: ["ann-1"], messageIds: [] },
  });
  const updated = await store.update(entry.id, {
    body: 'resolved on 2026-08-27\n<parameter name="annotationIds">["ann-4"]</parameter>',
  });
  expect(updated?.body).toBe("resolved on 2026-08-27");
  expect(updated?.anchors).toEqual({ annotationIds: ["ann-1", "ann-4"], messageIds: [] });
});

// Repairing the 29 entries already on disk is migration work, and a correction
// of some other field must not do it by accident.
test("an update that does not rewrite the body leaves it alone", async () => {
  const { store, files } = makeStore();
  const entry = await store.create({
    type: "belief",
    summary: "s",
    body: "b",
    anchors: { annotationIds: [], messageIds: [] },
  });
  // A file as an older build left it, put back under the store.
  const path = `memory-topic-1/${entry.id}.md`;
  files.set(path, files.get(path)!.replace(/\nb\n/, '\nb\n</body>\n'));

  const updated = await store.update(entry.id, { summary: "s2" });
  expect(updated?.body).toBe("b\n</body>");
  expect(files.get(path)).toContain("</body>");
});
