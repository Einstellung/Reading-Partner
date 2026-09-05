// The statement_write tool (src/memory/statements/tools.ts) over the real store
// on an in-memory file. Run: bun test.

import { expect, test } from "bun:test";
import { localDate } from "../../src/memory/observations/files";
import { createStatementStore, STATEMENTS_FILE } from "../../src/memory/statements/store";
import { buildStatementTools, latestReaderMessage } from "../../src/memory/statements/tools";
import type { AgentTool } from "../../src/ai/agent";

const THREAD = "11111111-2222-3333-4444-555555555555";
const TS = new Date("2026-09-05T02:30:00Z").getTime();
const MESSAGE = { id: "t-0123456789abcdef", role: "user" as const, ts: TS };
const ANCHOR = `${MESSAGE.id}@${THREAD}:${TS}`;

function makeStore() {
  const files = new Map<string, string>();
  let minted = 0;
  const store = createStatementStore({
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    // No observation is ever cited through this tool; a resolver that answers
    // anything would hide it if one were.
    async observationDates() {
      return null;
    },
    newId: () => `s-${String(++minted).padStart(16, "0")}`,
  });
  const read = () =>
    JSON.parse(files.get(STATEMENTS_FILE) ?? '{"statements":[]}').statements as {
      id: string;
      kind: string;
      text: string;
      author: string;
      evidence: string[];
      established: string;
      lastSupported: string;
      supersededBy?: string;
      expectedIntervalDays?: number;
    }[];
  return { store, read };
}

function mount(overrides: Parameters<typeof buildStatementTools>[0] | null = null): AgentTool[] {
  const { store } = makeStore();
  return buildStatementTools(overrides ?? { store, message: MESSAGE, threadId: THREAD });
}

function only(tools: AgentTool[]): AgentTool {
  expect(tools).toHaveLength(1);
  return tools[0];
}

test("the reader's own words become a statement anchored on the message they said them in", async () => {
  const { store, read } = makeStore();
  const tool = only(buildStatementTools({ store, message: MESSAGE, threadId: THREAD }));
  expect(tool.name).toBe("statement_write");

  const result = await tool.execute({ kind: "profile", text: "  No diagrams; give the derivation  " });

  const [s] = read();
  expect(s.kind).toBe("profile");
  expect(s.author).toBe("reader");
  expect(s.text).toBe("No diagrams; give the derivation");
  // The composite anchor form: the message's own id joined to the pair that was
  // the anchor before ids existed (memory/observations/anchors.ts). The store's
  // date arithmetic reads the pair half of it.
  expect(s.evidence).toEqual([ANCHOR]);
  expect(s.established).toBe(localDate(TS));
  expect(s.lastSupported).toBe(localDate(TS));
  expect(String(result)).toContain(s.id);
});

test("a concern keeps the interval it was given; a profile statement does not", async () => {
  const { store, read } = makeStore();
  const tool = only(buildStatementTools({ store, message: MESSAGE, threadId: THREAD }));

  await tool.execute({ kind: "concern", text: "Watching the KV-cache papers", expectedIntervalDays: 7 });
  await tool.execute({ kind: "profile", text: "Reads the maths", expectedIntervalDays: 7 });

  const [concern, profile] = read();
  expect(concern.expectedIntervalDays).toBe(7);
  expect(profile.expectedIntervalDays).toBeUndefined();
});

test("supersedes links the new statement to the old and keeps the old one", async () => {
  const { store, read } = makeStore();
  const tool = only(buildStatementTools({ store, message: MESSAGE, threadId: THREAD }));

  await tool.execute({ kind: "profile", text: "Wants diagrams" });
  const old = read()[0];
  const result = String(
    await tool.execute({ kind: "profile", text: "Stop drawing diagrams", supersedes: old.id }),
  );

  const all = read();
  expect(all).toHaveLength(2);
  expect(all[0].supersededBy).toBe(all[1].id);
  expect(all[0].text).toBe("Wants diagrams");
  expect(all[1].text).toBe("Stop drawing diagrams");
  expect(all[1].author).toBe("reader");
  expect(result).toContain(old.id);
});

test("a supersedes that names nothing writes nothing and says why", async () => {
  const { store, read } = makeStore();
  const tool = only(buildStatementTools({ store, message: MESSAGE, threadId: THREAD }));

  const result = String(
    await tool.execute({ kind: "profile", text: "Stop drawing diagrams", supersedes: "s-nope" }),
  );

  expect(read()).toEqual([]);
  expect(result).toContain("s-nope");
  expect(result).toContain("nothing was written");
});

test("a statement already superseded cannot be superseded again", async () => {
  const { store, read } = makeStore();
  const tool = only(buildStatementTools({ store, message: MESSAGE, threadId: THREAD }));

  await tool.execute({ kind: "profile", text: "Wants diagrams" });
  const first = read()[0].id;
  await tool.execute({ kind: "profile", text: "Stop drawing diagrams", supersedes: first });
  const second = read()[1].id;

  const result = String(
    await tool.execute({ kind: "profile", text: "Diagrams are fine again", supersedes: first }),
  );

  expect(read()).toHaveLength(2);
  expect(result).toContain(second);
  expect(result).toContain("nothing was written");
});

test("a kind or a text the tool cannot use is refused before anything is written", async () => {
  const { store, read } = makeStore();
  const tool = only(buildStatementTools({ store, message: MESSAGE, threadId: THREAD }));

  expect(tool.execute({ kind: "guess", text: "Something" })).rejects.toThrow(/profile \| concern/);
  expect(tool.execute({ kind: "profile", text: "   " })).rejects.toThrow(/requires text/);
  expect(read()).toEqual([]);
});

test("the tool is not mounted where there is no reader message to date it by", () => {
  const { store } = makeStore();
  expect(buildStatementTools({ store, message: null, threadId: THREAD })).toEqual([]);
  expect(buildStatementTools({ store, threadId: THREAD })).toEqual([]);
  // The reply, not the question: nothing the reader said.
  expect(
    buildStatementTools({ store, message: { ...MESSAGE, role: "ai" }, threadId: THREAD }),
  ).toEqual([]);
  // The id-only anchor form carries no timestamp, so a statement built on it
  // could not be dated (statements/dates.ts) and every call would throw.
  expect(buildStatementTools({ store, message: MESSAGE })).toEqual([]);
  // A pre-id message still anchors: the thread-and-stamp pair dates it.
  expect(
    buildStatementTools({ store, message: { role: "user", ts: TS }, threadId: THREAD }),
  ).toHaveLength(1);
  // Mounting is decided by the message alone.
  expect(mount()).toHaveLength(1);
});

test("the reader's message for the turn is the last one they sent", () => {
  const msgs = [
    { role: "user" as const, ts: 1 },
    { role: "ai" as const, ts: 2 },
    { role: "user" as const, ts: 3 },
    { role: "ai" as const, ts: 4 },
  ];
  expect(latestReaderMessage(msgs)?.ts).toBe(3);
  expect(latestReaderMessage([{ role: "ai" as const, ts: 1 }])).toBeNull();
  expect(latestReaderMessage([])).toBeNull();
});
