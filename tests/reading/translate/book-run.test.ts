// A translation as a legion run (src/reading/translate/book-run.ts, docs/55
// step 11): the task book, the line the run carries, and what the screen makes
// of the record.
//
// Headless. The run store is a Map, the clock is a variable, and the worker is a
// fake that reports the same stages the real one does — the real one opens EPUBs
// and calls a provider, and neither runs under bun. What is tested here is the
// contract between the two: the worker writes sentences, the runner puts the
// last one on the record, and the screen reads it back.
// Run: bash scripts/t.sh tests/reading/translate/book-run.test.ts

import { expect, test } from "bun:test";
import {
  TRANSLATE_KIND,
  failedLine,
  fileToReopen,
  latestTranslateRun,
  openingLine,
  parseReplacement,
  parseTranslateBrief,
  segmentedLine,
  translateView,
  translatedLine,
  type Replacement,
} from "../../../src/reading/translate/book-run";
import { createTranslateWatch } from "../../../src/reading/translate/watch";
import { createRunner, REPORT_THROTTLE_MS } from "../../../src/legion/execute/runner";
import type { WorkerContext, WorkerHandle, WorkerRegistration } from "../../../src/legion/execute/worker";
import { createBellStore } from "../../../src/legion/bell";
import { createRunStore, type Run } from "../../../src/legion/run";
import { mapDisk as disk } from "../../support/map-disk";

const NOW = 1_800_000_000_000;
const TITLE = "How a web page becomes a book";

const REPLACED: Replacement = {
  oldBookId: "b1",
  path: "library/b2/a-zh.epub",
  hash: "b2",
  topicId: "t1",
  bookId: null,
  title: "a-zh",
};

function run(over: Partial<Run> = {}): Run {
  return {
    id: "r-1",
    kind: TRANSLATE_KIND,
    delegator: { kind: "program", name: "translate" },
    brief: "legion/briefs/translate-1.json",
    state: "running",
    attempts: 1,
    createdAt: NOW,
    revision: 1,
    ...over,
  } as Run;
}

// --- the task book ------------------------------------------------------------

test("a task book names the document and the session it was asked in", () => {
  const text = JSON.stringify({
    target: { bookId: "b1", title: TITLE, article: true, home: { kind: "topic", topicId: "t1" } },
    ref: { bookId: "b1", docId: "b1", topicId: "t1", model: { providerId: "anthropic", modelId: "m" } },
  });
  const brief = parseTranslateBrief(text);
  expect(brief.target.title).toBe(TITLE);
  expect(brief.ref.topicId).toBe("t1");
});

test("a task book that is not one is refused where it is read, not where it is used", () => {
  expect(() => parseTranslateBrief("not json")).toThrow("readable JSON");
  expect(() => parseTranslateBrief("{}")).toThrow("names no document");
  expect(() => parseTranslateBrief(JSON.stringify({ target: { bookId: "b1" } }))).toThrow(
    "names no session",
  );
});

test("what a finished run left behind is read back off its output, or nothing is", () => {
  expect(parseReplacement(JSON.stringify(REPLACED))?.hash).toBe("b2");
  expect(parseReplacement("half a fi")).toBeNull();
  expect(parseReplacement(JSON.stringify({ oldBookId: "b1" }))).toBeNull();
  // A document that stands on the shelf in its own right has no topic and says so.
  expect(parseReplacement(JSON.stringify({ ...REPLACED, topicId: undefined }))?.topicId).toBeNull();
});

// --- the line on the run ------------------------------------------------------

test("every line the run carries says which document it is about", () => {
  for (const line of [
    openingLine(TITLE),
    segmentedLine(TITLE, 30),
    translatedLine(TITLE, 12, 30),
    failedLine(TITLE, "the provider would not answer"),
  ]) {
    expect(line).toContain(TITLE);
  }
  expect(segmentedLine(TITLE, 30)).toContain("30 blocks");
  expect(translatedLine(TITLE, 12, 30)).toContain("12/30");
  expect(failedLine(TITLE, "the provider would not answer")).toContain("would not answer");
});

// --- what the screen shows ----------------------------------------------------

test("the translation on screen is the newest one, and only a translation", () => {
  const runs = [
    run({ id: "old", createdAt: NOW - 1000 }),
    run({ id: "other", kind: "research-literature", createdAt: NOW + 1000 }),
    run({ id: "new", createdAt: NOW + 10 }),
  ];
  expect(latestTranslateRun(runs)?.id).toBe("new");
  expect(latestTranslateRun([])).toBeNull();
});

test("the run's own last line is the line on screen", () => {
  expect(translateView(run({ progress: "translated 12/30" }), null)?.text).toBe("translated 12/30");
  // Taken but not started: there is a run and it has said nothing yet.
  expect(translateView(run({ state: "pending", progress: undefined }), null)?.phase).toBe("running");
  expect(translateView(run({ state: "failed", progress: undefined }), null)?.text).toContain(
    "failed",
  );
  // Somebody stopped it and knows they did.
  expect(translateView(run({ state: "cancelled" }), null)).toBeNull();
  expect(translateView(null, null)).toBeNull();
});

test("the replacement is only shown once the run is done", () => {
  expect(translateView(run({ state: "done" }), REPLACED)?.replaced).toEqual(REPLACED);
  expect(translateView(run({ state: "running" }), REPLACED)?.replaced).toBeNull();
});

// --- the worker's stages, through the runner and out to the screen ------------

// Let everything already queued run. The runner writes the terminal state, rings
// a bell and settles its own bookkeeping after the worker's promise, and all of
// it is disk work on a Map: nothing here waits on a timer, only on the queue.
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A runner with one kind on it, and a watch reading what it writes. The worker
 * is driven by hand: every stage the real one reports is a call on `stage`.
 */
function world() {
  const files = new Map<string, string>([["legion/outputs/out.json", JSON.stringify(REPLACED)]]);
  let clock = NOW;
  let ctx: WorkerContext | null = null;
  let settle: ((outcome: { output?: string; progress?: string }) => void) | null = null;
  let reject: ((e: unknown) => void) | null = null;
  let cancels = 0;

  const reg: WorkerRegistration = {
    kind: TRANSLATE_KIND,
    tier: "local",
    run: (_brief: string, given: WorkerContext): WorkerHandle => {
      ctx = given;
      return {
        cancel: () => {
          cancels += 1;
        },
        done: new Promise((resolve, no) => {
          settle = resolve;
          reject = no;
        }),
      };
    },
  };

  const runner = createRunner({
    runs: createRunStore(disk()),
    bells: createBellStore(disk()),
    claims: async () => [],
    deviceId: () => "desk",
    now: () => clock,
    // The table is handed in rather than registered: a kind in the module
    // registry outlives the test file that put it there.
    workers: (kind) => (kind === TRANSLATE_KIND ? reg : null),
  });

  const watch = createTranslateWatch({
    list: () => runner.list({ kind: TRANSLATE_KIND }),
    subscribe: (fn) => runner.subscribe(fn),
    readOutput: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`no ${path}`);
      return text;
    },
  });

  return {
    runner,
    watch,
    cancels: () => cancels,
    tick: (ms: number) => {
      clock += ms;
    },
    stage: async (line: string) => {
      await ctx?.report(line);
      await flush();
    },
    finish: async (outcome: { output?: string; progress?: string }) => {
      settle?.(outcome);
      await flush();
    },
    fail: async (e: unknown) => {
      reject?.(e);
      await flush();
    },
    start: async () => {
      const result = await runner.delegate({
        kind: TRANSLATE_KIND,
        delegator: { kind: "program", name: "translate" },
        brief: "legion/briefs/translate-1.json",
        deliverTo: JSON.stringify({ place: "book", bookId: "b1", threadId: "t" }),
      });
      await flush();
      return result;
    },
  };
}

test("the turn is handed a run id and does not wait for the translation", async () => {
  const w = world();
  const seen: string[] = [];
  w.watch.subscribe(() => seen.push("x"));
  const result = await w.start();
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The run is running and nothing has settled it: this is what the tool answers on.
  expect(w.runner.active()).toEqual([result.run.id]);
  expect((await w.runner.list({ kind: TRANSLATE_KIND }))[0]?.state).toBe("running");
});

test("each stage the worker reports is the line the screen shows", async () => {
  const w = world();
  let notified = 0;
  w.watch.subscribe(() => {
    notified += 1;
  });
  await w.start();

  await w.stage(openingLine(TITLE));
  expect(w.watch.snapshot()?.text).toBe(openingLine(TITLE));

  // Inside the throttle window: the worker said it, the disk did not hear it.
  await w.stage(segmentedLine(TITLE, 30));
  expect(w.watch.snapshot()?.text).toBe(openingLine(TITLE));

  w.tick(REPORT_THROTTLE_MS + 1);
  await w.stage(translatedLine(TITLE, 12, 30));
  expect(w.watch.snapshot()?.text).toBe(translatedLine(TITLE, 12, 30));
  expect(w.watch.snapshot()?.phase).toBe("running");
  expect(notified).toBeGreaterThan(0);
});

test("a finished run hands the screen the document that replaced the original", async () => {
  const w = world();
  w.watch.subscribe(() => {});
  await w.start();
  await w.stage(openingLine(TITLE));
  await w.finish({ output: "legion/outputs/out.json", progress: "A bilingual copy is on the shelf." });

  const view = w.watch.snapshot();
  expect(view?.phase).toBe("done");
  expect(view?.text).toBe("A bilingual copy is on the shelf.");
  expect(view?.replaced).toEqual(REPLACED);
  expect(fileToReopen(view, "b1")?.hash).toBe("b2");

  // Dismissed, and not shown again.
  w.watch.dismiss(view?.runId ?? "");
  await flush();
  expect(w.watch.snapshot()).toBeNull();
});

test("a run that came apart keeps the reason it last reported", async () => {
  const w = world();
  w.watch.subscribe(() => {});
  await w.start();
  // Three attempts, each one reporting why before it throws, as the worker does.
  for (let i = 0; i < 3; i += 1) {
    w.tick(REPORT_THROTTLE_MS + 1);
    await w.stage(failedLine(TITLE, "the provider would not answer"));
    await w.fail(new Error("the provider would not answer"));
  }
  const view = w.watch.snapshot();
  expect(view?.phase).toBe("failed");
  expect(view?.text).toContain("would not answer");
  expect(view?.replaced).toBeNull();
});

test("cancelling a run reaches the worker and takes the line off the screen", async () => {
  const w = world();
  w.watch.subscribe(() => {});
  const result = await w.start();
  if (!result.ok) throw new Error("the run was refused");
  await w.stage(openingLine(TITLE));
  await w.runner.cancel(result.run.id);
  expect(w.cancels()).toBe(1);
  await w.fail(new Error("aborted"));
  expect(w.watch.snapshot()).toBeNull();
});
