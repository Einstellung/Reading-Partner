// Running one program (docs/soul/686). QuickJS runs synchronously, so a program
// that computes holds whatever thread it runs on until it awaits a tool. On the
// page that thread is the UI's; so each program gets a Web Worker of its own
// that holds only the VM (worker.ts), the tools stay here, and the worker is
// terminated the moment the result is decided, which also stops a program
// still spinning past its deadline. Where there is no Worker the VM runs on
// the calling thread, held by the interrupt budget alone.

import {
  InlineCodemodeSandbox,
  RemoteCodemodeSandbox,
  type CodemodeRemoteExchange,
  type CodemodeRemoteRequest,
  type CodemodeResult,
  type CodemodeTool,
} from "@earendil-works/pi-codemode/portable";
import type { FromSandboxWorker, ToSandboxWorker, WorkerCeilings } from "./protocol";
import type { QuickJsWasm } from "./wasm";

export interface SandboxLimits {
  /** The whole program, tool calls included. */
  timeoutMs: number;
  /**
   * QuickJS interrupt polls a program may spend computing. The only limit on a
   * VM that never yields: about 50,000 a second of a tight loop on an M-series
   * laptop, fewer on a phone.
   */
  interruptBudget: number;
  memoryLimitBytes: number;
}

export type SandboxRunner = "worker" | "inline";

export interface RunProgramOptions {
  tools: CodemodeTool[];
  wasm: QuickJsWasm;
  limits: SandboxLimits;
  runner: SandboxRunner;
  /** Starts the worker. The bundled worker.ts unless a test hands one in. */
  spawn?: () => Worker;
}

/** The worker for one program. Written out in full so Vite sees and bundles the worker entry. */
export function spawnSandboxWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

/** Where this runtime can run a program: a worker wherever there is one. */
export function defaultRunner(): SandboxRunner {
  return typeof Worker === "undefined" ? "inline" : "worker";
}

/** Run `code` against `tools`. Never rejects for anything the program does; the result says what happened. */
export async function runProgram(code: string, options: RunProgramOptions): Promise<CodemodeResult> {
  const { tools, limits } = options;
  if (options.runner === "inline") {
    const sandbox = new InlineCodemodeSandbox({ tools, wasm: options.wasm(), ...limits });
    try {
      return await sandbox.execute(code);
    } finally {
      await sandbox.close();
    }
  }
  let worker: Worker | undefined;
  let settled = false;
  const spawn = options.spawn ?? spawnSandboxWorker;
  const sandbox = new RemoteCodemodeSandbox({
    tools,
    timeoutMs: limits.timeoutMs,
    memoryLimitBytes: limits.memoryLimitBytes,
    interruptBudget: limits.interruptBudget,
    remote: () => ({
      execute: async (request, exchange) => {
        const wasm = await options.wasm();
        // The deadline can pass while the engine is still loading.
        if (settled) return;
        worker = spawn();
        await serve(worker, request, exchange, wasm, {
          interruptBudget: limits.interruptBudget,
          memoryLimitBytes: limits.memoryLimitBytes,
        });
      },
    }),
  });
  try {
    return await sandbox.execute(code);
  } finally {
    settled = true;
    worker?.terminate();
    await sandbox.close();
  }
}

// One execution over postMessage: each exchange the worker sends is answered
// with the client's reply under the same number, until the worker says the VM
// has stopped. A worker that fails to start or dies rejects, which the sandbox
// reports as kind "sandbox".
function serve(
  worker: Worker,
  request: CodemodeRemoteRequest,
  exchange: CodemodeRemoteExchange,
  wasm: WebAssembly.Module,
  ceilings: WorkerCeilings,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<FromSandboxWorker>) => {
      const message = event.data;
      if (message.type === "served") {
        resolve();
        return;
      }
      void exchange(message.messages).then((reply) => {
        const answer: ToSandboxWorker = { type: "reply", seq: message.seq, reply };
        worker.postMessage(answer);
      });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      reject(new Error(event.message || "the code sandbox worker failed"));
    };
    worker.onmessageerror = () => reject(new Error("the code sandbox worker sent a message that could not be read"));
    const start: ToSandboxWorker = { type: "execute", request, wasm, ceilings };
    worker.postMessage(start);
  });
}
