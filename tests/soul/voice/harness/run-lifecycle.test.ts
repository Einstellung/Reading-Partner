import { describe, expect, test } from "bun:test";
import { RunGate, endState, hangUp } from "../../../../src/soul/voice/harness/run";
import { RunEnded, parseScript, runScript } from "../../../../src/soul/voice/harness/script";
import type { TraceMark } from "../../../../src/soul/voice/harness/trace";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function call() {
  const listeners = new Set<(m: TraceMark) => void>();
  const fed: string[] = [];
  const emit = (name: string, data?: Record<string, unknown>) => {
    for (const cb of [...listeners]) cb({ name, perfMs: 0, ...(data ? { data } : {}) });
  };
  const deps = {
    subscribe: (cb: (m: TraceMark) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    feed: async (clip: string) => {
      fed.push(clip);
    },
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now: () => performance.now(),
    mark: () => {},
  };
  return { emit, fed, deps, listeners };
}

const script = () =>
  parseScript({
    name: "t",
    locale: "en-US",
    finalReplies: 0,
    tailMs: 0,
    quietMs: 10,
    steps: [{ clip: "a.wav", start: "reply-end", offsetMs: 0, timeoutMs: 60_000 }],
  });

/** The run's outcome, so a test can await it after the call has gone away. */
const outcome = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe("a run ends when the call does", () => {
  test("a call lost mid-run fails the run at once instead of waiting out the step timeout", async () => {
    const c = call();
    const done = outcome(runScript(script(), c.deps));
    c.emit("conv:state", { running: true, reason: "opened" });
    await tick(5);
    c.emit("conv:state", { running: false, reason: "lost" });
    const e = await done;
    expect(e).toBeInstanceOf(RunEnded);
    expect((e as RunEnded).kind).toBe("call-ended");
    expect((e as RunEnded).message).toContain("lost");
    expect(c.fed).toEqual([]);
    expect(c.listeners.size).toBe(0);
  });

  test("a close that comes before this call opened is the last call's tail", async () => {
    const c = call();
    const done = outcome(runScript(script(), c.deps));
    c.emit("conv:state", { running: false, reason: "released" });
    c.emit("conv:state", { running: true, reason: "opened" });
    await tick(5);
    c.emit("speak-begun", { utterance: 1 });
    c.emit("conv:spoken", { utterance: 1, reason: "done" });
    expect(await done).toBeNull();
    expect(c.fed).toEqual(["a.wav"]);
  });

  test("a call that opens and closes at once fails the run", async () => {
    const c = call();
    const done = outcome(runScript(script(), c.deps));
    c.emit("conv:state", { running: true, reason: "opened" });
    c.emit("conv:state", { running: false, reason: "closed" });
    expect(((await done) as RunEnded).message).toContain("closed");
  });

  test("a call that never opens fails the run once callUpMs passes", async () => {
    const c = call();
    const e = (await outcome(runScript(script(), { ...c.deps, callUpMs: 20 }))) as RunEnded;
    expect(e.kind).toBe("call-never-up");
  });

  test("an opened call is not held to callUpMs", async () => {
    const c = call();
    const done = outcome(runScript(script(), { ...c.deps, callUpMs: 20 }));
    c.emit("conv:state", { running: true, reason: "opened" });
    await tick(40);
    c.emit("conv:spoken", { utterance: 1, reason: "done" });
    expect(await done).toBeNull();
  });

  test("aborting ends the run with the signal's reason, and a signal already aborted never feeds", async () => {
    const c = call();
    const ctl = new AbortController();
    const done = outcome(runScript(script(), { ...c.deps, signal: ctl.signal }));
    await tick(5);
    ctl.abort("deadline");
    const e = (await done) as RunEnded;
    expect(e.kind).toBe("aborted");
    expect(e.message).toBe("deadline");

    const late = new AbortController();
    late.abort("too late");
    const e2 = (await outcome(runScript(script(), { ...c.deps, signal: late.signal }))) as RunEnded;
    expect(e2.message).toBe("too late");
    expect(c.fed).toEqual([]);
  });
});

describe("run gate", () => {
  test("refuses a second run, naming the first, until the first ends", () => {
    const g = new RunGate();
    g.begin("one");
    expect(g.busy).toBe("one");
    expect(() => g.begin("two")).toThrow("already going (one)");
    g.end("two");
    expect(g.busy).toBe("one");
    g.end("one");
    expect(g.busy).toBeNull();
    g.begin("two");
    g.end("two");
  });

  test("cancel aborts only the run it names", () => {
    const g = new RunGate();
    const signal = g.begin("one");
    expect(g.cancel("other", "x")).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(g.cancel("one", "from Linux")).toBe(true);
    expect(signal.reason).toBe("from Linux");
    g.end("one");
  });

  test("the deadline aborts the run, and ending it first clears the timer", async () => {
    const g = new RunGate();
    const s = g.begin("one", 20);
    await tick(40);
    expect(s.aborted).toBe(true);
    expect(String(s.reason)).toContain("deadline");
    g.end("one");
    const s2 = g.begin("two", 20);
    g.end("two");
    await tick(40);
    expect(s2.aborted).toBe(false);
  });
});

describe("teardown", () => {
  test("hangUp stops the call and then waits", async () => {
    const log: string[] = [];
    await hangUp(
      { start: () => log.push("start"), stop: () => log.push("stop") },
      async (ms) => {
        log.push(`sleep:${ms}`);
      },
      300,
    );
    expect(log).toEqual(["stop", "sleep:300"]);
  });

  test("endState reports done, or failed with the message", () => {
    expect(endState(null)).toEqual({ state: "done" });
    expect(endState(new RunEnded("aborted", "deadline"))).toEqual({ state: "failed", message: "deadline" });
    expect(endState("boom")).toEqual({ state: "failed", message: "boom" });
  });
});
