// What translate_document says back, in each of the cases it can land in, and
// what the reader is moved onto when a run finishes.
// Run: bash scripts/t.sh tests/reading/translate/tool.test.ts

import { expect, test } from "bun:test";
import {
  buildTranslateTools,
  type TranslateTarget,
  type TranslateToolDeps,
} from "../../../src/reading/translate/tool";
import { fileToReopen, type TranslateState } from "../../../src/reading/translate/run";

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
    inspect: async () => ({ blocks: 30, translated: false }),
    start: (target) => started.push(target),
    busy: () => false,
    ...over,
  };
  const [t] = buildTranslateTools(deps);
  return {
    run: async (document) =>
      String(await t.execute(document === undefined ? {} : { document })),
    started,
  };
}

test("an article starts translating and the turn comes back at once", async () => {
  const { run, started } = tool();
  const said = await run();
  expect(said).toContain("Started translating");
  expect(said).toContain("30 blocks");
  expect(started).toEqual([ARTICLE]);
});

test("a PDF or a book is refused in one sentence, with nothing started", async () => {
  const { run, started } = tool({
    find: async () => ({ ...ARTICLE, article: false, title: "Attention Is All You Need" }),
  });
  const said = await run();
  expect(said).toContain("not a web article");
  expect(started).toEqual([]);
});

test("a document that is already bilingual is not translated again", async () => {
  const { run, started } = tool({ inspect: async () => ({ blocks: 0, translated: true }) });
  expect(await run()).toContain("already bilingual");
  expect(started).toEqual([]);
});

test("a second request while one is running is refused", async () => {
  const { run, started } = tool({ busy: () => true });
  expect(await run()).toContain("already running");
  expect(started).toEqual([]);
});

test("a name nothing answers to is said back", async () => {
  const { run } = tool({ find: async () => null });
  expect(await run("The Selfish Gene")).toContain('"The Selfish Gene"');
  const { run: bare } = tool({ find: async () => null });
  expect(await bare()).toContain("no document open");
});

// --- the hand-off onto the translation ---------------------------------------

const DONE: TranslateState = {
  phase: "done",
  title: "A paper",
  done: 30,
  total: 30,
  message: "",
  replaced: { oldBookId: "b1", path: "library/b2/a-zh.epub", hash: "b2", topicId: "t1" },
};

test("the reader is moved onto the translation only when it replaced what they had open", () => {
  expect(fileToReopen(DONE, "b1")?.hash).toBe("b2");
  expect(fileToReopen(DONE, "other")).toBeNull();
  expect(fileToReopen(DONE, null)).toBeNull();
  expect(fileToReopen({ ...DONE, phase: "running" }, "b1")).toBeNull();
  expect(fileToReopen({ ...DONE, phase: "failed" }, "b1")).toBeNull();
});
