// What the door mounts beside the soul's own set (soul/door.ts). The soul brings
// its statements, conversations, catalogue, delegation and places on every turn;
// this is for what only a conversation typed to Lumen at the door needs.
//
// One line per tool. A tool that draws a card raises it through `raiseCard`,
// and the card's kind is registered in ui/components/cardRegistry.ts like every
// other chat card; its gestures are answered in use-door-chat.ts onCardAction.

import type { AgentTool } from "../../../legion/execute/turn";
import type { CardPayload } from "../chat/chatParts";

export interface DoorToolPorts {
  /** The day's conversation and the day it is filed under. */
  threadId: string;
  date: string;
  /** Put a card in the conversation, on screen and on disk (useStreamingTurn). */
  raiseCard(prefix: string, payload: CardPayload): void;
}

export function doorTools(_ports: DoorToolPorts): AgentTool[] {
  return [];
}
