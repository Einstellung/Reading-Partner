// Unit tests for the ingest_url chat tool (src/reading/prep/papers/source-tool.ts).
// The run is a fake ingestor, so there is no network, no AppData and no runner.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  buildSourceTools,
  type SourceIngestor,
} from "../../../../src/reading/prep/papers/source-tool";
import { toolText } from "../../../support/tool-text";

function tool(ingestor: SourceIngestor) {
  const [t] = buildSourceTools(ingestor);
  return t!;
}

function starts(spy?: (url: string, note?: string) => void): SourceIngestor {
  return {
    start: async (url, note) => {
      spy?.(url, note);
      return { runId: "r-1" };
    },
  };
}

test("writes a run and says so, naming it and the thread it answers in", async () => {
  let seen = "";
  const t = tool(starts((u) => (seen = u)));
  const out = (toolText(await t.execute({ url: "https://a.test/post" }))) as string;
  expect(seen).toBe("https://a.test/post");
  expect(out).toContain("r-1");
  expect(out).toContain("does not wait");
  expect(out).toContain("Outline");
  expect(out).toContain("reference material");
});

test("the note the reader gave rides along with the URL", async () => {
  let note: string | undefined;
  const t = tool(starts((_u, n) => (note = n)));
  toolText(await t.execute({ url: "https://a.test/post", note: "compare with ch.3" }));
  expect(note).toBe("compare with ch.3");
});

// The whole point of the change: the turn is over before the fetch is.
test("returns without waiting for the run to finish", async () => {
  let finished = false;
  const t = tool({
    start: async () => {
      // The run this stands for keeps going long after start() answers.
      void new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => {
        finished = true;
      });
      return { runId: "r-2" };
    },
  });
  const out = (toolText(await t.execute({ url: "https://a.test/slow.pdf" }))) as string;
  expect(finished).toBe(false);
  expect(out).toContain("r-2");
});

test("says nothing about what the page contains, because nothing has been read", async () => {
  const t = tool(starts());
  const out = (toolText(await t.execute({ url: "https://a.test/post" }))) as string;
  expect(out).not.toContain("read_paper");
  expect(out).toContain("say nothing about what is in it");
});

test("takes an http URL and rejects any other scheme before writing a run", async () => {
  let called = false;
  const refuses = tool({
    start: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  await expect(refuses.execute({ url: "file:///etc/passwd" })).rejects.toThrow(/http/);
  expect(called).toBe(false);

  let seen = "";
  const t = tool(starts((u) => (seen = u)));
  toolText(await t.execute({ url: "http://a.test/post" }));
  expect(seen).toBe("http://a.test/post");
});

// A runner that refuses — too deep, nothing registered for the kind — is the
// model's to read, so it comes back as the tool call failing.
test("a refused run is a tool error", async () => {
  const t = tool({
    start: async () => {
      throw new Error("no worker is registered for the kind ingest-url");
    },
  });
  await expect(t.execute({ url: "https://a.test/post" })).rejects.toThrow(/no worker/);
});
