// One info conversation's turn, as a surface the reader is holding assembles it:
// the anchor's desk with this turn's tools bound to it, laid and handed to the
// secretary (docs/71 角色), stamped with the thread it is being held in. The
// text chat (ui/components/info/use-info-call.ts) and the voice call
// (voice-call-live.ts) both lay it here, so the two open the same conversation.

import type { BoxOrigin } from "../../box";
import { bindItemTools, openDesk, type DeskItem } from "../../desk";
import type { AgentTool } from "../../legion/durable/contract";
import type { Settings } from "../../platform/app/settings";
import { assembleTurn, type AssembleInput, type AssembledTurn } from "../../soul";
import type { InfoCallAnchor } from "./anchors";
import { INFO_BRIEFING_KIND } from "./desk";
import { SECRETARY_ROLE_ID } from "./role";

export interface InfoTurnInput {
  anchor: InfoCallAnchor;
  // The thread file the conversation lives in (call.ts: infoBookId, or the
  // anchor's own bookKey).
  key: string;
  // The day a date-anchored conversation is about.
  dateKey: string;
  settings: Settings;
  signal?: AbortSignal;
  messages: AssembleInput["messages"];
  companionTools: () => Promise<AgentTool[]>;
  // Where a proposal for this conversation's topic is drawn (memory/filing).
  topic?: AssembleInput["topic"];
  // Where an edit_data change that waits for the reader puts its card (docs/platform/687).
  raiseConfirmCard?: AssembleInput["raiseConfirmCard"];
}

export interface InfoTurn {
  // What the desk opened, for the card gestures that reach back into it.
  items: DeskItem[];
  // Null when the signal aborted while the turn was being assembled.
  turn: AssembledTurn | null;
}

/**
 * Where a turn in this conversation is being held (docs/68): a run delegated
 * from it, or a reply recovered after the process died, comes back here:
 * everything anchored to a day — the briefing, an article, onboarding — comes
 * back into that day's briefing.
 */
export function infoOrigin(_anchor: InfoCallAnchor, dateKey: string): BoxOrigin {
  return { place: "briefing", date: dateKey };
}

export async function assembleInfoTurn(input: InfoTurnInput): Promise<InfoTurn> {
  const { anchor } = input;
  const refs = bindItemTools(anchor.desk, INFO_BRIEFING_KIND, input.companionTools);
  const desk = await openDesk(refs, {
    settings: input.settings,
    thread: { key: input.key, id: anchor.threadId },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const turn = await assembleTurn({
    desk,
    messages: input.messages,
    // Whose desk this is (docs/71 角色): the secretary's duty and the
    // companion tools ride the turn from the role, not from the briefing.
    role: SECRETARY_ROLE_ID,
    origin: infoOrigin(anchor, input.dateKey),
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.raiseConfirmCard ? { raiseConfirmCard: input.raiseConfirmCard } : {}),
  });
  return { items: desk.items, turn };
}
