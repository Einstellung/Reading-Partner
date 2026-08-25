// Assembly of one turn of the conversation a talk is coached in (docs/44).
//
// The counterpart of reading/retell/turn.ts and much smaller, because the
// material is smaller: a retell is assembled out of whole books, and this is
// assembled out of the outline and what the reader just said to it. There is no
// figure catalog, no chapter notes and no marks — the pass is the evidence.
//
// The conversation is anchored on the outline and not on a rehearsal or a pass
// (docs/43, "对话锚在 PPT 上", with the anchor now the outline): one thread
// spans every pass over this talk, so the second time the reader gives it the
// coach has the first pass and everything said about it still in front of it.
// Three passes in three conversations would be three strangers, and coming back
// to give it again is the whole of what a rehearsal is for.
//
// Pure assembly plus reads. It never touches React state and never starts the
// stream; the caller owns runAgentTurn.

import type { AgentTool } from "../../ai/agent";
import { toPiMessages } from "../../ai/providers";
import { fitToBudget, type Rung } from "../../budget";
import { languageInstruction, type Settings } from "../../platform/app/settings";
import { configuredModel, HISTORY_KEEP, HISTORY_KEEP_TIGHT } from "../turn";
import {
  buildArrangeTools,
  type TalkArrangementCardData,
  type TalkOutline,
} from "../talk";
import { buildCoachSystemPrompt } from "./coach";

// What a coach turn gives up when it does not fit the model's context window.
// One rung, and it is the last resort on every other ladder: a pass is tens of
// KB of transcript and several of them add up, but the outline is what every
// reply is about and the instructions are what stop the reply being a rubric,
// so neither can go.
export type CoachReductionId = "history-trim";

export const COACH_LADDER: readonly Rung<CoachReductionId>[] = [
  {
    id: "history-trim",
    price: "messages",
    notice: "earlier passes over this talk were left out to make room",
  },
];

export interface CoachTurnMessage {
  role: "user" | "ai";
  text: string;
}

// How a turn reaches the outline: two calls rather than the outline itself, for
// the same reason the retell's access is (reading/retell/turn.ts) — the tools
// write during the turn, so what they work on has to be the file as it stands.
export interface CoachTalkAccess {
  read(): Promise<TalkOutline | null>;
  edit(change: (outline: TalkOutline) => TalkOutline): Promise<TalkOutline | null>;
}

export interface CoachTurnInput {
  // The talk as it was when the turn was assembled, for the prompt. The tools
  // read it again themselves.
  outline: TalkOutline;
  topicName?: string;
  settings: Settings;
  // The conversation so far, oldest first, with the passes in it as the reader's
  // own messages (handoff.ts).
  history: CoachTurnMessage[];
  talk: CoachTalkAccess;
  // Raised when the coach writes to the outline, so the shell can put the card
  // in the conversation. Absent = the write still happens, it just is not shown.
  onCard?(card: TalkArrangementCardData): void;
  now?(): number;
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

export function buildCoachTurn(input: CoachTurnInput): CoachTurn {
  const { outline, topicName, settings: s, history, talk, onCard, now } = input;

  // The five that write a talk (reading/talk/tools.ts), the same five the
  // arrangement uses. What comes out of a pass is a change to the outline
  // (docs/44), so the coach has to be able to make one.
  const tools = buildArrangeTools({
    readOutline: () => talk.read(),
    editOutline: (change) => talk.edit(change),
    onCard,
    now,
  });

  function composePrompt(): string {
    let prompt = buildCoachSystemPrompt({ outline, topicName });
    const lang = languageInstruction(s.aiLanguage);
    if (lang) prompt += "\n\n" + lang;
    return prompt;
  }

  function composeMessages(dropped: ReadonlySet<CoachReductionId>): CoachTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    return history.length > keep ? history.slice(history.length - keep) : history;
  }

  const model = configuredModel(s);
  if (!model) {
    return {
      systemPrompt: composePrompt(),
      tools,
      messages: composeMessages(new Set()),
      notice: "",
      refusal: "",
    };
  }
  const fitted = fitToBudget<CoachReductionId, CoachTurnMessage>({
    model,
    tools,
    composePrompt,
    composeMessages,
    toPi: toPiMessages,
    rungs: COACH_LADDER,
    purpose: "chat",
  });
  return {
    systemPrompt: fitted.systemPrompt,
    tools,
    messages: fitted.messages,
    notice: fitted.notice,
    refusal: fitted.refusal,
  };
}
