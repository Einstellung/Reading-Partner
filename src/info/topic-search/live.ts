// The live wiring of the topic-search door tools, the Apply, and the drafting
// guidance: this device's files, statements, topics and claims.

import type { AgentTool } from "../../legion/durable/contract";
import { appClaims } from "../../legion/claim";
import { listStatements, statementStore } from "../../memory";
import { listTopics } from "../../platform/app/topics";
import { applyTopicSearchProposal, type ApplyResult } from "./apply";
import type { TopicSearchProposalCardData } from "./cards";
import { buildConfirmTopicSearchTool, type ConfirmToolDeps } from "./confirm-tool";
import { buildStopTopicSearchTool, buildUpdateTopicSearchTool, type EditToolDeps } from "./edit-tools";
import { dispatchFirstRun } from "./first-run";
import { topicSearchGuidance } from "./guidance";
import { buildProposeTopicSearchTool, type ReaderLine } from "./propose-tool";
import { buildResumeXReadingTool } from "./resume-tool";
import { resumeXReading, xReadingPaused } from "./runs-live";
import { changeTopicSearch, loadTopicSearches, putTopicSearch } from "./store";

const editDeps: EditToolDeps = {
  searches: () => loadTopicSearches(),
  change: (id, change) => changeTopicSearch(id, change),
  setLapsed: (id, lapsed) => statementStore.setLapsed(id, lapsed),
  now: () => Date.now(),
};

export interface TopicSearchDoorPorts {
  threadId: string;
  readerLines(): readonly ReaderLine[];
  raiseCard(card: TopicSearchProposalCardData): void;
  /** The newest drafting card in the conversation, read when confirm_topic_search is called. */
  latestCard: ConfirmToolDeps["latestCard"];
  /** The card's Apply as the conversation answers it, the card then marked applied. */
  applyCard: ConfirmToolDeps["apply"];
}

/** propose, confirm, update and stop a topic search, then resume_x_reading. */
export function topicSearchDoorTools(ports: TopicSearchDoorPorts): AgentTool[] {
  return [
    buildProposeTopicSearchTool({
      threadId: ports.threadId,
      readerLines: ports.readerLines,
      searches: () => loadTopicSearches(),
      topics: () => listTopics(),
      statements: () => listStatements(),
      claims: () => appClaims().readAll(),
      now: () => Date.now(),
      raiseCard: ports.raiseCard,
    }),
    buildConfirmTopicSearchTool({ latestCard: ports.latestCard, apply: ports.applyCard }),
    buildUpdateTopicSearchTool(editDeps),
    buildStopTopicSearchTool(editDeps),
    buildResumeXReadingTool({ resume: resumeXReading }),
  ];
}

/** The drafting rules and roster for the door's system prompt. */
export async function loadTopicSearchGuidance(): Promise<string> {
  const [searches, statements, topics, xPaused] = await Promise.all([
    loadTopicSearches().catch(() => []),
    listStatements().catch(() => []),
    listTopics().catch(() => []),
    xReadingPaused().catch(() => null),
  ]);
  return topicSearchGuidance({ searches, statements, topics, xPaused });
}

/** The card's Apply on this device. */
export function applyTopicSearchCard(card: TopicSearchProposalCardData): Promise<ApplyResult> {
  return applyTopicSearchProposal(card, {
    concern: {
      getStatement: (id) => statementStore.getStatement(id),
      createStatement: (input) => statementStore.createStatement(input),
      supersede: (oldId, input) => statementStore.supersede(oldId, input),
      addEvidence: (id, evidence) => statementStore.addEvidence(id, evidence),
      setLapsed: (id, lapsed) => statementStore.setLapsed(id, lapsed),
    },
    load: () => loadTopicSearches(),
    put: (search) => putTopicSearch(search),
    dispatchFirstRun,
    now: () => Date.now(),
  });
}
