// The soul's one way of handing work off (docs/68, docs/55).
//
// Every turn carries it, whatever is on the desk, because the judgement it
// exists for — answer now or hand this over — is the soul's and not the
// material's. What the model supplies is a kind and a brief; where the answer is
// to be given back is filled in here from the place the turn is being held, so
// the model cannot address an answer somewhere the reader never was.
//
// The brief is written to a file and the run carries the path, never the text:
// a run record is a set of references (legion/run/types.ts). The file is
// machine-local, like the `local` runs it belongs to.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../legion/execute/turn";
import { appRunner } from "../legion/execute/runner";
import { delegableWorkerKinds } from "../legion/execute/worker";
import type { DelegateInput, Delegated } from "../legion/execute/worker";
import { appData } from "../platform/app/appdata";
import type { BoxOrigin } from "../box";

export const DELEGATE_TOOL = "delegate";

/** Where a brief the soul wrote is kept. Registered in palace/kinds.ts. */
export const BRIEFS_DIR = "legion/briefs";

/** The whole of what the model is told about delegating. */
export const DELEGATE_DESCRIPTION =
  "Hand a piece of work to a worker that runs out of sight and comes back later. " +
  "Use it when the work takes more than a moment — anything that would be several " +
  "rounds of tool calls — and say so to the reader in the same turn, because this " +
  "returns immediately and the answer arrives in this conversation afterwards, not " +
  "in this reply. Do not use it for anything you can answer now, or for anything a " +
  "tool you already hold answers in this turn. Which kinds of work there are is in " +
  "the kind parameter, and each kind's own guidance says when it is the right one. " +
  "You cannot steer a run once it starts and you will not see what it did, so put " +
  "the whole job in the task, written for someone who cannot see this conversation " +
  "and has not read the material in front of you.";

export interface DelegateDeps {
  /** The place this turn is being held. The run is delivered back to it. */
  origin?: BoxOrigin;
  /** The runner. This device's own unless a test hands one in. */
  delegate?: (input: DelegateInput) => Promise<Delegated>;
  /** Where the brief text is put, answering the path. AppData unless injected. */
  writeBrief?: (text: string) => Promise<string>;
  /**
   * The kinds this device can run and the soul may ask for. The module registry
   * unless injected — and only the kinds registered as `delegable`: a kind whose
   * brief is a shape rather than prose (the day's collection, a URL to take in)
   * is started by its own domain's code and is not the soul's to hand a task to.
   */
  kinds?: () => readonly string[];
}

/** Write one brief where the run can point at it, and answer with the path. */
export async function writeBriefFile(text: string): Promise<string> {
  const path = `${BRIEFS_DIR}/${crypto.randomUUID()}.md`;
  await appData.mkdirp(BRIEFS_DIR);
  await appData.writeAtomic(path, text);
  return path;
}

/**
 * The delegate tool, on every soul turn. It rides whether or not this device has
 * a worker registered: which kinds there are is a fact about the build and the
 * moment, and a tool that comes and goes is one the model cannot learn to reach
 * for. A call naming a kind nothing runs is refused in the call, where the model
 * can read why.
 */
// The brief's first sentence, for the receipt: the whole brief is a paragraph
// written for a worker, and the receipt has one line.
function firstSentence(task: string): string {
  const end = task.search(/[.!?](\s|$)/);
  return end < 0 ? task : task.slice(0, end + 1);
}

export function buildDelegateTools(deps: DelegateDeps = {}): AgentTool[] {
  const kinds = (deps.kinds ?? delegableWorkerKinds)();
  const write = deps.writeBrief ?? writeBriefFile;
  const send = deps.delegate ?? ((input: DelegateInput) => appRunner().delegate(input));
  const origin = deps.origin;
  return [
    {
      name: DELEGATE_TOOL,
      label: (args) => args.kind ? `Handing this to a ${args.kind} worker` : "Handing this over to a worker",
      effect: "write",
      description: DELEGATE_DESCRIPTION,
      parameters: Type.Object({
        kind: Type.String({
          description:
            kinds.length === 0
              ? "The kind of work. This device has no kind registered, so nothing can be delegated here."
              : `The kind of work. One of: ${kinds.join(", ")}.`,
        }),
        task: Type.String({
          description:
            "The brief: what to find out, and what would count as an answer. Everything " +
            "that makes it answerable — the subject, the claim or passage in question, the " +
            "field, any paper already identified (with its DOI or id), which years matter. " +
            "One job per run.",
        }),
      }),
      execute: async (args) => {
        const kind = String(args.kind ?? "").trim();
        const task = String(args.task ?? "").trim();
        if (!kind) throw new Error(`${DELEGATE_TOOL} needs a kind.`);
        if (!task) throw new Error(`${DELEGATE_TOOL} needs a task.`);
        if (!kinds.includes(kind)) {
          throw new Error(
            kinds.length === 0
              ? `Nothing here runs the kind "${kind}"; this device has no kind registered at all.`
              : `Nothing here runs the kind "${kind}". The kinds this device has are: ${kinds.join(", ")}.`,
          );
        }
        const brief = await write(task);
        const result = await send({
          kind,
          delegator: { kind: "soul" },
          brief,
          ...(origin === undefined ? {} : { deliverTo: JSON.stringify(origin) }),
        });
        // A refusal is the runner's own sentence — too deep, a step already
        // spent — and is handed back as it is written rather than reworded.
        if (!result.ok) throw new Error(result.reason);
        return {
          text:
            `Delegated as run ${result.run.id} (kind: ${kind}). It is running now and this ` +
            `turn does not wait for it: what it comes back with will arrive in this ` +
            `conversation later. Tell the reader the answer is coming rather than ` +
            `answering the question yourself.`,
          receipt: {
            label: `Sent off ${kind} work`,
            summary: firstSentence(task),
            link: { kind: "run" as const, id: result.run.id },
          },
        };
      },
    },
  ];
}
