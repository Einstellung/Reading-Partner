// What translate_document says back, in each of the cases it can land in, and
// what the reader is moved onto when a run finishes.
// Run: bash scripts/t.sh tests/reading/translate/tool.test.ts

import { expect, test } from "bun:test";
import {
  buildTranslateTools,
  type TranslateTarget,
  type TranslateToolDeps,
} from "../../../src/reading/translate/tool";
import { fileToReopen, type TranslateView } from "../../../src/reading/translate/book-run";
import { toolText } from "../../support/tool-text";

const ARTICLE: TranslateTarget = {
  bookId: "b1",
  title: "How a web page becomes a book",
  article: true,
  home: { kind: "topic", topicId: "t1" },
};

function tool(over: Partial<TranslateToolDeps> = {}): {
  run: (document?: string) => Promise<string>;
  started: TranslateTarget[];
} {
  const started: TranslateTarget[] = [];
  const deps: TranslateToolDeps = {
    find: async () => ARTICLE,
    start: async (target) => {
      started.push(target);
      return { ok: true, runId: "r-1" };
    },
    busy: async () => false,
    ...over,
  };
  const [t] = buildTranslateTools(deps);
  return {
    run: async (document) =>
      String(toolText(await t.execute(document === undefined ? {} : { document }))),
    started,
  };
}

test("an article starts translating and the turn comes back at once", async () => {
  const { run, started } = tool();
  const said = await run();
  expect(said).toContain("Started translating");
  expect(said).toContain("r-1");
  expect(started).toEqual([ARTICLE]);
});

// The turn does not open the document, so a translation is handed over before
// anything is known about it: the run is written, and the reader waits on
// nothing. Whether there is anything in it to translate is the worker's answer.
test("nothing is read off the shelf before the run is written", async () => {
  let opened = false;
  const { run } = tool({
    find: async () => {
      opened = true;
      return ARTICLE;
    },
  });
  await run();
  expect(opened).toBe(true);
});

test("a PDF or a book is refused in one sentence, with nothing started", async () => {
  const { run, started } = tool({
    find: async () => ({ ...ARTICLE, article: false, title: "Attention Is All You Need" }),
  });
  const said = await run();
  expect(said).toContain("not a web article");
  expect(started).toEqual([]);
});

test("a second request while one is running is refused", async () => {
  const { run, started } = tool({ busy: async () => true });
  expect(await run()).toContain("already running");
  expect(started).toEqual([]);
});

test("a runner that refused the run says why, in its own words", async () => {
  const { run } = tool({
    start: async () => ({ ok: false, reason: "no worker is registered for the kind translate-book" }),
  });
  expect(await run()).toContain("no worker is registered");
});

test("a name nothing answers to is said back", async () => {
  const { run } = tool({ find: async () => null });
  expect(await run("The Selfish Gene")).toContain('"The Selfish Gene"');
  const { run: bare } = tool({ find: async () => null });
  expect(await bare()).toContain("no document open");
});

// --- the hand-off onto the translation ---------------------------------------

const DONE: TranslateView = {
  runId: "r-1",
  phase: "done",
  text: "A paper is now bilingual.",
  replaced: { oldBookId: "b1", path: "library/b2/a-zh.epub", hash: "b2", topicId: "t1" },
};

test("the reader is moved onto the translation only when it replaced what they had open", () => {
  expect(fileToReopen(DONE, "b1")?.hash).toBe("b2");
  expect(fileToReopen(DONE, "other")).toBeNull();
  expect(fileToReopen(DONE, null)).toBeNull();
  expect(fileToReopen(null, "b1")).toBeNull();
  expect(fileToReopen({ ...DONE, phase: "running" }, "b1")).toBeNull();
  expect(fileToReopen({ ...DONE, phase: "failed" }, "b1")).toBeNull();
  // A run whose output has not been read back yet moves nobody.
  expect(fileToReopen({ ...DONE, replaced: null }, "b1")).toBeNull();
});
