// The pi-durable spike scenes that need no process kill, runnable in any JS
// engine: a JSONL round trip on an in-memory AppData, a steer at the post-tools
// boundary, and two conversations streaming at once. The WebKitGTK and iOS
// Simulator runs load this through a page (docs/research/pi-durable-spike.md).

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { AppDataFs, DirEntry } from "../../platform/app/appdata";
import { openDurableJsonl, type DurableDisk } from "./durable-fs";
import { lines, livePartial, openSpike, SPIKE_MODEL, type SpikeTools } from "./spike";

export interface ProbeReport {
  roundTrip: boolean;
  steer: boolean;
  parallel: boolean;
  ms: number;
  error?: string;
}

const ctx = BACKGROUND_CONTEXT;
const quiet: SpikeTools = { lookup: async (q) => `text of ${q}`, note: async () => "noted" };

/** The smallest DurableDisk: files and directories in two maps. */
export function mapDisk(): DurableDisk {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([""]);
  const encoder = new TextEncoder();
  const missing = (path: string) => new Error(`no such file: ${path}`);
  const disk: Pick<AppDataFs, keyof DurableDisk> = {
    exists: async (path) => files.has(path) || dirs.has(path),
    readBytes: async (path) => files.get(path) ?? Promise.reject(missing(path)),
    writeBytes: async (path, bytes) => void files.set(path, bytes),
    appendText: async (path, text) => {
      const before = files.get(path) ?? new Uint8Array();
      const added = encoder.encode(text);
      const after = new Uint8Array(before.length + added.length);
      after.set(before);
      after.set(added, before.length);
      files.set(path, after);
    },
    readDir: async (path) => {
      const prefix = path === "" ? "" : `${path}/`;
      const names = new Set<string>();
      for (const key of [...files.keys(), ...dirs]) {
        if (key !== path && key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
      }
      return [...names].map((name): DirEntry => {
        const isDirectory = dirs.has(`${prefix}${name}`);
        return { name, isFile: !isDirectory, isDirectory, isSymlink: false };
      });
    },
    mkdirp: async (path) => {
      const parts = path.split("/");
      for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    },
    stat: async (path) => {
      const bytes = files.get(path);
      return bytes ? { size: bytes.length, mtimeMs: 0 } : null;
    },
    remove: async (path) => {
      if (!files.delete(path)) throw missing(path);
    },
    rename: async (from, to) => {
      const bytes = files.get(from);
      if (!bytes) throw missing(from);
      files.delete(from);
      files.set(to, bytes);
    },
  };
  return disk;
}

function lastUserText(context: TranscriptContext): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role === "user") return typeof message.content === "string" ? message.content : "";
  }
  return "";
}

async function roundTrip(): Promise<boolean> {
  const disk = mapDisk();
  const faux = fauxProvider();
  faux.setResponses([fauxAssistantMessage(fauxText("Chapter one is about tides."))]);
  const first = await openSpike({ storage: await openDurableJsonl("c", disk, ctx), faux, tools: quiet });
  const root = await first.root(ctx, { agent: { model: SPIKE_MODEL } });
  await (await root.submit({ type: "input", content: "What is chapter one about?" }, ctx)).wait(ctx);
  await first.close(ctx);
  const second = await openSpike({ storage: await openDurableJsonl("c", disk, ctx), faux, tools: quiet });
  const after = lines((await (await second.root(ctx)).viewState(ctx)).value.entries);
  await second.close(ctx);
  return after[after.length - 1]?.text === "Chapter one is about tides.";
}

async function steer(): Promise<boolean> {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const lookupStarted = new Promise<void>((resolve) => (started = resolve));
  const tools: SpikeTools = {
    ...quiet,
    lookup: async (q) => {
      started();
      await gate;
      return `text of ${q}`;
    },
  };
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("lookup", { query: "ch2" })], { stopReason: "toolUse" }),
    (context) => fauxAssistantMessage(fauxText(`answering: ${lastUserText(context)}`)),
  ]);
  const harness = await openSpike({ storage: await openDurableJsonl("c", mapDisk(), ctx), faux, tools });
  const root = await harness.root(ctx, { agent: { model: SPIKE_MODEL } });
  const input = await root.submit({ type: "input", content: "Summarise chapter two" }, ctx);
  await lookupStarted;
  await root.submit({ type: "input", content: "Only the first page", whenBusy: "steer" }, ctx);
  release();
  await input.wait(ctx);
  const kinds = lines((await root.viewState(ctx)).value.entries)
    .filter((l) => l.kind !== "pi.system")
    .map((l) => l.kind);
  await harness.close(ctx);
  return kinds.join() === "pi.user,pi.assistant,pi.tool-result,pi.user,pi.assistant";
}

async function parallel(): Promise<boolean> {
  const faux = fauxProvider({ tokensPerSecond: 400 });
  const answer = (context: TranscriptContext) =>
    fauxAssistantMessage(fauxText(`${lastUserText(context)}: ${"word ".repeat(80)}`));
  faux.setResponses([answer, answer]);
  const harness = await openSpike({ storage: await openDurableJsonl("c", mapDisk(), ctx), faux, tools: quiet });
  const agent = { model: SPIKE_MODEL };
  const a = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
  const b = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx);
  const streaming = new Set<string>();
  let overlap = false;
  for (const [name, conversation] of [["a", a], ["b", b]] as const) {
    (await conversation.viewState(ctx)).subscribe((value) => {
      if (livePartial(value.docs)) streaming.add(name);
      else streaming.delete(name);
      if (streaming.size === 2) overlap = true;
    });
  }
  const submitted = await Promise.all([
    a.submit({ type: "input", content: "A" }, ctx),
    b.submit({ type: "input", content: "B" }, ctx),
  ]);
  await Promise.all(submitted.map((s) => s.wait(ctx)));
  await harness.close(ctx);
  return overlap;
}

export async function runProbe(): Promise<ProbeReport> {
  const start = performance.now();
  const report: ProbeReport = { roundTrip: false, steer: false, parallel: false, ms: 0 };
  try {
    report.roundTrip = await roundTrip();
    report.steer = await steer();
    report.parallel = await parallel();
  } catch (cause) {
    report.error = cause instanceof Error ? `${cause.name}: ${cause.message}\n${cause.stack ?? ""}` : String(cause);
  }
  report.ms = Math.round(performance.now() - start);
  return report;
}
