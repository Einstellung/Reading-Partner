// The durable harness factory (src/legion/execute/harness.ts).
//
// Nothing here reaches a provider or a disk. The stream is pi-ai's own faux
// provider, handed in as the `streamFn` dependency, so every assistant message
// is scripted; the session store is createSessionFileSystem over an in-memory
// AppData, so the session files are a Map.
//
// The last case is the one the whole harness exists for: a tool that never
// returns, a process that dies on top of it, and a second createHarness over
// the same store that finds the run still open and finishes it.
// Run: scripts/t.sh tests/legion/execute/harness.test.ts

import { expect, test } from "bun:test";
import {
  BACKGROUND_CONTEXT,
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
import { createHarness, type HarnessDeps } from "../../../src/legion/execute/harness";
import { createSessionFileSystem, SESSIONS_ROOT } from "../../../src/platform/app/session-fs";
import { memoryAppData } from "../../support/memory-appdata";

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

// The reason for all of it. The tool never returns and the harness is dropped
// without closing — a process death, as far as the store is concerned. Only the
// session handle is released, because the repo will not hand out a session it
// still thinks is open.
test("a run interrupted mid-tool is listed as open and resumes to completion", async () => {
  const fileSystem = createSessionFileSystem(memoryAppData());
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
    fauxAssistantMessage([fauxText("finished after resume")], { stopReason: "stop" }),
  ]);
  const lane = await handle.harness.lane("soul", ctx);
  void lane.prompt("do the job", undefined, ctx);
  await Bun.sleep(40);
  await handle.session.close(ctx);

  // --- second process, same files ---
  const second = rig(fileSystem);
  second.faux.setResponses([
    fauxAssistantMessage([fauxText("finished after resume")], { stopReason: "stop" }),
  ]);
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
  expect(reopened.open.map((o) => `${o.lane}:${o.kind}`)).toEqual(["soul:run"]);

  const resumedLane = await reopened.harness.lane(reopened.open[0]!.lane, ctx);
  expect((await resumedLane.resume(ctx)).ok).toBe(true);

  // The default is not to run the tool again: the result the model reads is a
  // synthetic one saying the execution was interrupted.
  expect(entered).toEqual(["first:job"]);
  const lines = transcript(await resumedLane.findEntries(undefined, ctx));
  expect(lines[0]).toBe("user text:do the job");
  expect(lines[1]).toBe("assistant toolCall:probe_work");
  expect(lines[2]).toContain("Tool execution was interrupted");
  expect(lines[3]).toBe("assistant text:finished after resume");

  await reopened.close(ctx);
});
