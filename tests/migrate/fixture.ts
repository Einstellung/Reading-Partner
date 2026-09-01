// A store in the shape the owner's real one has, built in memory. Every
// migration test runs against this; nothing ever reads or writes the real
// AppData directory.

import { serializeObservation } from "../../src/memory/observations/files";
import type { Observation } from "../../src/memory/observations/types";
import type { MigrationFs } from "../../src/migrate/types";

export function makeMemFs(initial: Record<string, string> = {}): {
  fs: MigrationFs;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  const fs: MigrationFs = {
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async remove(path) {
      files.delete(path);
    },
    async listDir(dir) {
      const prefix = dir === "" ? "" : `${dir}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest && !rest.includes("/")) names.add(rest);
      }
      return [...names].sort();
    },
    async listSubdirs(dir) {
      const prefix = dir === "" ? "" : `${dir}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const at = rest.indexOf("/");
        if (at > 0) names.add(rest.slice(0, at));
      }
      return [...names].sort();
    },
  };
  return { fs, files };
}

// An fs that fails on the nth write, standing in for a run that dies halfway.
export function makeFlakyFs(fs: MigrationFs, failOnWrite: number): MigrationFs {
  let writes = 0;
  return {
    ...fs,
    async write(path, content) {
      writes++;
      if (writes === failOnWrite) throw new Error(`write ${writes} failed`);
      await fs.write(path, content);
    },
  };
}

export const LESSON = "11111111-1111-4111-8111-a34a7e70b5b0";
// Two characters off LESSON, the shape of the two mistyped anchors on the real
// store (…a34a7e59b5b0 for …a34a7e70b5b0).
export const LESSON_TYPO = "11111111-1111-4111-8111-a34a7e59b5b0";
export const ASIDE = "22222222-2222-4222-8222-222222222222";
export const BOOK = "abc123";
export const TOPIC = "topic-1";
export const DIR = `memory-${TOPIC}`;

export const TS_LESSON = 1786600000000;
// A user turn and its reply appended in the same millisecond — 153 pair keys on
// the real store look like this.
export const TS_TIE = 1786600001000;
// A message that lives in the aside, which the arrears renderer printed with
// the lesson's id.
export const TS_ASIDE = 1786600002000;

export function threadFile(): string {
  return JSON.stringify(
    {
      threads: {
        [LESSON]: {
          id: LESSON,
          annotationId: "",
          book: true,
          path: BOOK,
          createdAt: TS_LESSON - 1000,
          messages: [
            { role: "user", text: "why is this add and not concat", ts: TS_LESSON },
            { role: "ai", text: "because the dimensions have to survive", ts: TS_LESSON + 1 },
            { role: "user", text: "say that again", ts: TS_TIE },
            { role: "ai", text: "the residual stream is one width", ts: TS_TIE },
          ],
        },
        [ASIDE]: {
          id: ASIDE,
          annotationId: "",
          parentThreadId: LESSON,
          path: BOOK,
          createdAt: TS_ASIDE - 1000,
          messages: [
            { role: "user", text: "and the positional part", ts: TS_ASIDE },
            { role: "ai", text: "same width, added in", ts: TS_ASIDE + 1 },
          ],
        },
      },
    },
    null,
    2,
  );
}

export function observation(over: Partial<Observation> & { id: string }): Observation {
  return {
    type: "stuck-point",
    summary: "one line",
    body: "a body",
    created: "2026-08-01",
    updated: "2026-08-02",
    anchors: { annotationIds: [], messageIds: [] },
    ...over,
  };
}

// Assembled rather than written as literals, so this file holds no text that
// reads as a tool call.
const OPEN = (name: string): string => `<${"parameter"} name="${name}">`;
const CLOSE = `</${"parameter"}>`;

// A body a model wrote while it was mid-tool-call: the XML leaked into the
// prose and took two anchors with it that never reached the frontmatter.
export const DIRTY_BODY = [
  "The reader stalled on the positional encoding.",
  "",
  `${OPEN("annotationIds")}["ann-buried"]${CLOSE}`,
  `${OPEN("messageIds")}["${LESSON}:${TS_ASIDE}"]${CLOSE}`,
  `</${"invoke"}>`,
].join("\n");

// The whole store: one book's threads, one topic's observations, one tombstone,
// one conflict copy.
export function makeStore(): { fs: MigrationFs; files: Map<string, string> } {
  const entries: Observation[] = [
    // The parent case: the anchor names the lesson, the message is in the aside.
    observation({
      id: "m-aaaaaa01",
      summary: "printed with the unit's own thread id",
      body: "the reader is stuck on the added positional vector, see m-aaaaaa02",
      anchors: { annotationIds: ["ann-1"], messageIds: [`${LESSON}:${TS_ASIDE}`] },
    }),
    // The typo case: two characters off a real thread id, stamp resolves there.
    observation({
      id: "m-aaaaaa02",
      summary: "a thread id copied wrong",
      body: "nothing to clean here",
      anchors: { annotationIds: [], messageIds: [`${LESSON_TYPO}:${TS_LESSON}`] },
    }),
    // The invented anchor, beside one ordinary pair that already resolves.
    observation({
      id: "m-aaaaaa03",
      summary: "an anchor the model made up",
      body: "prose",
      anchors: {
        annotationIds: [],
        messageIds: ["msg-user-invented", `${LESSON}:${TS_LESSON}`],
      },
    }),
    // The tie: the pair names a user turn and its reply.
    observation({
      id: "m-aaaaaa04",
      summary: "a pair naming two messages",
      body: "prose",
      anchors: { annotationIds: [], messageIds: [`${LESSON}:${TS_TIE}`] },
    }),
    // The dirty body, with two anchors buried in the leaked XML.
    observation({
      id: "m-aaaaaa05",
      summary: "residue",
      body: DIRTY_BODY,
      anchors: { annotationIds: [], messageIds: [] },
    }),
  ];
  const files: Record<string, string> = {
    [`threads-${BOOK}.json`]: threadFile(),
    [`${DIR}/deleted-observations.jsonl`]: `{"id":"m-aaaaaa09","at":"2026-08-20"}\n`,
    // A conflict copy sync left beside an entry.
    [`${DIR}/m-aaaaaa01.conflict-deadbeef.md`]: serializeObservation(
      observation({
        id: "m-aaaaaa01",
        summary: "the other device's version",
        body: "see m-aaaaaa04",
      }),
    ),
    [`${DIR}/meta.json`]: JSON.stringify({ lastDistilledAt: null, lastAnnotationDistillAt: null }),
  };
  for (const entry of entries) files[`${DIR}/${entry.id}.md`] = serializeObservation(entry);
  return makeMemFs(files);
}
