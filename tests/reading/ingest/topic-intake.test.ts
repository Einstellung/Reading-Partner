// A link taken in with no book (src/reading/ingest/topic-intake.ts and the
// intake half of url-worker.ts): the ask names an intake, the run files into the
// library attached nowhere and records what it filed, and the reader's pick
// attaches it whichever comes first. The intake store runs for real over memory;
// the fetch, the text cutting and the runner are injected.
// Run: scripts/t.sh tests/reading/ingest/topic-intake.test.ts

import { expect, test } from "bun:test";
import { ingestUrlWorker, type IngestUrlWorkerDeps } from "../../../src/reading/ingest/url-worker";
import { INGEST_URL_KIND, type IngestAsk } from "../../../src/reading/ingest/url-run";
import { chooseIntakeTopic, readIntake, startTopicIntake } from "../../../src/reading/ingest/topic-intake";
import type { IngestedDocument, IngestTarget } from "../../../src/reading/ingest/article";
import type { IngestBatch } from "../../../src/reading/ingest/link-intake";
import type { WorkerContext } from "../../../src/legion/execute/worker";
import type { Fulltext } from "../../../src/fulltext/types";
import type { Run } from "../../../src/legion/run";
import { GiveUpError } from "../../../src/legion/stop";
import { memoryIntakes } from "./intake-fixtures";

const ASK = "legion/briefs/ingest-1.json";

function context(attempts = 1): { ctx: WorkerContext; reported: string[] } {
  const reported: string[] = [];
  return {
    reported,
    ctx: {
      run: { id: "r-intake", kind: INGEST_URL_KIND, attempts } as unknown as Run,
      report: async (text) => {
        reported.push(text);
      },
      reportTool: async () => {},
      delegate: async () => ({ ok: false, reason: "not a fan-out" }),
    },
  };
}

function ingested(hash: string, over: Partial<IngestedDocument> = {}): IngestedDocument {
  return {
    entry: { hash, title: `T ${hash}`, originalFilename: "", addedAt: 0, format: "epub", kind: "article", sourceUrl: `https://repo.test/${hash}` },
    title: `Title ${hash}`,
    kind: "article",
    path: `library/${hash}.epub`,
    chars: 500,
    imagesEmbedded: 0,
    imagePlaceholders: 0,
    sections: 43,
    attachedTo: null,
    ...over,
  };
}

function setup(over: IngestUrlWorkerDeps = {}, ask: IngestAsk = { url: "https://x.com/a/status/1", intakeId: "in-1" }) {
  const mem = memoryIntakes();
  const outputs = new Map<string, string>();
  const targets: IngestTarget[] = [];
  const deps: IngestUrlWorkerDeps = {
    readAsk: async () => JSON.stringify(ask),
    ingest: async (_url, target) => {
      targets.push(target);
      return ingested("h1");
    },
    fulltext: async () => ({ status: "ok", pages: ["one", "two", "three"] }) as unknown as Fulltext,
    pipeline: () => {
      throw new Error("an intake has no book and no prep pipeline");
    },
    writeOutput: async (runId, text) => {
      outputs.set(runId, text);
      return `legion/outputs/${runId}.md`;
    },
    intakes: mem.store,
    ...over,
  };
  return { ...mem, outputs, targets, deps };
}

test("picked before filing: the run files attached nowhere, then attaches to the pick", async () => {
  const s = setup();
  const { id } = await s.store.create({ url: "https://x.com/a/status/1" });
  await chooseIntakeTopic(id, "t-a", { store: s.store, box: null });
  const out = await ingestUrlWorker(s.deps)(ASK, context().ctx).done;

  expect(s.targets).toEqual([{ kind: "topic", topicId: null }]);
  expect(s.attached).toEqual([{ topicId: "t-a", path: "library/h1.epub", hash: "h1" }]);
  const intake = (await readIntake(id, s.store))!;
  expect(intake).toMatchObject({ state: "filed", topicId: "t-a", attachedTo: "t-a" });
  const line = s.outputs.get("r-intake")!;
  expect(line).toContain('Took in "Title h1" (article, 11 characters)');
  expect(line).toContain("filed under the topic they picked");
  expect(line).not.toContain("supplement");
  expect(out!.progress).toBe(line);
});

test("filed before the pick: the documents wait, the line says so, and the pick attaches them", async () => {
  const s = setup();
  const { id } = await s.store.create({ url: "https://x.com/a/status/1" });
  await ingestUrlWorker(s.deps)(ASK, context().ctx).done;
  expect(s.attached).toEqual([]);
  expect((await readIntake(id, s.store))!).toMatchObject({ state: "filed", topicId: null, attachedTo: null });
  expect(s.outputs.get("r-intake")!).toContain("whichever topic the reader picks");

  const picked = await chooseIntakeTopic(id, "t-b", { store: s.store, box: null });
  expect(picked.attachedTo).toBe("t-b");
  expect(s.attached).toEqual([{ topicId: "t-b", path: "library/h1.epub", hash: "h1" }]);
});

test("the receipt the card reads: each document's hash, title, format, sections and pages, the skips and the AI's note", async () => {
  const batch: IngestBatch = {
    documents: [
      ingested("h1"),
      ingested("h2", { kind: "book", sections: undefined, entry: { hash: "h2", title: "", originalFilename: "", addedAt: 0, format: "pdf" } }),
    ],
    lead: "Read @a's post.",
    notes: ["Not taken: x.com/a/status/1: the post is the pointer.", 'The AI finished. Its note (the AI\'s words): "Took the manual."'],
    skipped: [{ url: "https://x.com/a/status/1", reason: "the post is the pointer" }],
    aiNote: "Took the manual.",
  };
  const hosts: string[] = [];
  const s = setup({
    ingest: async (_url, _target, ctx) => {
      ctx.report?.("github.com");
      return batch;
    },
  });
  const { id } = await s.store.create({ url: "https://x.com/a/status/1" });
  const off = s.store.subscribe(() => void s.store.get(id).then((i) => i?.host && hosts.push(i.host)));
  const { ctx, reported } = context();
  await ingestUrlWorker(s.deps)(ASK, ctx).done;
  off();

  expect(reported[0]).toContain("x.com");
  expect(reported[1]).toContain("github.com");
  expect(hosts).toContain("github.com");
  const intake = (await readIntake(id, s.store))!;
  expect(intake.host).toBeNull();
  expect(intake.documents).toEqual([
    { hash: "h1", title: "Title h1", format: "article", sections: 43, pages: 3, chars: 11, path: "library/h1.epub", sourceUrl: "https://repo.test/h1" },
    { hash: "h2", title: "Title h2", format: "pdf", pages: 3, chars: 11, path: "library/h2.epub" },
  ]);
  expect(intake.skipped).toEqual([{ url: "https://x.com/a/status/1", reason: "the post is the pointer" }]);
  expect(intake.aiNote).toBe("Took the manual.");
  // The model's English receipt is still lead, documents, notes.
  const line = s.outputs.get("r-intake")!;
  expect(line.startsWith("Read @a's post. ")).toBe(true);
  expect(line).toContain('"Title h2" (pdf, 3 pages)');
  expect(line.endsWith('"Took the manual."')).toBe(true);
});

test("nothing filed: the intake says why and the run fails for good with its line", async () => {
  const s = setup({
    ingest: async () => ({
      documents: [],
      lead: "Read @a's post. Nothing became a document.",
      notes: ["Stopped: the step limit was reached."],
      skipped: [{ url: "https://x.com/a/article/9", reason: "a long-form post is not readable here" }],
    }),
  });
  const { id } = await s.store.create({ url: "https://x.com/a/status/1" });
  await s.store.choose(id, "t-a");
  const failure = await ingestUrlWorker(s.deps)(ASK, context().ctx).done.catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(GiveUpError);
  expect((failure as Error).message).toBe(
    "Read @a's post. Nothing became a document. Stopped: the step limit was reached.",
  );
  const intake = (await readIntake(id, s.store))!;
  expect(intake).toMatchObject({ state: "failed", reason: "Read @a's post. Nothing became a document.", attachedTo: null });
  expect(intake.skipped).toHaveLength(1);
  expect(s.attached).toEqual([]);
  expect(s.outputs.has("r-intake")).toBe(false);
});

test("a throw is a failure on the card only on the run's last try", async () => {
  const boom = { ingest: async () => Promise.reject(new Error("Could not fetch the page (404).")) };
  const s = setup(boom);
  const { id } = await s.store.create({ url: "https://x.com/a/status/1" });
  await expect(ingestUrlWorker(s.deps)(ASK, context(1).ctx).done).rejects.toThrow(/404/);
  expect((await readIntake(id, s.store))!.state).toBe("reading");
  await expect(ingestUrlWorker(s.deps)(ASK, context(3).ctx).done).rejects.toThrow(/404/);
  expect((await readIntake(id, s.store))!).toMatchObject({ state: "failed", reason: "Could not fetch the page (404)." });
});

test("a book ask runs exactly as before and never touches an intake", async () => {
  const s = setup({}, { url: "https://a.test/x.pdf", bookId: "book-1" });
  s.deps.pipeline = () => null;
  s.deps.intakes = {
    progress: () => Promise.reject(new Error("touched")),
    filed: () => Promise.reject(new Error("touched")),
    failed: () => Promise.reject(new Error("touched")),
  };
  await ingestUrlWorker(s.deps)(ASK, context().ctx).done;
  expect(s.targets).toEqual([{ kind: "book", bookId: "book-1" }]);
  expect(s.outputs.get("r-intake")!).toContain("It is a supplement of this book now");
});

test("starting an intake writes the record, an ask naming it and no book, and the run's id", async () => {
  const s = setup();
  const asks: IngestAsk[] = [];
  const started = await startTopicIntake("https://x.com/a/status/1", "the repo it shares", {
    store: s.store,
    box: null,
    origin: { kind: "door" } as never,
    start: async (ask, deps) => {
      asks.push(ask);
      expect(deps?.origin).toEqual({ kind: "door" } as never);
      return { runId: "r-7" };
    },
  });
  expect(started).toEqual({ intakeId: "in-1", runId: "r-7" });
  expect(asks).toEqual([{ url: "https://x.com/a/status/1", intakeId: "in-1", note: "the repo it shares" }]);
  expect((await readIntake("in-1", s.store))!).toMatchObject({ state: "reading", host: "x.com", runId: "r-7" });
});

test("a run the runner refuses leaves the intake failed with its sentence", async () => {
  const s = setup();
  await expect(
    startTopicIntake("https://a.test/x", undefined, {
      store: s.store,
      start: async () => {
        throw new Error("the runner is not accepting work");
      },
    }),
  ).rejects.toThrow(/not accepting/);
  expect((await readIntake("in-1", s.store))!).toMatchObject({ state: "failed", reason: "the runner is not accepting work" });
});
