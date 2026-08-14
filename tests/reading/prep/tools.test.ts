// The classroom tools over prep artefacts (src/reading/prep/tools.ts): what
// read_paper and read_note actually hand the model. Both were reworded so that
// every anchor the model sees is one it can copy verbatim and have work. Run:
// bun test.

import { expect, test } from "bun:test";
import { mock } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import type { PrepPaper, PrepState } from "../../../src/reading/prep/types";
import { makeAppData } from "../../support/appdata";

// An empty in-memory AppData so the note and the cached full text this file
// writes are the ones the tools read back. atomic-fs goes in whole for the same
// reason turn.test.ts does it (mock.module is process-wide).
const app = makeAppData();
mock.module("@tauri-apps/plugin-fs", () => app.pluginFs);
mock.module("@tauri-apps/api/core", () => app.core);
mock.module("../../../src/platform/app/atomic-fs", () => app.atomicFs);

const { buildClassroomTools } = await import("../../../src/reading/prep/tools");
const { paperFulltextHash, writePrepNote } = await import("../../../src/reading/prep/store");
const { saveFulltext } = await import("../../../src/fulltext/store");

const SURVEY = "survey-hash";
const SLUG = "dream-to-control-learning-behaviors-by-latent-imag";

function paper(over: Partial<PrepPaper> = {}): PrepPaper {
  return { slug: SLUG, title: "Dream to Control", status: "done", ...over } as PrepPaper;
}

function state(over: Partial<PrepState> = {}): PrepState {
  return { surveyHash: SURVEY, papers: [paper()], ...over } as PrepState;
}

function tool(name: string) {
  return buildClassroomTools(() => state()).find((t) => t.name === name)!;
}

test("read_paper labels every page with the citation for that page", async () => {
  await saveFulltext(paperFulltextHash(SURVEY, SLUG), {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: ["latent imagination", "actor critic"],
    outline: [],
  } satisfies Fulltext);
  const out = (await tool("read_paper").execute({ slug: SLUG, from: 1, to: 2 })) as string;
  // Told only the slug, the model abbreviated it to [dream-to-control], which
  // links to nothing. The anchor it should write is in front of it now.
  expect(out).toContain(`=== Page 1 === [${SLUG} p.1]`);
  expect(out).toContain(`=== Page 2 === [${SLUG} p.2]`);
});

test("read_note drops the writer's aside and names the paper its pages belong to", async () => {
  await writePrepNote(
    SURVEY,
    SLUG,
    "---\ntitle: Dream to Control\n---\n\nI have everything I need to write the note.\n\n" +
      "The agent learns in latent space [p.2] over a horizon [p.3-4].\n",
  );
  const out = (await tool("read_note").execute({ slug: SLUG })) as string;
  expect(out).toBe(
    `The agent learns in latent space [${SLUG} p.2] over a horizon [${SLUG} p.3-4].`,
  );
});

test("an unknown slug lists what is available instead of returning nothing", async () => {
  const out = (await tool("read_note").execute({ slug: "dream-to-control" })) as string;
  expect(out).toContain('No prepped paper with slug "dream-to-control"');
  expect(out).toContain(SLUG);
});
