// The front's four tools (docs/companion/136 "前台接口"、"delegate"、"落盒"). The
// only side effects are handing work off and calling it back, and both can be
// undone. What a call answers is never fed back to the model: the front's turn
// ends with its sentence (136 "级联前台的一次回复"), so the answer is for the log.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../../legion/durable/contract";

export const FRONT_TOOL_NAMES = ["delegate", "cancel", "read_out", "show"] as const;

/** What the tools do, by list number. The cascade front implements it. */
export interface FrontActions {
  cancel(number: number): Promise<string>;
  readOut(number: number): Promise<string>;
  show(number: number): Promise<string>;
}

const numberParam = (what: string) => Type.Number({ description: `The number in the list of the ${what}.` });

function num(v: unknown, tool: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${tool} needs a number from the list.`);
  return n;
}

/** `delegate` is the back half's (soul/think's buildCallDelegateTool), passed in. */
export function buildFrontTools(delegate: AgentTool, actions: FrontActions): AgentTool[] {
  return [
    delegate,
    {
      name: "cancel",
      label: () => "Calling it back",
      effect: "write",
      gate: "instruction",
      description: "Call back a run the reader no longer wants. It is dropped without landing anywhere.",
      parameters: Type.Object({ number: numberParam("run to call back") }),
      execute: async (args) => actions.cancel(num(args.number, "cancel")),
    },
    {
      name: "read_out",
      label: () => "Reading it out",
      effect: "read",
      description:
        "Read a result out to the reader word for word, when they ask to hear it. You do not say the text yourself.",
      parameters: Type.Object({ number: numberParam("result to read out") }),
      execute: async (args) => actions.readOut(num(args.number, "read_out")),
    },
    {
      name: "show",
      label: () => "Opening it",
      effect: "read",
      description: "Open a result on the screen, when the reader would rather read it themselves. The call goes on.",
      parameters: Type.Object({ number: numberParam("result to open") }),
      execute: async (args) => actions.show(num(args.number, "show")),
    },
  ];
}
