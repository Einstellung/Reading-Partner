// The soul's delegate tool (src/soul/delegate.ts, docs/68): the brief goes to a
// file, the run carries the path and the place the question was asked, and the
// turn does not wait for the answer.
// Run: scripts/t.sh tests/soul/delegate.test.ts

import { expect, test } from "bun:test";
import { buildDelegateTools, DELEGATE_TOOL } from "../../src/soul";
import type { DelegateInput, Delegated } from "../../src/legion/execute/worker";
import type { Run } from "../../src/legion/run";
import type { BoxOrigin } from "../../src/box";
import { toolText } from "../support/tool-text";

const ORIGIN: BoxOrigin = {
  place: "book",
  bookId: "book-hash",
  threadId: "thread-1",
  annotationId: "ann-1",
  page: 37,
};

function recorder(answer?: Delegated) {
  const seen: DelegateInput[] = [];
  const delegate = async (input: DelegateInput): Promise<Delegated> => {
    seen.push(input);
    return (
      answer ?? {
        ok: true,
        existing: false,
        run: { id: "r-1", kind: input.kind } as unknown as Run,
      }
    );
  };
  return { seen, delegate };
}

function tool(over: Parameters<typeof buildDelegateTools>[0] = {}) {
  const briefs = new Map<string, string>();
  const { seen, delegate } = recorder(over.delegate ? undefined : undefined);
  const built = buildDelegateTools({
    origin: ORIGIN,
    kinds: () => ["research-literature"],
    writeBrief: async (text) => {
      const path = `legion/briefs/${briefs.size}.md`;
      briefs.set(path, text);
      return path;
    },
    delegate,
    ...over,
  });
  return { tool: built[0]!, briefs, seen };
}

test("the tool is there whatever this device can run", () => {
  expect(buildDelegateTools({ kinds: () => [] }).map((t) => t.name)).toEqual([DELEGATE_TOOL]);
  // And it says so where the model reads what a kind may be, rather than by
  // being absent from the list.
  const params = buildDelegateTools({ kinds: () => [] })[0]!.parameters as {
    properties: { kind: { description: string } };
  };
  expect(params.properties.kind.description).toContain("no kind registered");
});

test("the brief goes to a file and the run carries the path, never the text", async () => {
  const { tool: t, briefs, seen } = tool();
  toolText(await t.execute({ kind: "research-literature", task: "what has been published since 2020" }));

  expect(seen.length).toBe(1);
  const [path] = [...briefs.keys()];
  expect(seen[0]!.brief).toBe(path!);
  expect(briefs.get(path!)).toBe("what has been published since 2020");
});

test("where the answer goes is the soul's to fill in, as the origin's JSON", async () => {
  const { tool: t, seen } = tool();
  toolText(await t.execute({ kind: "research-literature", task: "anything" }));
  expect(JSON.parse(seen[0]!.deliverTo!)).toEqual(ORIGIN);
  expect(seen[0]!.delegator).toEqual({ kind: "soul" });
});

test("a turn held nowhere in particular delegates without a place to answer in", async () => {
  const { tool: t, seen } = tool({ origin: undefined });
  toolText(await t.execute({ kind: "research-literature", task: "anything" }));
  expect(seen[0]!.deliverTo).toBeUndefined();
});

test("what comes back is the run id and the fact that the answer is not in this turn", async () => {
  const { tool: t } = tool();
  const said = toolText(await t.execute({ kind: "research-literature", task: "anything" }));
  expect(said).toContain("r-1");
  expect(said).toContain("later");
});

test("a kind nothing here runs is refused before a brief is written", async () => {
  const { tool: t, briefs, seen } = tool();
  await expect(t.execute({ kind: "translate-book", task: "anything" })).rejects.toThrow(
    "research-literature",
  );
  expect(briefs.size).toBe(0);
  expect(seen).toEqual([]);
});

test("a refusal comes back in the runner's own words", async () => {
  const { tool: t } = tool({
    delegate: async () => ({ ok: false, reason: "run r-9 is already failed" }),
  });
  await expect(t.execute({ kind: "research-literature", task: "anything" })).rejects.toThrow(
    "run r-9 is already failed",
  );
});
