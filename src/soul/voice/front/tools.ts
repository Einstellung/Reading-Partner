// The front's four tools (docs/companion/136 "前台接口"、"delegate"、"落盒"). The
// only side effects are handing work off and calling it back, and both can be
// undone. What a call answers is never fed back to the model: the front's turn
// ends with its sentence (136 "级联前台的一次回复"), so the answer is for the log.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../../legion/durable/contract";

export const FRONT_TOOL_NAMES = ["delegate", "cancel", "read_out", "show"] as const;

/** What the tools do, by list number. The cascade front implements it. */
export interface FrontActions {
  delegate(req: { kind: string; task: string; follows?: number }): Promise<string>;
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

export function buildFrontTools(actions: FrontActions): AgentTool[] {
  return [
    {
      name: "delegate",
      label: () => "Handing it over",
      effect: "write",
      gate: "instruction",
      description:
        "Hand a question to a worker that thinks it through out of sight and comes back later. Say one short sentence " +
        "to the reader in the same reply; this returns at once and the answer arrives in the box, not in this reply.",
      parameters: Type.Object({
        kind: Type.String({ description: 'The kind of work. Usually "think".' }),
        task: Type.String({
          description:
            "The brief, for someone who cannot hear this call: what to answer and what counts as answered. Whole, never \"same as before\".",
        }),
        follows: Type.Optional(numberParam("earlier result this one follows on from")),
      }),
      execute: async (args) => {
        const kind = String(args.kind ?? "").trim() || "think";
        const task = String(args.task ?? "").trim();
        if (!task) throw new Error("delegate needs a task.");
        const follows = args.follows === undefined ? undefined : num(args.follows, "delegate");
        return actions.delegate({ kind, task, ...(follows === undefined ? {} : { follows }) });
      },
    },
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
