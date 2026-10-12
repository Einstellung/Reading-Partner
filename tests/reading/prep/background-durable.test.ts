// Lesson prep's tool loops end to end on the durable runtime with the faux
// provider: a chapter note and a long paper's digest run as background
// conversations (legion/durable/background.ts), call their own read tools, and
// leave nothing live.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import { provideBackgroundHost } from "../../../src/legion/durable/background";
import { buildChapterTools, runSpineChapter } from "../../../src/reading/prep/chapters/chapter";
import type { SpineChapter } from "../../../src/reading/prep/chapters/types";
import { runDigest, SHORT_PAPER_MAX } from "../../../src/reading/prep/papers/digest";
import type { PrepPaper } from "../../../src/reading/prep/papers/types";
import { openTestRuntime, type TestRuntime } from "../../legion/durable/support/runtime";

let current: TestRuntime | undefined;
beforeAll(() => provideBackgroundHost(() => (current ? Promise.resolve({ runtime: current.runtime }) : undefined)));
afterAll(() => provideBackgroundHost(() => undefined));

const MODEL = { providerId: "faux" as never, modelId: "faux-1" };
const pages = (n: number): Fulltext => ({
  version: FULLTEXT_VERSION,
  status: "ok",
  pages: Array.from({ length: n }, (_, i) => `Page ${i + 1} text about tides.`),
  outline: [],
});
const read = (name: string, args: Record<string, number | string>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

async function open(responses: Parameters<typeof openTestRuntime>[0]["responses"]): Promise<TestRuntime> {
  current = await openTestRuntime({ root: mkdtempSync(join(tmpdir(), "prep-durable-")), responses });
  return current;
}

async function idle(t: TestRuntime): Promise<boolean> {
  const inspection = await t.runtime.harness.inspect(ctx);
  return inspection.tasks.length === 0 && inspection.submissions.length === 0;
}

const chapter: SpineChapter = { index: 1, title: "Tides", startPage: 1, endPage: 3, status: "running" };

test("a chapter note reads pages through its own tool and comes back trimmed", async () => {
  const t = await open([read("read_pages", { from: 1, to: 2 }), fauxAssistantMessage(fauxText("  The note body.  "))]);
  let chars = 0;
  const note = await runSpineChapter({
    bookName: "Oceans",
    chapter,
    tools: buildChapterTools({ fulltext: pages(3), figures: [], modelSupportsImages: false, renderImage: async () => null }),
    model: MODEL,
    onProgress: (n) => (chars = n),
  });
  expect(note).toBe("The note body.");
  expect(chars).toBeGreaterThan(0);
  expect(t.requests[1]!.join("\n")).toContain("Page 2 text about tides.");
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});

test("an empty chapter note rejects", async () => {
  const t = await open([fauxAssistantMessage(fauxText(""))]);
  const run = runSpineChapter({
    bookName: "Oceans",
    chapter,
    tools: [],
    model: MODEL,
  });
  await expect(run).rejects.toThrow("chapter note came back empty");
  await t.runtime.close(ctx);
});

test("a long paper's digest searches through its own tool and returns the note", async () => {
  const t = await open([read("search_paper", { query: "tides" }), fauxAssistantMessage(fauxText("Digest note."))]);
  const paper: PrepPaper = {
    slug: "tides",
    title: "On Tides",
    authors: ["A. Author"],
    year: 2020,
    arxivId: null,
    citedInChapters: [1],
  } as PrepPaper;
  const note = await runDigest({ paper, surveyName: "Oceans", fulltext: pages(SHORT_PAPER_MAX + 2), model: MODEL });
  expect(note).toBe("Digest note.");
  expect(t.requests).toHaveLength(2);
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});

test("a digest the model fails rejects with the model's error", async () => {
  const t = await open([fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "overloaded" })]);
  const paper = { slug: "x", title: "X", authors: ["A"], year: 2020, arxivId: null, citedInChapters: [1] } as unknown as PrepPaper;
  await expect(runDigest({ paper, surveyName: "S", fulltext: pages(SHORT_PAPER_MAX + 2), model: MODEL })).rejects.toThrow(
    "overloaded",
  );
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});
