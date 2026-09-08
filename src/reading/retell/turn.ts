// One turn of a retell's conversation (docs/31), as the retell view asks for it.
//
// The assembly itself is no longer here. What a retell contributes to a call is
// reading/retell/desk.ts, what the brain contributes is src/ai/assemble, and
// putting the two together is one function every domain now shares (docs/61).
// This file is what is left of the old entry point: it lays a desk with the
// retell on it, asks for a turn, and hands the answer back in the shape the view
// has always taken it.
//
// Pure assembly plus reads. It never touches React state and never starts the
// stream; the caller owns runAgentTurn.

import type { AgentTool } from "../../ai/agent";
import { assembleTurn } from "../../ai/assemble";
import { deskKindRegistered, openDesk, type DeskEnv } from "../../desk";
import type { Settings } from "../../platform/app/settings";
import {
  registerRetellDesk,
  RETELL_KIND,
  type RetellDeskRef,
  type RetellTurnMessage,
} from "./desk";
import { retellThreadKey } from "./store";
import type { RetellSlot } from "./outline";

// The retell's own vocabulary, still reached through this module: every caller
// has always imported these from here.
export {
  OBSERVATION_ORDER_TIGHT,
  type RetellDeskRef,
  type RetellTalkAccess,
  type RetellTurnMessage,
} from "./desk";
// The configured model's metadata, re-exported for the same reason it is from
// reading/turn.ts: this is where the retell's callers have always asked for it.
export { configuredModel } from "../../ai/assemble";

export interface RetellTurnInput extends RetellDeskRef {
  settings: Settings;
}

export interface RetellTurn {
  systemPrompt: string;
  tools: AgentTool[];
  messages: RetellTurnMessage[];
  // What this turn had to leave out, or "" when nothing the reader has a stake
  // in was dropped.
  notice: string;
  // Set when the turn cannot be made small enough to leave the model room to
  // answer. Show this instead of sending; retrying changes nothing.
  refusal: string;
}

// Lay the desk and assemble one turn from it.
export async function buildRetellTurn(input: RetellTurnInput): Promise<RetellTurn> {
  // The shell registers the retell's opener when it boots (useShellBootstrap). A
  // turn assembled without one — the first one in a test, or a path that never
  // went through a shell — registers it on the way in rather than failing on a
  // desk this module owns anyway.
  if (!deskKindRegistered(RETELL_KIND)) registerRetellDesk();
  const { settings, ...retellRef } = input;
  const { retell } = retellRef;
  const env: DeskEnv = {
    settings,
    topic: { id: retell.topicId || null, name: input.topicName },
    // A retell has exactly one conversation, and its id is the retell's
    // (retell/store.ts writes it to threads-retell-<id>.json).
    thread: { key: retellThreadKey(retell.id), id: retell.id },
  };
  const desk = await openDesk([{ kind: RETELL_KIND, ref: retellRef }], env);
  const assembled = await assembleTurn({ desk });
  // The assembly answers null only on an aborted signal, and no signal rides a
  // retell turn: the view drops the reply rather than the assembly.
  if (!assembled) throw new Error("retell: the assembly abandoned a turn that carries no signal");
  return {
    systemPrompt: assembled.systemPrompt,
    tools: assembled.tools,
    messages: assembled.messages as RetellTurnMessage[],
    notice: assembled.notice,
    refusal: assembled.refusal,
  };
}

export type { RetellSlot };
