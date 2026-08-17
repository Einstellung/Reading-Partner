import { expect, test } from "bun:test";
import { probePdfSource, startEngine, type EngineStart } from "./engine-start";

// A stand-in engine: a string, so which one came back is legible in a failure.
type FakeEngine = string;

interface Recorded {
  discarded: FakeEngine[];
  reasons: string[];
  directCalls: number;
}

function harness(over: Partial<EngineStart<FakeEngine>>): {
  start: EngineStart<FakeEngine>;
  log: Recorded;
} {
  const log: Recorded = { discarded: [], reasons: [], directCalls: 0 };
  const start: EngineStart<FakeEngine> = {
    createWorker: () => "worker-engine",
    probe: async () => undefined,
    discard: (e) => log.discarded.push(e),
    createDirect: async () => {
      log.directCalls += 1;
      return "direct-engine";
    },
    timeoutMs: 1000,
    onFallback: (r) => log.reasons.push(r),
    // The timeout never fires unless a case asks for it.
    timer: () => new Promise<void>(() => {}),
    ...over,
  };
  return { start, log };
}

test("a worker that answers the probe is the engine, and nothing falls back", async () => {
  const { start, log } = harness({});
  expect(await startEngine(start)).toEqual({ engine: "worker-engine", mode: "worker" });
  expect(log).toEqual({ discarded: [], reasons: [], directCalls: 0 });
});

test("a worker that cannot even be constructed falls back without a discard", async () => {
  const { start, log } = harness({
    createWorker: () => {
      throw new Error("Worker is not defined");
    },
  });
  expect(await startEngine(start)).toEqual({ engine: "direct-engine", mode: "main-thread" });
  expect(log.reasons).toEqual(["Worker is not defined"]);
  expect(log.discarded).toEqual([]);
  expect(log.directCalls).toBe(1);
});

test("a probe that fails falls back and terminates the worker", async () => {
  const { start, log } = harness({
    probe: async () => {
      throw new Error("wasm fetch failed");
    },
  });
  expect(await startEngine(start)).toEqual({ engine: "direct-engine", mode: "main-thread" });
  expect(log.reasons).toEqual(["wasm fetch failed"]);
  expect(log.discarded).toEqual(["worker-engine"]);
});

// Pitfall 21's actual failure: not an error, silence. Nothing rejects, so only
// the timeout ends it.
test("a probe that never settles falls back once the timeout fires", async () => {
  const { start, log } = harness({
    probe: () => new Promise<void>(() => {}),
    timer: async () => undefined,
    timeoutMs: 15_000,
  });
  expect(await startEngine(start)).toEqual({ engine: "direct-engine", mode: "main-thread" });
  expect(log.reasons).toEqual(["no answer from the PDFium worker in 15000ms"]);
  expect(log.discarded).toEqual(["worker-engine"]);
});

// A probe rejecting after the timeout has already been raced past must not
// surface as an unhandled rejection, which would fail the process rather than
// the open.
test("a probe that rejects after the timeout is not an unhandled rejection", async () => {
  let rejectProbe: (e: Error) => void = () => {};
  const { start } = harness({
    probe: () => new Promise<void>((_, reject) => (rejectProbe = reject)),
    timer: async () => undefined,
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    expect(await startEngine(start)).toEqual({ engine: "direct-engine", mode: "main-thread" });
    rejectProbe(new Error("aborted: worker destroyed"));
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  expect(unhandled).toEqual([]);
});

// The fallback is the last resort; if it also fails there is nothing to hand
// back, and the caller has to see the failure rather than a silent null engine.
test("a fallback that fails rejects", async () => {
  const { start } = harness({
    probe: async () => {
      throw new Error("probe failed");
    },
    createDirect: async () => {
      throw new Error("wasm is missing");
    },
  });
  expect(startEngine(start)).rejects.toThrow("wasm is missing");
});

test("the probe PDF's xref offsets point at the objects they number", () => {
  const pdf = probePdfSource();
  expect(pdf.startsWith("%PDF-1.7\n")).toBe(true);
  expect(pdf.endsWith("%%EOF\n")).toBe(true);

  const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)?.[1]);
  expect(pdf.slice(startxref, startxref + 5)).toBe("xref\n");

  const entries = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  expect(entries.length).toBe(3);
  entries.forEach((offset, i) => {
    expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });

  // Every entry in an xref table is exactly 20 bytes, or every offset after it
  // is read from the wrong place.
  const table = pdf.slice(startxref);
  const rows = table.slice(table.indexOf("\n", table.indexOf("0 4")) + 1, table.indexOf("trailer"));
  expect(rows.length).toBe(20 * 4);
});
