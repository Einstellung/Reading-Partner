// pi-durable spike: SIGKILL a real process mid-run and reopen its JSONL
// directory in a new one. docs/research/pi-durable-spike.md.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHILD = join(import.meta.dir, "crash-child.ts");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Event = { event: string; [key: string]: unknown };

async function events(proc: Bun.Subprocess<"ignore", "pipe", "inherit">, killOn?: string): Promise<Event[]> {
  const seen: Event[] = [];
  const decoder = new TextDecoder();
  let buffered = "";
  const reader = proc.stdout.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffered.slice(0, newline)) as Event;
      buffered = buffered.slice(newline + 1);
      seen.push(event);
      if (killOn !== undefined && event.event === killOn) proc.kill("SIGKILL");
    }
  }
  await proc.exited;
  return seen;
}

async function crashAndResume(mode: string): Promise<{ first: Event[]; second: Event[] }> {
  const dir = mkdtempSync(join(tmpdir(), "pi-durable-"));
  dirs.push(dir);
  const spawn = (args: string[]) =>
    Bun.spawn(["bun", CHILD, ...args], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const first = await events(spawn([mode, "first", dir]), "kill-me");
  const id = String(first.find((e) => e.event === "submitted")?.id);
  const second = await events(spawn([mode, "resume", dir, id]));
  return { first, second };
}

describe("pi-durable across a SIGKILL", () => {
  test("a streamed answer killed halfway keeps its committed text and the run finishes", async () => {
    const { first, second } = await crashAndResume("stream");
    const killedAt = first.find((e) => e.event === "kill-me")?.partialChars as number;
    const reopened = second.find((e) => e.event === "reopened")!;
    expect(reopened.partialChars as number).toBeGreaterThanOrEqual(killedAt - 40);
    const settled = second.find((e) => e.event === "settled")!;
    expect(settled.status).toBe("done");
    const request = second.find((e) => e.event === "model-request")!;
    // The retry is a fresh request: the partial is not sent back, and the
    // committed partial is replaced by the new attempt (docs/pitfall/ai/511).
    expect(request.roles).toEqual(["system", "user"]);
    // The old partial stays visible until the retry commits; a short retry
    // answer goes straight to the transcript and clears it.
    expect(second.find((e) => e.event === "partial-changed")?.to).toBeNull();
    const settledLines = settled.lines as { text: string }[];
    expect(settledLines[settledLines.length - 1]?.text).toBe("resumed; saw none");
  }, 30_000);

  test("an unsafe tool killed mid-call gives the model an interrupted error", async () => {
    const { second } = await crashAndResume("unsafe");
    expect(second.some((e) => e.event === "note-started")).toBe(false);
    const request = second.find((e) => e.event === "model-request")!;
    expect(request.lastTool).toBe(
      "error: <harness>\n[error] Tool note was interrupted and may have partially run\n</harness>",
    );
    expect(second.find((e) => e.event === "settled")?.status).toBe("done");
  }, 30_000);

  test("a replay-safe tool killed mid-call runs again", async () => {
    const { second } = await crashAndResume("safe");
    expect(second.some((e) => e.event === "lookup-started")).toBe(true);
    const request = second.find((e) => e.event === "model-request")!;
    expect(request.lastTool).toBe("ok: passage about tides");
  }, 30_000);
});
