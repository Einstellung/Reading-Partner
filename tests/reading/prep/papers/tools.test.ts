// The classroom tools over prep artefacts (src/reading/prep/tools.ts): what
// read_paper and read_note actually hand the model. Both were reworded so that
// every anchor the model sees is one it can copy verbatim and have work. Run:
// bun test.

import { beforeEach, expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../../../src/fulltext/types";
import { saveFulltext } from "../../../../src/fulltext/store";
import { buildClassroomTools } from "../../../../src/reading/prep/papers/tools";
import { paperFulltextHash, writePrepNote } from "../../../../src/reading/prep/papers/store";
import type { PrepPaper, PrepState } from "../../../../src/reading/prep/papers/types";
import { installAppData } from "../../../support/appdata-fake";

// An empty in-memory AppData, so the note and the cached full text this file
// writes are the ones the tools read back.
beforeEach(() => {
  installAppData();
});

const SURVEY = "survey-hash";
const SLUG = "dream-to-control-learning-behaviors-by-latent-imag";

function paper(over: Partial<PrepPaper> = {}): PrepPaper {
  return { slug: SLUG, title: "Dream to Control", status: "done", ...over } as PrepPaper;
}

function state(over: Partial<PrepState> = {}): PrepState {
  return { surveyHash: SURVEY, papers: [paper()], ...over } as PrepState;
}

function tool(name: string, states: PrepState[] = [state()]) {
  return buildClassroomTools(() => states).find((t) => t.name === name)!;
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

// A retell holds several materials, each with its own prep run, and the tools
// are mounted once over all of them.
const OTHER = "other-survey-hash";
const OTHER_SLUG = "world-models";

test("a slug is resolved against every prep run, and they all list their slugs", async () => {
  await writePrepNote(OTHER, OTHER_SLUG, "---\ntitle: World Models\n---\n\nA latent dream [p.1].\n");
  const states = [
    state(),
    state({
      surveyHash: OTHER,
      papers: [paper({ slug: OTHER_SLUG, title: "World Models" })],
    }),
  ];
  const read = tool("read_note", states);
  expect(String(await read.execute({ slug: OTHER_SLUG }))).toBe(`A latent dream [${OTHER_SLUG} p.1].`);
  const missing = String(await read.execute({ slug: "nope" }));
  expect(missing).toContain(SLUG);
  expect(missing).toContain(OTHER_SLUG);
});

// The same paper is routinely prepped under two materials. Both copies are the
// same paper read twice, so the first run answers and which one it was cannot
// show.
test("a slug in two prep runs is answered from the first of them", async () => {
  await writePrepNote(SURVEY, SLUG, "---\ntitle: t\n---\n\nfrom the first run.\n");
  await writePrepNote(OTHER, SLUG, "---\ntitle: t\n---\n\nfrom the second run.\n");
  const states = [state(), state({ surveyHash: OTHER })];
  expect(String(await tool("read_note", states).execute({ slug: SLUG }))).toBe("from the first run.");
  expect(String(await tool("read_note", states.slice().reverse()).execute({ slug: SLUG }))).toBe(
    "from the second run.",
  );
});
