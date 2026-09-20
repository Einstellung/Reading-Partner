// The durable harness factory (src/legion/execute/harness.ts).
//
// Nothing here reaches a provider or a disk. The stream is pi-ai's own faux
// provider, handed in as the `streamFn` dependency, so every assistant message
// is scripted; the session store is createSessionFileSystem over an in-memory
// AppData, so the session files are a Map.
//
// The case the whole harness exists for: a tool that never returns, a process
// that dies on top of it, and a second createHarness over the same store that
// finds the run still open, settles it on the file that holds it, and starts
// this process on a session of its own.
// Run: scripts/t.sh tests/legion/execute/harness.test.ts

import { expect, test } from "bun:test";
import {
  BACKGROUND_CONTEXT,
  FileError,
  err,
  type AgentHarnessTool,
  type Entry,
  type FileSystem,
} from "@earendil-works/pi-agent-core";
import { Type, type Api, type Model } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai/providers/faux";
import type { StreamFn } from "../../../src/legion/execute/turn";
import {
  createHarness,
  createSessionRepo,
  type HarnessDeps,
} from "../../../src/legion/execute/harness";
import { createSessionFileSystem, SESSIONS_ROOT } from "../../../src/platform/app/session-fs";
import { memoryAppData, type MemoryDisk } from "../../support/memory-appdata";

const ctx = BACKGROUND_CONTEXT;

interface Rig {
  faux: FauxProviderHandle;
  model: Model<Api>;
  streamFn: StreamFn;
  fileSystem: FileSystem;
}

// One store, one scripted provider. The store is handed back so a second
// harness can be opened on the same files — that is the restart.
function rig(fileSystem = createSessionFileSystem(memoryAppData())): Rig {
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "faux-1", contextWindow: 100_000, maxTokens: 4096 }],
    tokensPerSecond: 0,
  });
  const model = faux.getModel() as Model<Api>;
  return {
    faux,
    model,
    fileSystem,
    streamFn: (m, context, options) => faux.provider.streamSimple(m, context, options),
  };
}

function tool(
  name: string,
  run: (params: { note: string }) => Promise<string>,
): AgentHarnessTool<undefined> {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: Type.Object({ note: Type.String() }),
    async execute(_id, params) {
      const text = await run(params as { note: string });
      return { content: [{ type: "text", text }], details: undefined };
    },
  } as AgentHarnessTool<undefined>;
}

function deps(r: Rig, extra?: Partial<HarnessDeps>): HarnessDeps {
  return {
    fileSystem: r.fileSystem,
    sessionsRoot: SESSIONS_ROOT,
    model: r.model,
    streamFn: r.streamFn,
    systemPrompt: "be brief",
    ...extra,
  };
}

// Chronological. findEntries hands back the branch newest first, which reads
// backwards in an assertion.
function transcript(entries: Entry[]): string[] {
  return [...entries].reverse().map((e) => {
    if (e.type !== "message") return e.type;
    const message = e.message as { role: string; content: unknown };
    const body =
      typeof message.content === "string"
        ? message.content
        : (message.content as { type: string; text?: string; name?: string }[])
            .map((c) => (c.type === "text" ? `text:${c.text}` : `${c.type}:${c.name ?? ""}`))
            .join("|");
    return `${message.role} ${body}`;
  });
}

test("a fresh store has nothing open, and a prompt comes back as text", async () => {
  const r = rig();
  const handle = await createHarness(deps(r), ctx);
  expect(handle.open).toEqual([]);

  r.faux.setResponses([fauxAssistantMessage([fauxText("hello back")], { stopReason: "stop" })]);
  const lane = await handle.harness.lane("soul", ctx);
  const result = await lane.prompt("hello", undefined, ctx);
  expect(result.ok).toBe(true);
  expect(transcript(await lane.findEntries(undefined, ctx))).toEqual([
    "user text:hello",
    "assistant text:hello back",
  ]);
  await handle.close(ctx);
});

test("a tool call runs and its result goes back to the model", async () => {
  const r = rig();
  const seen: string[] = [];
  const handle = await createHarness(
    deps(r, {
      tools: [
        tool("probe_echo", async (p) => {
          seen.push(p.note);
          return `echoed:${p.note}`;
        }),
      ],
    }),
    ctx,
  );
  r.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("probe_echo", { note: "one" }, { id: "c1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done with one")], { stopReason: "stop" }),
  ]);
  const lane = await handle.harness.lane("soul", ctx);
  expect((await lane.prompt("use the tool", undefined, ctx)).ok).toBe(true);
  expect(seen).toEqual(["one"]);
  expect(transcript(await lane.findEntries(undefined, ctx))).toEqual([
    "user text:use the tool",
    "assistant toolCall:probe_echo",
    "toolResult text:echoed:one",
    "assistant text:done with one",
  ]);
  await handle.close(ctx);
});

test("steering cuts in after the tool result of the round it interrupted", async () => {
  const r = rig();
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handle = await createHarness(
    deps(r, {
      tools: [
        tool("probe_wait", async (p) => {
          await held;
          return `waited:${p.note}`;
        }),
      ],
    }),
    ctx,
  );
  r.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("probe_wait", { note: "one" }, { id: "c1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("acknowledged steer")], { stopReason: "stop" }),
  ]);
  const lane = await handle.harness.lane("soul", ctx);
  const run = lane.prompt("start", undefined, ctx);
  await Bun.sleep(20);
  await lane.steer("also consider this", undefined, ctx);
  release();
  expect((await run).ok).toBe(true);

  expect(transcript(await lane.findEntries(undefined, ctx))).toEqual([
    "user text:start",
    "assistant toolCall:probe_wait",
    "toolResult text:waited:one",
    "user text:also consider this",
    "assistant text:acknowledged steer",
  ]);
  await handle.close(ctx);
});

function sessionFiles(disk: MemoryDisk): string[] {
  return [...disk.files.keys()].filter((path) => path.endsWith(".jsonl"));
}

function text(disk: MemoryDisk, path: string): string {
  return new TextDecoder().decode(disk.files.get(path)!);
}

// The reason for all of it. The tool never returns and the harness is dropped
// without closing — a process death, as far as the store is concerned. Only the
// session handle is released, because the repo will not hand out a session it
// still thinks is open.
test("a run interrupted mid-tool is settled on its own file, and this process starts fresh", async () => {
  const disk = memoryAppData();
  const fileSystem = createSessionFileSystem(disk);
  const first = rig(fileSystem);
  const entered: string[] = [];

  const hang = tool("probe_work", async (p) => {
    entered.push(`first:${p.note}`);
    await new Promise<void>(() => {});
    return "unreachable";
  });
  const handle = await createHarness(deps(first, { tools: [hang] }), ctx);
  first.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("probe_work", { note: "job" }, { id: "c1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("unreachable answer")], { stopReason: "stop" }),
  ]);
  const lane = await handle.harness.lane("soul", ctx);
  void lane.prompt("do the job", undefined, ctx);
  await Bun.sleep(40);
  await handle.session.close(ctx);
  expect(sessionFiles(disk)).toHaveLength(1);
  const interrupted = sessionFiles(disk)[0]!;

  // --- second process, same files ---
  const second = rig(fileSystem);
  second.faux.setResponses([fauxAssistantMessage([fauxText("this turn")], { stopReason: "stop" })]);
  const reopened = await createHarness(
    deps(second, {
      tools: [
        tool("probe_work", async (p) => {
          entered.push(`second:${p.note}`);
          return `done:${p.note}`;
        }),
      ],
    }),
    ctx,
  );

  // A session of this process's own, with nothing left over on it.
  expect(reopened.open).toEqual([]);
  expect(sessionFiles(disk)).toHaveLength(2);
  expect(sessionFiles(disk)).toContain(interrupted);

  // The tool is not run again: the interrupted run's file got pi's synthetic
  // result, and no model call was made for it.
  expect(entered).toEqual(["first:job"]);
  expect(text(disk, interrupted)).toContain("Tool execution was interrupted");

  const freshLane = await reopened.harness.lane("soul", ctx);
  expect((await freshLane.prompt("hello", undefined, ctx)).ok).toBe(true);
  expect(transcript(await freshLane.findEntries(undefined, ctx))).toEqual([
    "user text:hello",
    "assistant text:this turn",
  ]);

  await reopened.close(ctx);
});

function setAsideFiles(disk: MemoryDisk): string[] {
  return [...disk.files.keys()].filter((path) => path.includes(".jsonl.corrupt-"));
}

// A line the storage cannot replay. pi heals a torn last line and nothing
// else, so a bad line in the middle is fatal for every turn after it unless
// the file is moved out of the way (docs/pitfall/367).
function corruptMiddleLine(disk: MemoryDisk, path: string): void {
  const lines = new TextDecoder().decode(disk.files.get(path)!).split("\n");
  expect(lines.length).toBeGreaterThan(4);
  lines[2] = "{ this is not json";
  disk.files.set(path, new TextEncoder().encode(lines.join("\n")));
}

test("a session whose middle line will not replay is set aside and a fresh one takes over", async () => {
  const disk = memoryAppData();
  const fileSystem = createSessionFileSystem(disk);

  const first = rig(fileSystem);
  const handle = await createHarness(deps(first), ctx);
  first.faux.setResponses([
    fauxAssistantMessage([fauxText("first answer")], { stopReason: "stop" }),
  ]);
  const lane = await handle.harness.lane("soul", ctx);
  expect((await lane.prompt("hello", undefined, ctx)).ok).toBe(true);
  await handle.close(ctx);

  const path = sessionFiles(disk)[0]!;
  corruptMiddleLine(disk, path);
  const broken = disk.files.get(path)!;

  // --- second process, same store ---
  const second = rig(fileSystem);
  second.faux.setResponses([
    fauxAssistantMessage([fauxText("second answer")], { stopReason: "stop" }),
  ]);
  const reopened = await createHarness(deps(second), ctx);
  expect(reopened.open).toEqual([]);
  const freshLane = await reopened.harness.lane("soul", ctx);
  expect((await freshLane.prompt("hello again", undefined, ctx)).ok).toBe(true);
  expect(transcript(await freshLane.findEntries(undefined, ctx))).toEqual([
    "user text:hello again",
    "assistant text:second answer",
  ]);

  // The broken file is off the repo's listing but still on the disk, byte for
  // byte: nothing deletes the only copy of what the run wrote.
  expect(disk.files.has(path)).toBe(false);
  expect(setAsideFiles(disk)).toHaveLength(1);
  expect(setAsideFiles(disk)[0]!.startsWith(`${path}.corrupt-`)).toBe(true);
  expect(disk.files.get(setAsideFiles(disk)[0]!)).toEqual(broken);
  expect(sessionFiles(disk)).toHaveLength(1);
  await reopened.close(ctx);

  // --- third process: the second's session opens, is settled and left behind ---
  const third = rig(fileSystem);
  const again = await createHarness(deps(third), ctx);
  expect(transcript(await (await again.harness.lane("soul", ctx)).findEntries(undefined, ctx)))
    .toEqual([]);
  expect(setAsideFiles(disk)).toHaveLength(1);
  expect(sessionFiles(disk)).toHaveLength(2);
  await again.close(ctx);
});

// The other half of the decision: a filesystem that refuses is not the file's
// content being wrong, and the next turn is meant to retry the same file.
test("a disk that will not answer is not set aside", async () => {
  const disk = memoryAppData();
  const fileSystem = createSessionFileSystem(disk);
  const first = rig(fileSystem);
  const handle = await createHarness(deps(first), ctx);
  first.faux.setResponses([fauxAssistantMessage([fauxText("answer")], { stopReason: "stop" })]);
  const lane = await handle.harness.lane("soul", ctx);
  expect((await lane.prompt("hello", undefined, ctx)).ok).toBe(true);
  await handle.close(ctx);

  const asleep: FileSystem = {
    ...fileSystem,
    readTextFile: async (path) => err(new FileError("unknown", "the disk is asleep", path)),
  };
  const second = rig(asleep);
  await expect(createHarness(deps(second), ctx)).rejects.toThrow(/Failed to read JSONL storage/);
  expect(setAsideFiles(disk)).toEqual([]);
  expect(sessionFiles(disk)).toHaveLength(1);
});

// The group directory the repo slugs out of the default `cwd`, and one for a
// group nothing here opens.
const GROUP = "session/--session--";
const OTHER_GROUP = "session/--session-other--";

// A file with a name the group would have given it and a body the repo cannot
// read as a session: the sweep goes by name and never opens anything.
async function seed(disk: MemoryDisk, directory: string, name: string): Promise<void> {
  await disk.mkdirp(directory);
  disk.files.set(`${directory}/${name}`, new TextEncoder().encode("not a session header\n"));
}

function groupFiles(disk: MemoryDisk, directory: string): string[] {
  return [...disk.files.keys()]
    .filter((path) => path.startsWith(`${directory}/`))
    .map((path) => path.slice(directory.length + 1))
    .sort();
}

test("a group keeps its newest five files and nothing outside it is touched", async () => {
  const disk = memoryAppData();
  for (let day = 1; day <= 7; day += 1) {
    await seed(disk, GROUP, `2020-01-0${day}T00-00-00-000Z_s${day}.jsonl`);
  }
  await seed(disk, GROUP, "2020-01-02T00-00-00-000Z_s2.jsonl.corrupt-1700000000000");
  await seed(disk, OTHER_GROUP, "2020-01-01T00-00-00-000Z_o1.jsonl");

  const r = rig(createSessionFileSystem(disk));
  const handle = await createHarness(deps(r), ctx);

  const kept = groupFiles(disk, GROUP);
  expect(kept).toHaveLength(5);
  expect(kept.slice(0, 4)).toEqual([
    "2020-01-04T00-00-00-000Z_s4.jsonl",
    "2020-01-05T00-00-00-000Z_s5.jsonl",
    "2020-01-06T00-00-00-000Z_s6.jsonl",
    "2020-01-07T00-00-00-000Z_s7.jsonl",
  ]);
  expect(kept[4]!.endsWith(".jsonl")).toBe(true);
  expect(groupFiles(disk, OTHER_GROUP)).toEqual(["2020-01-01T00-00-00-000Z_o1.jsonl"]);

  await handle.close(ctx);
});

test("a session handed in is used as it is: nothing settled, nothing created, nothing swept", async () => {
  const disk = memoryAppData();
  for (let day = 1; day <= 7; day += 1) {
    await seed(disk, GROUP, `2020-01-0${day}T00-00-00-000Z_s${day}.jsonl`);
  }

  const fileSystem = createSessionFileSystem(disk);
  const r = rig(fileSystem);
  const session = await createSessionRepo({ fileSystem }).create({ cwd: SESSIONS_ROOT }, ctx);
  const before = groupFiles(disk, GROUP);
  expect(before).toHaveLength(8);

  const handle = await createHarness(deps(r, { session }), ctx);
  expect(handle.session).toBe(session);
  expect(groupFiles(disk, GROUP)).toEqual(before);

  await handle.close(ctx);
});
