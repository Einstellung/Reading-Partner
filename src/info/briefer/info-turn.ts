// One info conversation's turn, as a surface the reader is holding assembles it:
// the anchor's desk with this turn's tools bound to it, laid and handed to the
// secretary (docs/71 角色), stamped with the thread it is being held in. The
// text chat (ui/components/info/use-info-call.ts) and the voice call
// (voice-call-live.ts) both lay it here, so the two open the same conversation.

import type { BoxOrigin } from "../../box";
import { openDesk, type DeskItem } from "../../desk";
import type { AgentTool } from "../../legion/execute/turn";
import type { Settings } from "../../platform/app/settings";
import { assembleTurn, type AssembleInput, type AssembledTurn } from "../../soul";
import { withMealsTools, type MealsTools } from "../meals/desk";
import { MEALS_THREAD_ID, type InfoCallAnchor } from "./anchors";
import { withCompanionTools } from "./desk";
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
  // The meals tools, where the surface has them to give. Without them a meals
  // item on the desk opens with none.
  mealsTools?: MealsTools;
  // Where a proposal for this conversation's topic is drawn (memory/filing).
  topic?: AssembleInput["topic"];
}

export interface InfoTurn {
  // What the desk opened, for the card gestures that reach back into it.
  items: DeskItem[];
  // Null when the signal aborted while the turn was being assembled.
  turn: AssembledTurn | null;
}

/**
 * Where a turn in this conversation is being held (docs/68): a run delegated
 * from it, or a reply recovered after the process died, comes back here. The
 * meals conversation is its own standing thread; everything anchored to a day
 * — the briefing, an article, onboarding — comes back into that day's briefing.
 */
export function infoOrigin(anchor: InfoCallAnchor, dateKey: string): BoxOrigin {
  return anchor.threadId === MEALS_THREAD_ID ? { place: "meals" } : { place: "briefing", date: dateKey };
}

export async function assembleInfoTurn(input: InfoTurnInput): Promise<InfoTurn> {
  const { anchor, mealsTools } = input;
  const refs = withCompanionTools(anchor.desk, input.companionTools);
  const desk = await openDesk(mealsTools ? withMealsTools(refs, mealsTools) : refs, {
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
  });
  return { items: desk.items, turn };
}
