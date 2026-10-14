// The back half as one call sees it (docs/companion/136 "delegate"、"回来"、"落盒"):
// soul/think's CallBackend with the call's id and place bound, so the front
// passes numbers and nothing else.

import type { BoxOrigin } from "../../../box";
import type { AgentTool } from "../../../legion/durable/contract";
import { buildCallDelegateTool, type CallBackend, type CallNote, type CallTask } from "../../think";

export interface CallBack {
  delegateTool(): AgentTool;
  cancel(n: number): Promise<{ ok: boolean; reason?: string }>;
  tasks(): CallTask[];
  text(n: number): Promise<string | null>;
  told(n: number): Promise<boolean>;
  subscribe(fn: (note: CallNote) => void): () => void;
}

export function bindCallBack(opts: {
  backend: CallBackend;
  callId: string;
  deliverTo: BoxOrigin;
  kinds: () => readonly string[];
}): CallBack {
  const { backend, callId } = opts;
  return {
    delegateTool: () => buildCallDelegateTool({ callId, deliverTo: opts.deliverTo, backend, kinds: opts.kinds }),
    cancel: async (n) => {
      const r = await backend.cancel(callId, n);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    tasks: () => backend.tasks(callId),
    text: (n) => backend.text(callId, n),
    told: (n) => backend.told(callId, n),
    subscribe: (fn) => backend.subscribe(callId, fn),
  };
}
