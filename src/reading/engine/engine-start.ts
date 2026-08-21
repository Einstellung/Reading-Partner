// How the PDFium engine comes up, and how we prove it came up.
//
// The worker engine's failure mode is silence, not an error: its worker posts
// `{type:"wasmError"}` when the wasm fetch throws, and the RemoteExecutor has no
// branch for that message type, so its ready task never settles and every later
// call waits on it forever (docs/pitfall/21). A `catch` cannot see that. So the
// engine is not handed out until it has answered something, and a timeout turns
// "never" into a fallback to the main-thread engine instead of a hung reader.
//
// Kept apart from engine-singleton.ts, which owns the module-level promise and
// the real @embedpdf imports: with every side injected, the fallback path — the
// one that only runs on a platform we cannot reproduce here — is testable.

export type EngineMode = "worker" | "main-thread";

export interface EngineStart<E> {
  /** Build the worker engine. May throw where there is no Worker at all. */
  createWorker: () => E | Promise<E>;
  /** A round trip that only completes if the worker is alive and answering. */
  probe: (engine: E) => Promise<unknown>;
  /** Terminate a worker engine that did not pass the probe. */
  discard: (engine: E) => void;
  /** The main-thread engine: the fallback, and what shipped before this. */
  createDirect: () => Promise<E>;
  /** How long the probe may take before the worker counts as hung. */
  timeoutMs: number;
  /** Why the reader is rasterising on the main thread after all. */
  onFallback: (reason: string) => void;
  /** Injectable so a test does not spend the timeout. */
  timer?: (ms: number) => Promise<void>;
}

export interface StartedEngine<E> {
  engine: E;
  mode: EngineMode;
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Start the worker engine, prove it answers, and fall back to the main-thread
 * engine on any failure or on silence. Only a failure of the fallback itself
 * rejects: the reader opening a book matters more than where it rasterises.
 */
export async function startEngine<E>(start: EngineStart<E>): Promise<StartedEngine<E>> {
  const timer = start.timer ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let engine: E;
  try {
    engine = await start.createWorker();
  } catch (e) {
    start.onFallback(reasonOf(e));
    return { engine: await start.createDirect(), mode: "main-thread" };
  }

  // Neither side of the race rejects: the probe's own failure is caught here so
  // that a rejection arriving after the timeout has already been raced past
  // cannot surface as an unhandled rejection.
  const probed = start.probe(engine).then(
    () => null,
    (e: unknown) => reasonOf(e),
  );
  const outcome = await Promise.race([
    probed,
    timer(start.timeoutMs).then(() => `no answer from the PDFium worker in ${start.timeoutMs}ms`),
  ]);
  if (outcome === null) return { engine, mode: "worker" };

  start.discard(engine);
  start.onFallback(outcome);
  return { engine: await start.createDirect(), mode: "main-thread" };
}

// A one-page PDF, built rather than pasted so the byte offsets in its xref
// table cannot drift from the objects they point at. This is what the probe
// opens: a valid document is an unambiguous pass (a malformed one would come
// back as an error, which is also an answer, but then "the worker replied" and
// "the worker failed to start" would have to be told apart by error code).
const PROBE_OBJECTS = [
  "<</Type/Catalog/Pages 2 0 R>>",
  "<</Type/Pages/Kids[3 0 R]/Count 1>>",
  "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>",
];

export function probePdfSource(): string {
  const header = "%PDF-1.7\n";
  const offsets: number[] = [];
  let body = "";
  PROBE_OBJECTS.forEach((obj, i) => {
    offsets.push(header.length + body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const startxref = header.length + body.length;
  const size = PROBE_OBJECTS.length + 1;
  // Every xref entry is exactly 20 bytes, free list head first.
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  return (
    header + body + xref + `trailer\n<</Size ${size}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`
  );
}

export function probePdfBytes(): ArrayBuffer {
  // The source is pure ASCII, so string offsets and byte offsets are the same
  // number — which is what lets probePdfSource count them with String.length.
  return new TextEncoder().encode(probePdfSource()).buffer as ArrayBuffer;
}
