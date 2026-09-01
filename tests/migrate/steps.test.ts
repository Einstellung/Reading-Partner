// The six migration steps, one at a time, over the in-memory store. Every step
// is run twice: the second run has to find nothing, because the engine's whole
// safety argument is that it is self-detecting rather than flag-driven.
// Run: bun test.

import { expect, test } from "bun:test";
import { parseObservation, parseTombstones } from "../../src/memory/observations/files";
import { deriveMessageId, deriveObservationId } from "../../src/migrate/hash";
import {
  stepCleanBodies,
  stepComposeAnchors,
  stepMessageIds,
  stepParentAnchors,
  stepTypoAnchors,
  planWidening,
  stepWidenObservationIds,
} from "../../src/migrate/steps";
import type { MigrationFs } from "../../src/migrate/types";
import {
  ASIDE,
  BOOK,
  DIR,
  LESSON,
  makeMemFs,
  makeStore,
  TS_ASIDE,
  TS_LESSON,
  TS_TIE,
} from "./fixture";

async function anchorsOf(fs: MigrationFs, id: string): Promise<string[]> {
  const text = await fs.read(`${DIR}/${id}.md`);
  return parseObservation(text ?? "")?.anchors.messageIds ?? [];
}

test("step 1 moves an anchor off the parent thread onto the thread that holds it", async () => {
  const { fs } = makeStore();
  const step = await stepParentAnchors(fs);
  expect(step.changed).toBe(1);
  expect(await anchorsOf(fs, "m-aaaaaa01")).toEqual([`${ASIDE}:${TS_ASIDE}`]);
  // The mistyped one is not this step's shape and is left, not guessed at.
  expect(step.counts.leftToAnotherStep).toBe(1);
  expect(step.unrepaired).toEqual([]);
  expect((await stepParentAnchors(fs)).changed).toBe(0);
});

test("step 1 refuses a stamp two threads share", async () => {
  const shared = 1786600009000;
  const { fs } = makeMemFs({
    [`threads-${BOOK}.json`]: JSON.stringify({
      threads: {
        [LESSON]: { id: LESSON, messages: [{ role: "user", text: "a", ts: shared }] },
        [ASIDE]: {
          id: ASIDE,
          parentThreadId: LESSON,
          messages: [{ role: "user", text: "b", ts: shared }],
        },
      },
    }),
    [`${DIR}/m-aaaaaa01.md`]: `---\nid: m-aaaaaa01\ntype: belief\nsummary: s\nmessages: unknown-thread:${shared}\n---\n\nbody\n`,
  });
  const step = await stepParentAnchors(fs);
  expect(step.changed).toBe(0);
  expect(step.unrepaired[0].why).toContain("2 threads");
  expect(await anchorsOf(fs, "m-aaaaaa01")).toEqual([`unknown-thread:${shared}`]);
});

test("step 2 repairs the two-character thread id and drops the invented anchor", async () => {
  const { fs } = makeStore();
  await stepParentAnchors(fs);
  const step = await stepTypoAnchors(fs);
  expect(step.counts.dropped).toBe(1);
  expect(await anchorsOf(fs, "m-aaaaaa02")).toEqual([`${LESSON}:${TS_LESSON}`]);
  expect(await anchorsOf(fs, "m-aaaaaa03")).toEqual([`${LESSON}:${TS_LESSON}`]);
  expect((await stepTypoAnchors(fs)).changed).toBe(0);
});

test("step 2 does not generalise into fuzzy matching", async () => {
  // Same stamp, a thread id that is nothing like the real one: reported, not
  // repaired, however unambiguous the stamp is.
  const { fs } = makeMemFs({
    [`threads-${BOOK}.json`]: JSON.stringify({
      threads: { [LESSON]: { id: LESSON, messages: [{ role: "user", text: "a", ts: TS_LESSON }] } },
    }),
    [`${DIR}/m-aaaaaa01.md`]: `---\nid: m-aaaaaa01\ntype: belief\nsummary: s\nmessages: 99999999-9999-4999-8999-999999999999:${TS_LESSON}\n---\n\nbody\n`,
  });
  const step = await stepTypoAnchors(fs);
  expect(step.changed).toBe(0);
  expect(step.unrepaired[0].why).toContain("near miss");
});

test("step 3 derives every message id from thread, stamp and role", async () => {
  const { fs } = makeStore();
  const step = await stepMessageIds(fs);
  expect(step.changed).toBe(6);
  expect(step.aborted).toBeUndefined();
  const file = JSON.parse((await fs.read(`threads-${BOOK}.json`)) ?? "{}") as {
    threads: Record<string, { messages: { id: string; role: string; ts: number }[] }>;
  };
  const lesson = file.threads[LESSON].messages;
  expect(lesson[2].id).toBe(deriveMessageId(LESSON, TS_TIE, "user"));
  expect(lesson[3].id).toBe(deriveMessageId(LESSON, TS_TIE, "ai"));
  // The pair naming two messages is exactly why the role is in the derivation.
  expect(lesson[2].id).not.toBe(lesson[3].id);
  expect((await stepMessageIds(fs)).changed).toBe(0);
});

test("step 3 keeps every key it does not know", async () => {
  const { fs } = makeMemFs({
    [`threads-${BOOK}.json`]: JSON.stringify({
      threads: {
        [LESSON]: {
          id: LESSON,
          messages: [
            { role: "ai", text: "a", ts: TS_LESSON, parts: [{ type: "text", text: "a" }] },
          ],
        },
      },
    }),
  });
  await stepMessageIds(fs);
  const text = (await fs.read(`threads-${BOOK}.json`)) ?? "";
  expect(text).toContain('"parts"');
});

test("step 3 backfills a thread id that several files share", async () => {
  // The info companion's daily briefing conversation is the literal thread id
  // "briefing", one file per day: 25 files on the owner's store hold one, and
  // an index keyed by id alone would see one of them.
  const { fs } = makeMemFs({
    "threads-info-2026-08-01.json": JSON.stringify({
      threads: { briefing: { id: "briefing", messages: [{ role: "user", text: "a", ts: 1 }] } },
    }),
    "threads-info-2026-08-02.json": JSON.stringify({
      threads: { briefing: { id: "briefing", messages: [{ role: "user", text: "b", ts: 2 }] } },
    }),
  });
  const step = await stepMessageIds(fs);
  expect(step.changed).toBe(2);
  expect((await fs.read("threads-info-2026-08-01.json")) ?? "").toContain(
    deriveMessageId("briefing", 1, "user"),
  );
  expect((await fs.read("threads-info-2026-08-02.json")) ?? "").toContain(
    deriveMessageId("briefing", 2, "user"),
  );
});

test("step 4 refuses a stamp two threads sharing an id both hold", async () => {
  const { fs } = makeMemFs({
    "threads-info-2026-08-01.json": JSON.stringify({
      threads: { briefing: { id: "briefing", messages: [{ role: "user", text: "a", ts: 5 }] } },
    }),
    "threads-info-2026-08-02.json": JSON.stringify({
      threads: { briefing: { id: "briefing", messages: [{ role: "user", text: "b", ts: 5 }] } },
    }),
    [`${DIR}/m-aaaaaa01.md`]: `---\nid: m-aaaaaa01\ntype: belief\nsummary: s\nmessages: briefing:5\n---\n\nbody\n`,
  });
  await stepMessageIds(fs);
  const step = await stepComposeAnchors(fs);
  expect(step.changed).toBe(0);
  expect(step.unrepaired[0].why).toContain("sharing an id");
});

test("step 3 reports a collision rather than papering over it", async () => {
  // Two messages that are the same thread, stamp and role: the derivation
  // cannot tell them apart, so nothing is written at all.
  const { fs, files } = makeMemFs({
    [`threads-${BOOK}.json`]: JSON.stringify({
      threads: {
        [LESSON]: {
          id: LESSON,
          messages: [
            { role: "user", text: "a", ts: TS_LESSON },
            { role: "user", text: "b", ts: TS_LESSON },
          ],
        },
      },
    }),
  });
  const before = files.get(`threads-${BOOK}.json`);
  const step = await stepMessageIds(fs);
  expect(step.aborted).toContain("more than one message");
  expect(step.changed).toBe(0);
  expect(files.get(`threads-${BOOK}.json`)).toBe(before);
});

test("step 4 composes the anchor and counts the precision that was lost", async () => {
  const { fs } = makeStore();
  await stepParentAnchors(fs);
  await stepTypoAnchors(fs);
  await stepMessageIds(fs);
  const step = await stepComposeAnchors(fs);
  expect(step.changed).toBe(4);
  // The pair that names a user turn and its reply resolves to the user turn,
  // and is counted, because that is what was permanently lost.
  expect(step.counts.resolvedToUserTurn).toBe(1);
  expect(await anchorsOf(fs, "m-aaaaaa04")).toEqual([
    `${deriveMessageId(LESSON, TS_TIE, "user")}@${LESSON}:${TS_TIE}`,
  ]);
  expect(await anchorsOf(fs, "m-aaaaaa01")).toEqual([
    `${deriveMessageId(ASIDE, TS_ASIDE, "user")}@${ASIDE}:${TS_ASIDE}`,
  ]);
  expect((await stepComposeAnchors(fs)).changed).toBe(0);
});

test("step 4 refuses an anchor whose messages have no id yet", async () => {
  const { fs } = makeStore();
  const step = await stepComposeAnchors(fs);
  expect(step.changed).toBe(0);
  expect(step.unrepaired.some((r) => r.why.includes("backfill"))).toBe(true);
});

test("step 5 cleans the body and lifts the buried anchors into the frontmatter", async () => {
  const { fs } = makeStore();
  await stepParentAnchors(fs);
  await stepTypoAnchors(fs);
  await stepMessageIds(fs);
  await stepComposeAnchors(fs);
  const step = await stepCleanBodies(fs);
  expect(step.changed).toBe(1);
  expect(step.counts.annotationIdsRecovered).toBe(1);
  expect(step.counts.messageAnchorsRecovered).toBe(1);
  const entry = parseObservation((await fs.read(`${DIR}/m-aaaaaa05.md`)) ?? "");
  expect(entry?.body).toBe("The reader stalled on the positional encoding.");
  expect(entry?.anchors.annotationIds).toEqual(["ann-buried"]);
  // An anchor recovered here has never been through steps 1, 2 and 4, so it is
  // normalised on the spot — otherwise one pass would not be a fixed point.
  expect(entry?.anchors.messageIds).toEqual([
    `${deriveMessageId(ASIDE, TS_ASIDE, "user")}@${ASIDE}:${TS_ASIDE}`,
  ]);
  expect((await stepCleanBodies(fs)).changed).toBe(0);
});

test("step 6 widens the ids everywhere they appear", async () => {
  const { fs, files } = makeStore();
  const step = await stepWidenObservationIds(fs);
  expect(step.aborted).toBeUndefined();
  const wide = deriveObservationId("m-aaaaaa01");
  expect(files.has(`${DIR}/${wide}.md`)).toBe(true);
  expect(files.has(`${DIR}/m-aaaaaa01.md`)).toBe(false);
  // The entry states its own id in its frontmatter, and it moved too.
  expect(parseObservation(files.get(`${DIR}/${wide}.md`) ?? "")?.id).toBe(wide);
  // The conflict copy travels with the entry it is a copy of.
  expect(files.has(`${DIR}/${wide}.conflict-deadbeef.md`)).toBe(true);
  // A mention mid-prose is a link and moves with its target.
  expect(files.get(`${DIR}/${wide}.md`)).toContain(deriveObservationId("m-aaaaaa02"));
  expect(step.counts.mentionsRewritten).toBe(2);
  // The tombstone gains the widened id and keeps the narrow line: an existing
  // record is never rewritten, or the sync merge would keep both versions.
  const tombstones = parseTombstones(files.get(`${DIR}/deleted-observations.jsonl`) ?? "");
  expect(tombstones.has("m-aaaaaa09")).toBe(true);
  expect(tombstones.has(deriveObservationId("m-aaaaaa09"))).toBe(true);
  // The index is derived and was rebuilt from the renamed files.
  expect(files.get(`${DIR}/index.md`)).toContain(wide);
  expect(files.get(`${DIR}/index.md`)).not.toContain("m-aaaaaa01 ");
  expect((await stepWidenObservationIds(fs)).changed).toBe(0);
});

test("step 6 refuses a map in which two ids derive to one", async () => {
  // With the real hash, two of the store's ids colliding is a 2^-64 event no
  // fixture can build, so the refusal is exercised over the map builder with a
  // derivation that does collide. What it protects: two observations landing in
  // one file, and the step is all-or-nothing because nothing here is per-file.
  const plan = planWidening(["m-aaaaaa01", "m-aaaaaa02"], () => "m-0000000000000000");
  expect(plan.map.size).toBe(1);
  expect(plan.collisions[0].why).toContain("derived from both");
});

test("step 6 finishes a rename that died between the write and the remove", async () => {
  const wide = deriveObservationId("m-aaaaaa01");
  const { fs, files } = makeMemFs({
    [`${DIR}/m-aaaaaa01.md`]: `---\nid: m-aaaaaa01\ntype: belief\nsummary: stale\n---\n\nbody\n`,
    // Already there from the run that died, and rewritten since on the device
    // that did migrate. It is not overwritten with the narrow one's bytes.
    [`${DIR}/${wide}.md`]: `---\nid: ${wide}\ntype: belief\nsummary: newer\n---\n\nbody\n`,
  });
  const step = await stepWidenObservationIds(fs);
  expect(step.aborted).toBeUndefined();
  expect(files.has(`${DIR}/m-aaaaaa01.md`)).toBe(false);
  expect(parseObservation(files.get(`${DIR}/${wide}.md`) ?? "")?.summary).toBe("newer");
  expect(step.counts.alreadyRenamed).toBe(1);
});
