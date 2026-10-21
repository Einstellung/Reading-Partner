// What the door mounts beside the soul's own set (soul/door.ts). The soul brings
// its statements, conversations, catalogue, delegation and places on every turn;
// this is for what only a conversation typed to the companion at the door needs.
//
// One line per tool. A tool that draws a card raises it through `raiseCard`,
// and the card's kind is registered in ui/components/cardRegistry.ts like every
// other chat card; its gestures are answered in use-door-chat.ts onCardAction.

import type { AgentTool } from "../../../legion/durable/contract";
import { listTopics } from "../../../platform/app/topics";
import { buildTakeLinkTool } from "../../../reading/ingest/take-link-tool";
import { startTopicIntake } from "../../../reading/ingest/topic-intake";
import type { CardPayload } from "../chat/chatParts";
import type { Settings } from "../../../platform/app/settings";
import { liveWebSearchTools } from "../../../websearch/tool";
import { webSearchPrompt } from "../../../websearch/prompt";
import { buildReadPageTool } from "../../../info/sources/read-page-tool";
import { infoFetch } from "../../../workshop/extract/http";
import { topicSearchDoorTools, type TopicSearchDoorPorts } from "../../../info/topic-search/live";
import { liveBackgroundStatusTool } from "../../../legion/status/live";

export interface DoorToolPorts {
  /** The day's conversation and the day it is filed under. */
  threadId: string;
  date: string;
  /** Put a card in the conversation, on screen and on disk (use-door-chat.ts). */
  raiseCard(prefix: string, payload: CardPayload): void;
  /** The links of this turn, numbered in order (take-link-tool.ts linksToTake). */
  links: readonly string[];
  /** Which provider and models this turn runs on: web_search mounts only where the provider can search. */
  settings: Pick<Settings, "defaultProviderId" | "defaultModelId" | "everydayModelId">;
  /** The reader's lines so far, oldest first: where a topic search's concern takes its evidence. */
  readerLines: TopicSearchDoorPorts["readerLines"];
  /** The newest topic-search card on screen, and its Apply: confirm_topic_search (use-door-chat.ts). */
  latestTopicSearchCard: TopicSearchDoorPorts["latestCard"];
  applyTopicSearchCard: TopicSearchDoorPorts["applyCard"];
  /** The seed cards on screen, oldest first: propose_topic_search takes the confirmed ones (docs/info/91). */
  seedCards: TopicSearchDoorPorts["seedCards"];
  /** The newest confirm-lines card on screen and its button, and where a study's book is: the study tools (docs/info/91). */
  latestLinesCard: TopicSearchDoorPorts["latestLinesCard"];
  sendLines: TopicSearchDoorPorts["sendLines"];
  studyBook: TopicSearchDoorPorts["studyBook"];
}

export function doorTools(ports: DoorToolPorts): AgentTool[] {
  // web_search (docs/info/24), with read_page beside it to open what a search cites.
  const search = liveWebSearchTools(ports.settings, { caller: "door", sessionId: ports.threadId });
  return [
    ...search,
    ...(search.length ? [buildReadPageTool({ fetchFn: infoFetch })] : []),
    // A pasted link: the intake card, and the fetch as a run (docs/68 「收链接」).
    buildTakeLinkTool({
      links: () => ports.links,
      origin: { place: "door", date: ports.date },
      start: (url, origin) => startTopicIntake(url, undefined, { origin }),
      topics: () => listTopics(),
      raiseCard: (card) => ports.raiseCard("intake", card),
    }),
    // Looking up a study's seed papers, drafting, confirming, changing and stopping a topic search, resuming X, and
    // revising and ending a study (docs/info/88, 91); the cards' presses are in use-door-chat.ts.
    ...topicSearchDoorTools({
      threadId: ports.threadId,
      readerLines: ports.readerLines,
      raiseCard: (card) => ports.raiseCard("topic-search", card),
      latestCard: ports.latestTopicSearchCard,
      applyCard: ports.applyTopicSearchCard,
      seedCards: ports.seedCards,
      latestLinesCard: ports.latestLinesCard,
      sendLines: ports.sendLines,
      studyBook: ports.studyBook,
    }),
    // How background work is getting on: queued, running, finished, on which device (legion/status).
    liveBackgroundStatusTool(),
  ];
}

/** What the door's tools need said beside them: when to search, or that the provider cannot (docs/info/24). */
export function doorToolsPrompt(tools: readonly AgentTool[]): string {
  return webSearchPrompt(tools.map((t) => t.name));
}
