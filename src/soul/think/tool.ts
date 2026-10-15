// The soul's `delegate` tool as a voice call mounts it (docs/companion/136
// delegate): the same name, kind and task, plus `follows` and `replaces`, and
// routed through the call's ledger so the run is numbered on the call's list.
// Where the answer goes is the call's place, filled here and never by the model.

import { Type } from "@earendil-works/pi-ai";
import type { BoxOrigin } from "../../box";
import type { AgentTool } from "../../legion/durable/contract";
import { DELEGATE_DESCRIPTION, DELEGATE_TOOL, TASK_PARAMETER_DESCRIPTION, kindParameterDescription } from "../delegate";
import type { CallBackend } from "./contract";

export interface CallDelegateDeps {
  callId: string;
  /** Where the call is held. */
  deliverTo: BoxOrigin;
  backend: CallBackend;
  /** The kinds the catalogue offers. */
  kinds: () => readonly string[];
}

/** `delegate` for one call. Answers with the task's number, or throws the refusal. */
export function buildCallDelegateTool(deps: CallDelegateDeps): AgentTool {
  const kinds = deps.kinds();
  return {
    name: DELEGATE_TOOL,
    label: () => "Handing it over",
    effect: "write",
    description: DELEGATE_DESCRIPTION,
    parameters: Type.Object({
      kind: Type.String({ description: kindParameterDescription(kinds) }),
      task: Type.String({ description: TASK_PARAMETER_DESCRIPTION }),
      follows: Type.Optional(
        Type.Integer({
          description:
            "A number from this call's list this task builds on, such as a follow-up question about it. " +
            "Its brief, and what came back if anything, go with the new task; it goes on running.",
        }),
      ),
      replaces: Type.Optional(
        Type.Integer({
          description:
            "Only when the reader changed their mind about an earlier request (\"no, I meant…\"): its number. " +
            "That task is called back and this one is asked instead, written in full. A new question, " +
            "even about the same thing, replaces nothing.",
        }),
      ),
    }),
    execute: async (args) => {
      const kind = String(args.kind ?? "").trim();
      const result = await deps.backend.dispatch({
        callId: deps.callId,
        ...(kind ? { kind } : {}),
        task: String(args.task ?? ""),
        ...(typeof args.follows === "number" ? { follows: args.follows } : {}),
        ...(typeof args.replaces === "number" ? { replaces: args.replaces } : {}),
        deliverTo: deps.deliverTo,
      });
      if (!result.ok) throw new Error(result.reason);
      const replaced = result.replaced === undefined ? "" : ` It replaces task ${result.replaced}, which is cancelled.`;
      return {
        text: `Handed over as task ${result.n}.${replaced} It comes back on its own; do not answer it yourself.`,
        receipt: { label: `Task ${result.n}`, summary: String(args.task ?? "").trim(), link: { kind: "run" as const, id: result.runId } },
      };
    },
  };
}
