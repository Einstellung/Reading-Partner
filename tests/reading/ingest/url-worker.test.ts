// The ingest-url worker (src/reading/ingest/url-worker.ts, docs/55): the three
// stages a person reads off the run, the one line it leaves behind, and the
// prep half that only happens where the book has a live pipeline. Every host
// reach is injected, so nothing here fetches, reads the library or writes a
// file. Run: scripts/t.sh tests/reading/ingest/url-worker.test.ts

import { expect, test } from "bun:test";
import {
  ingestUrlWorker,
  registerIngestUrlWorker,
  type IngestUrlWorkerDeps,
} from "../../../src/reading/ingest/url-worker";
import { INGEST_URL_KIND } from "../../../src/reading/ingest/url-run";
import {
  delegableWorkerKinds,
  registeredWorkerKinds,
  type WorkerContext,
} from "../../../src/legion/execute/worker";
import type { IngestedDocument } from "../../../src/reading/ingest/article";
import type { Fulltext } from "../../../src/fulltext/types";
import type { PrepPaper } from "../../../src/reading/prep/papers/types";
import type { Run } from "../../../src/legion/run";

const ASK = "legion/briefs/ingest-1.json";

function context(): { ctx: WorkerContext; reported: string[] } {
  const reported: string[] = [];
  return {
    reported,
    ctx: {
      run: { id: "r-ingest", kind: INGEST_URL_KIND } as unknown as Run,
      report: async (text) => {
        reported.push(text);
      },
      reportTool: async () => {},
      delegate: async () => ({ ok: false, reason: "not a fan-out" }),
    },
  };
}

function document(over: Partial<IngestedDocument> = {}): IngestedDocument {
  return {
    entry: { hash: "h-1", sourceUrl: "https://a.test/x.pdf" },
    title: "A Paper",
    kind: "pdf",
    chars: 100,
    ...over,
  } as unknown as IngestedDocument;
}

function fulltext(pages: string[]): Fulltext {
  return { status: "ok", pages } as unknown as Fulltext;
}

function deps(over: IngestUrlWorkerDeps = {}): IngestUrlWorkerDeps & {
  outputs: Map<string, string>;
} {
  const outputs = new Map<string, string>();
  return {
    outputs,
    readAsk: async (path) => {
      if (path !== ASK) throw new Error(`no ask at ${path}`);
      return JSON.stringify({ url: "https://a.test/x.pdf", bookId: "book-1" });
    },
    ingest: async () => document(),
    fulltext: async () => fulltext(["one", "two"]),
    pipeline: () => null,
    writeOutput: async (runId, text) => {
      const path = `legion/outputs/${runId}.md`;
      outputs.set(path, text);
      return path;
    },
    ...over,
  };
}

test("reports the three stages in order and answers with the line it wrote", async () => {
  const d = deps();
  const { ctx, reported } = context();
  const captured: PrepPaper[] = [];
  const outcome = await ingestUrlWorker({
    ...d,
    pipeline: () => ({
      ingestCaptured: async (mint) => {
        const paper = mint(new Set<string>());
        captured.push(paper);
        return { ...paper, status: "digesting" } as PrepPaper;
      },
    }),
  })(ASK, ctx).done;

  expect(reported[0]).toContain("Fetching");
  expect(reported[0]).toContain("a.test");
  expect(reported[1]).toContain("Extracting");
  expect(reported[2]).toContain("Filing");
  expect(reported).toHaveLength(3);

  expect(outcome!.output).toBe("legion/outputs/r-ingest.md");
  const line = d.outputs.get("legion/outputs/r-ingest.md")!;
  expect(line).toContain("A Paper");
  expect(line).toContain("2 pages");
  expect(line).toContain("Outline");
  // The prep list took it, so the line names what read_paper answers to.
  expect(line).toContain(captured[0]!.slug);
  // The last line a person reads on the run is the same sentence.
  expect(outcome!.progress).toBe(line);
});

test("a book with no live pipeline gets the supplement and no prep list", async () => {
  const d = deps();
  const { ctx, reported } = context();
  const outcome = await ingestUrlWorker(d)(ASK, ctx).done;
  expect(reported).toEqual([expect.stringContaining("Fetching"), expect.stringContaining("Extracting")]);
  const line = d.outputs.get("legion/outputs/r-ingest.md")!;
  expect(line).toContain("A Paper");
  expect(line).not.toContain("prep list");
  expect(outcome!.output).toBe("legion/outputs/r-ingest.md");
});

test("an article with no extractable text is still the supplement it became", async () => {
  const d = deps({
    ingest: async () => document({ kind: "article", title: "A Plain Page", chars: 4200 }),
    fulltext: async () => null,
  });
  await ingestUrlWorker(d)(ASK, context().ctx).done;
  const line = d.outputs.get("legion/outputs/r-ingest.md")!;
  expect(line).toContain("A Plain Page");
  expect(line).toContain("4200 characters");
});

// Nothing in the ingest takes a signal, so cancelling is read between stages.
test("cancelling stops the run before the text is cut", async () => {
  let cut = false;
  const handle = ingestUrlWorker(
    deps({
      ingest: async () => {
        handle.cancel();
        return document();
      },
      fulltext: async () => {
        cut = true;
        return fulltext(["one"]);
      },
    }),
  )(ASK, context().ctx);
  await expect(handle.done).rejects.toThrow();
  expect(cut).toBe(false);
});

test("a failed ask is a failed run, not an empty one", async () => {
  const handle = ingestUrlWorker(deps({ readAsk: async () => "{}" }))(ASK, context().ctx);
  await expect(handle.done).rejects.toThrow(/no URL/);
});

// The kind is the tool's to write and not the soul's to hand a task to: the ask
// is a URL and a book, which is not something a model could write as a brief.
test("the kind runs here but never appears in the delegate catalogue", () => {
  registerIngestUrlWorker(deps());
  expect(registeredWorkerKinds()).toContain(INGEST_URL_KIND);
  expect(delegableWorkerKinds()).not.toContain(INGEST_URL_KIND);
});
