// What a process does with the runs the last one left unfinished, before
// `resume()` (docs/soul/87, "被杀之后"). Each run is one of three:
//
//   died mid-text    pi.live holds a half sentence: save it to rp.partial in
//                    one commit, then abort. Not asked again; the half
//                    sentence lands with what came before it.
//   died in a tool   the generation waits on tools: resume, so an unsafe tool
//                    gets its interrupted result, a safe one runs again.
//   nothing written  abort.
//
// Every start counts an attempt in rp.recovery; the second gives up (abort).

import type { Context } from "@earendil-works/chord";
import { LiveDoc, type ConversationId, type SubmissionId } from "@earendil-works/pi-durable";
import { PartialDoc, RecoveryDoc } from "./extension";
import type { DurableRuntime } from "./harness";
import { stopTurn, textOf, type WithdrawnSteer } from "./turn";

export const MAX_ATTEMPTS = 2;

export type RecoveryOutcome = "mid-text" | "in-tool" | "nothing" | "gave-up";

export interface Recovered {
  conversationId: ConversationId;
  submission: SubmissionId;
  outcome: RecoveryOutcome;
  /** Steers withdrawn by the abort, for the next turn's opening; empty when resumed. */
  steers: WithdrawnSteer[];
}

export async function recoverBeforeResume(runtime: DurableRuntime, context: Context): Promise<Recovered[]> {
  const harness = runtime.harness;
  const inspection = await harness.inspect(context);
  const conversations = new Set<ConversationId>();
  for (const record of inspection.submissions) if (record.status === "placed") conversations.add(record.conversationId);

  const sorted: { conversationId: ConversationId; submission: SubmissionId; outcome: RecoveryOutcome }[] = [];
  for (const conversationId of conversations) {
    const live = await harness.snapshot(LiveDoc, conversationId, context);
    const submission = live?.run?.inputs[0];
    if (submission === undefined) continue;
    const half = textOf(live?.generation?.message);
    const inTool = live?.tools?.some((slot) => slot.status !== "done") ?? false;
    const conversation = (await harness.conversation(conversationId, context))!;
    const outcome = await conversation.commit(async (tx) => {
      const recovery = await tx.doc(RecoveryDoc, conversationId);
      const key = String(submission);
      const attempts = (recovery.submissions[key]?.attempts ?? 0) + 1;
      recovery.submissions[key] = { attempts, superseded: recovery.submissions[key]?.superseded ?? false };
      const outcome: RecoveryOutcome =
        attempts >= MAX_ATTEMPTS ? "gave-up" : half ? "mid-text" : inTool ? "in-tool" : "nothing";
      if (half && outcome !== "in-tool") {
        const partial = await tx.doc(PartialDoc, conversationId);
        partial.submission = submission;
        partial.text = half;
      }
      return outcome;
    }, context);
    sorted.push({ conversationId, submission, outcome });
  }

  // Every decision is committed before the first abort starts the scheduler.
  const recovered = await Promise.all(
    sorted.map(async (run): Promise<Recovered> => {
      if (run.outcome === "in-tool") return { ...run, steers: [] };
      const conversation = (await harness.conversation(run.conversationId, context))!;
      return { ...run, steers: await stopTurn(runtime, conversation, context) };
    }),
  );
  harness.resume();
  return recovered;
}
