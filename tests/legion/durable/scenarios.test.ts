// pi-durable spike, in one process: JSONL on AppData survives a reopen, a steer
// enters at the post-tools boundary, and two conversations stream at once in
// one harness. docs/research/pi-durable-spike.md.

import { describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { openDurableJsonl } from "../../../src/legion/durable/durable-fs";
import { lines, livePartial, openSpike, SPIKE_MODEL, type SpikeTools } from "../../../src/legion/durable/spike";
import { memoryAppData } from "../../support/memory-appdata";

const ctx = BACKGROUND_CONTEXT;
const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const quiet: SpikeTools = { lookup: async (q) => `text of ${q}`, note: async () => "noted" };

function lastUserText(context: TranscriptContext): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role === "user") return typeof message.content === "string" ? message.content : "";
  }
  return "";
}

describe("pi-durable on AppData JSONL", () => {
  test("a finished run reads back the same after close and reopen", async () => {
    const disk = memoryAppData();
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage(fauxText("Chapter one is about tides."))]);
    const first = await openSpike({ storage: await openDurableJsonl("c", disk, ctx), faux, tools: quiet });
    const root = await first.root(ctx, { agent: { model: SPIKE_MODEL } });
    await (await root.submit({ type: "input", content: "What is chapter one about?" }, ctx)).wait(ctx);
    const before = lines((await root.viewState(ctx)).value.entries);
    await first.close(ctx);

    const second = await openSpike({ storage: await openDurableJsonl("c", disk, ctx), faux, tools: quiet });
    const after = lines((await (await second.root(ctx)).viewState(ctx)).value.entries);
    expect(after).toEqual(before);
    expect(last(after)).toEqual({ kind: "pi.assistant", text: "Chapter one is about tides." });
    await second.close(ctx);
  });

  test("a torn last line is cut on reopen", async () => {
    const disk = memoryAppData();
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage(fauxText("Done."))]);
    const first = await openSpike({ storage: await openDurableJsonl("c", disk, ctx), faux, tools: quiet });
    const root = await first.root(ctx, { agent: { model: SPIKE_MODEL } });
    await (await root.submit({ type: "input", content: "hi" }, ctx)).wait(ctx);
    await first.close(ctx);
    await disk.appendText("durable/c/main.jsonl", '{"seq":99,"half');

    const second = await openSpike({ storage: await openDurableJsonl("c", disk, ctx), faux, tools: quiet });
    const after = lines((await (await second.root(ctx)).viewState(ctx)).value.entries);
    expect(last(after)?.text).toBe("Done.");
    expect(new TextDecoder().decode(disk.files.get("durable/c/main.jsonl"))).not.toContain("half");
    await second.close(ctx);
  });

  test("a steer sent while a tool runs enters after the tool result", async () => {
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
    const seen: string[][] = [];
    const faux = fauxProvider();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("lookup", { query: "ch2" })], { stopReason: "toolUse" }),
      (context) => {
        seen.push(context.messages.map((m) => m.role));
        return fauxAssistantMessage(fauxText(`answering: ${lastUserText(context)}`));
      },
    ]);
    const harness = await openSpike({ storage: await openDurableJsonl("c", memoryAppData(), ctx), faux, tools });
    const root = await harness.root(ctx, { agent: { model: SPIKE_MODEL } });
    const input = await root.submit({ type: "input", content: "Summarise chapter two" }, ctx);
    await lookupStarted;
    const steer = await root.submit({ type: "input", content: "Only the first page", whenBusy: "steer" }, ctx);
    expect((await root.viewState(ctx)).value.docs["pi.inbox"]).toBeDefined();
    release();
    const settled = await input.wait(ctx);
    const steered = await steer.wait(ctx);

    expect(settled.status).toBe("done");
    expect(steered.status).toBe("done");
    expect(seen).toEqual([["system", "user", "assistant", "toolResult", "user"]]);
    const kinds = lines((await root.viewState(ctx)).value.entries).map((l) => `${l.kind}:${l.text}`);
    expect(kinds.filter((k) => !k.startsWith("pi.system"))).toEqual([
      "pi.user:Summarise chapter two",
      'pi.assistant:[call lookup {"query":"ch2"}]',
      "pi.tool-result:text of ch2",
      "pi.user:Only the first page",
      "pi.assistant:answering: Only the first page",
    ]);
    await harness.close(ctx);
  });

  test("two conversations in one harness stream at the same time", async () => {
    const faux = fauxProvider({ tokensPerSecond: 400 });
    const answer = (context: TranscriptContext) =>
      fauxAssistantMessage(fauxText(`${lastUserText(context)}: ${"word ".repeat(80)}`));
    faux.setResponses([answer, answer]);
    const harness = await openSpike({ storage: await openDurableJsonl("c", memoryAppData(), ctx), faux, tools: quiet });
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
    const [sa, sb] = await Promise.all([
      a.submit({ type: "input", content: "A" }, ctx),
      b.submit({ type: "input", content: "B" }, ctx),
    ]);
    await Promise.all([sa.wait(ctx), sb.wait(ctx)]);

    expect(overlap).toBe(true);
    expect(last(lines((await a.viewState(ctx)).value.entries))?.text.startsWith("A: word")).toBe(true);
    expect(last(lines((await b.viewState(ctx)).value.entries))?.text.startsWith("B: word")).toBe(true);
    await harness.close(ctx);
  });
});
