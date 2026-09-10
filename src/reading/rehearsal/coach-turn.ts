// One turn of the conversation a talk is coached in (docs/44), as the rehearsal
// view asks for it.
//
// The assembly itself is no longer here. What the talk contributes to a call is
// reading/rehearsal/desk.ts, what the soul contributes is src/soul, and
// putting the two together is one function every domain now shares (docs/61).
// This file is what is left of the old entry point.
//
// Pure assembly plus reads. It never touches React state and never starts the
// stream; the caller owns runAgentTurn.

import type { AgentTool } from "../../ai/agent";
import { assembleTurn } from "../../soul";
import { deskKindRegistered, openDesk, type DeskEnv } from "../../desk";
import type { Settings } from "../../platform/app/settings";
import { talkThreadKey } from "../talk";
import {
  registerRehearsalDesk,
  OUTLINE_KIND,
  type CoachTurnMessage,
  type OutlineDeskRef,
} from "./desk";

// The coach's own vocabulary, still reached through this module: every caller
// has always imported these from here.
export {
  COACH_LADDER,
  type CoachReductionId,
  type CoachTalkAccess,
  type CoachTurnMessage,
  type OutlineDeskRef,
} from "./desk";

export interface CoachTurnInput extends OutlineDeskRef {
  settings: Settings;
}

export interface CoachTurn {
  systemPrompt: string;
  tools: AgentTool[];
  messages: CoachTurnMessage[];
  // What this turn had to leave out, or "" when nothing the reader has a stake
  // in was dropped.
  notice: string;
  // Set when the turn cannot be made small enough to leave the model room to
  // answer. Show this instead of sending; retrying changes nothing.
  refusal: string;
}

export async function buildCoachTurn(input: CoachTurnInput): Promise<CoachTurn> {
  // The shell registers the rehearsal's opener when it boots
  // (useShellBootstrap); a turn assembled without one registers it on the way in
  // rather than failing on a desk this module owns anyway.
  if (!deskKindRegistered(OUTLINE_KIND)) registerRehearsalDesk();
  const { settings, ...outlineRef } = input;
  const env: DeskEnv = {
    settings,
    // No topic scope: the coach hears a pass and edits the talk, and nothing
    // here writes an observation about a book. Naming the outline's topic would
    // mount the observation tools on a conversation that has no reading in it.
    topic: { id: null, name: input.topicName ?? "" },
    // A talk has exactly one conversation, and its id is the outline's
    // (reading/talk/store.ts writes it to threads-talk-<id>.json).
    thread: { key: talkThreadKey(input.outline.id), id: input.outline.id },
  };
  const desk = await openDesk([{ kind: OUTLINE_KIND, ref: outlineRef }], env);
  const assembled = await assembleTurn({ desk });
  // The assembly answers null only on an aborted signal, and no signal rides a
  // coach turn: the view drops the reply rather than the assembly.
  if (!assembled) throw new Error("coach: the assembly abandoned a turn that carries no signal");
  return {
    systemPrompt: assembled.systemPrompt,
    tools: assembled.tools,
    messages: assembled.messages as CoachTurnMessage[],
    notice: assembled.notice,
    refusal: assembled.refusal,
  };
}
