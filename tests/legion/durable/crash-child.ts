// A child process for the pi-durable crash tests (crash.test.ts): runs one
// phase of a scene on JSONL over a real directory and prints JSON lines. The
// test SIGKILLs the first phase when it prints its kill marker, then runs the
// resume phase on the same directory.
//
//   bun tests/legion/durable/crash-child.ts <mode> <phase> <dir> [submissionId]
//   mode:  stream | unsafe | safe | measure
//   phase: first | resume
//
// `measure` streams one long Chinese answer through the write meter and prints
// the counts; PARTIAL_MS overrides settings.progress.partialIntervalMs.

import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { SubmissionId } from "@earendil-works/pi-durable";
import { openDurableJsonl, type DurableDisk } from "../../../src/legion/durable/durable-fs";
import { meterDisk } from "../../../src/legion/durable/write-meter";
import { lines, livePartial, openSpike, SPIKE_MODEL, type SpikeTools } from "../../../src/legion/durable/spike";

const [mode, phase, dir, submissionArg] = process.argv.slice(2);
const ctx = BACKGROUND_CONTEXT;
const out = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};
const hang = (): Promise<never> => new Promise(() => {});

function nodeDisk(root: string): DurableDisk {
  const at = (path: string) => join(root, path);
  return {
    async exists(path) {
      return stat(at(path)).then(() => true, () => false);
    },
    readBytes: async (path) => new Uint8Array(await readFile(at(path))),
    writeBytes: (path, bytes) => writeFile(at(path), bytes),
    appendText: (path, text) => appendFile(at(path), text),
    async readDir(path) {
      return (await readdir(at(path), { withFileTypes: true })).map((d) => ({
        name: d.name,
        isFile: d.isFile(),
        isDirectory: d.isDirectory(),
        isSymlink: d.isSymbolicLink(),
      }));
    },
    mkdirp: async (path) => {
      await mkdir(at(path), { recursive: true });
    },
    async stat(path) {
      const s = await stat(at(path)).catch(() => null);
      return s && { size: s.size, mtimeMs: s.mtimeMs };
    },
    remove: (path) => rm(at(path)),
    rename: (from, to) => rename(at(from), at(to)),
  };
}

function lastToolResult(context: TranscriptContext): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role !== "toolResult") continue;
    const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return `${message.isError ? "error" : "ok"}: ${text}`;
  }
  return "none";
}

const LONG = "潮汐是月球和太阳引力共同作用的结果，".repeat(80);

const faux = fauxProvider(
  mode === "measure"
    ? { tokensPerSecond: 70, tokenSize: { min: 1, max: 2 } }
    : { tokensPerSecond: mode === "stream" ? 150 : 1000 },
);
const reply = (context: TranscriptContext) => {
  out({ event: "model-request", roles: context.messages.map((m) => m.role), lastTool: lastToolResult(context) });
  return fauxAssistantMessage(fauxText(`resumed; saw ${lastToolResult(context)}`));
};
if (phase === "first") {
  if (mode === "stream" || mode === "measure") faux.setResponses([fauxAssistantMessage(fauxText(LONG))]);
  if (mode === "unsafe") faux.setResponses([fauxAssistantMessage([fauxToolCall("note", { text: "tides" })], { stopReason: "toolUse" })]);
  if (mode === "safe") faux.setResponses([fauxAssistantMessage([fauxToolCall("lookup", { query: "tides" })], { stopReason: "toolUse" })]);
} else {
  faux.setResponses([reply]);
}

const tools: SpikeTools = {
  async lookup(query) {
    out({ event: "lookup-started", phase });
    if (phase === "first") return hang();
    return `passage about ${query}`;
  },
  async note(text) {
    out({ event: "note-started", phase });
    if (phase === "first") return hang();
    return `noted ${text}`;
  },
};

const partialMs = Number(process.env.PARTIAL_MS ?? 100);
const { disk, stats } = meterDisk(nodeDisk(dir));
const storage = await openDurableJsonl("conv", disk, ctx);
const harness = await openSpike({
  storage,
  faux,
  tools,
  settings: { progress: { partialIntervalMs: partialMs, outputIntervalMs: partialMs } },
});
const root = await harness.root(ctx, { agent: { model: SPIKE_MODEL } });
const view = await root.viewState(ctx);

if (phase === "first") {
  let killable = false;
  view.subscribe((value) => {
    const partial = livePartial(value.docs) ?? "";
    if (!killable && mode === "stream" && partial.length >= 200) {
      killable = true;
      out({ event: "kill-me", partialChars: partial.length });
    }
  });
  const submission = await root.submit({ type: "input", content: "Explain the tides" }, ctx);
  out({ event: "submitted", id: submission.id });
  if (mode === "unsafe" || mode === "safe") {
    // The tool printed its start before this line can be read; the intent was committed before execute().
    setTimeout(() => out({ event: "kill-me" }), 300);
  }
  const settled = await submission.wait(ctx);
  if (mode === "measure") {
    const all = lines(view.value.entries);
    const answer = all[all.length - 1]?.text ?? "";
    const files: Record<string, number> = {};
    for (const name of await readdir(join(dir, "durable/conv"))) {
      files[name] = (await stat(join(dir, "durable/conv", name))).size;
    }
    out({ event: "measured", status: settled.status, partialMs, answerBytes: new TextEncoder().encode(answer).length, stats, files });
  }
  await harness.close(ctx);
} else {
  out({
    event: "reopened",
    lines: lines(view.value.entries),
    partialChars: (livePartial(view.value.docs) ?? "").length,
  });
  // When the partial left from the killed attempt first stops showing, and what replaces it.
  const left = livePartial(view.value.docs);
  let reported = false;
  view.subscribe((value) => {
    const partial = livePartial(value.docs);
    if (!reported && partial !== left) {
      reported = true;
      out({ event: "partial-changed", to: partial === undefined ? null : partial.slice(0, 40) });
    }
  });
  const submission = await harness.submission(Number(submissionArg) as SubmissionId, ctx);
  harness.resume();
  const settled = await submission!.wait(ctx);
  out({ event: "settled", status: settled.status, lines: lines(view.value.entries) });
  await harness.close(ctx);
}
