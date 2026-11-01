// What crosses between the page and the Web Worker one program runs in
// (sandbox.ts, worker.ts). The library's remote protocol (pi-codemode
// RemoteCodemodeSandbox / serveCodemodeRemote) is one call per execution with an
// `exchange` callback; over postMessage the callback becomes a numbered
// request the page answers with a reply of the same number.

import type {
  CodemodeRemoteMessage,
  CodemodeRemoteReply,
  CodemodeRemoteRequest,
} from "@earendil-works/pi-codemode/portable";

/** The worker's ceilings: it never runs a program longer or larger than these, whatever is asked. */
export interface WorkerCeilings {
  interruptBudget: number;
  memoryLimitBytes: number;
}

export type ToSandboxWorker =
  | { type: "execute"; request: CodemodeRemoteRequest; wasm: WebAssembly.Module; ceilings: WorkerCeilings }
  | { type: "reply"; seq: number; reply: CodemodeRemoteReply };

export type FromSandboxWorker =
  | { type: "exchange"; seq: number; messages: CodemodeRemoteMessage[] }
  // serveCodemodeRemote resolved: the VM has stopped and its terminal message was delivered.
  | { type: "served" };
