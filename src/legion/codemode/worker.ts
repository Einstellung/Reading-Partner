// The Web Worker one program runs in (docs/soul/686). It holds nothing but the
// QuickJS VM: every tool call goes back to the page as an exchange and the page
// runs the tool, so the worker has no tool, no app data and no reason to fetch
// anything. A program that computes spins here and not on the page's thread,
// and the page terminates the worker once the result is decided.

import { serveCodemodeRemote, type CodemodeRemoteReply } from "@earendil-works/pi-codemode/portable";
import type { FromSandboxWorker, ToSandboxWorker } from "./protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToSandboxWorker>) => void) | null;
  postMessage(message: FromSandboxWorker): void;
}

const scope = globalThis as unknown as WorkerScope;
const pending = new Map<number, (reply: CodemodeRemoteReply) => void>();
let next = 0;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "reply") {
    pending.get(message.seq)?.(message.reply);
    pending.delete(message.seq);
    return;
  }
  const exchange = (messages: Parameters<Parameters<typeof serveCodemodeRemote>[1]>[0]) =>
    new Promise<CodemodeRemoteReply>((resolve) => {
      const seq = ++next;
      pending.set(seq, resolve);
      scope.postMessage({ type: "exchange", seq, messages });
    });
  void serveCodemodeRemote(message.request, exchange, {
    wasm: message.wasm,
    maxInterruptBudget: message.ceilings.interruptBudget,
    maxMemoryLimitBytes: message.ceilings.memoryLimitBytes,
  }).then(() => scope.postMessage({ type: "served" }));
};
