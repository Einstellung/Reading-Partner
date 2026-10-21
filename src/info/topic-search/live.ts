// The live wiring of the topic-search door tools, the Apply, and the drafting
// guidance: this device's files, statements, topics and claims.

import type { AgentTool } from "../../legion/durable/contract";
import { appClaims } from "../../legion/claim";
import { listStatements, statementStore } from "../../memory";
import { applyTopicSearchProposal, type ApplyResult } from "./apply";
import type { StudySeedsCardData, TopicSearchProposalCardData } from "./cards";
import { buildConfirmTopicSearchTool, type ConfirmToolDeps } from "./confirm-tool";
import { buildStopTopicSearchTool, buildUpdateTopicSearchTool, type EditToolDeps } from "./edit-tools";
import { dispatchFirstRun } from "./first-run";
import { topicSearchGuidance } from "./guidance";
import { addTopicLabels } from "./labels";
import { liveSeedSearches } from "./seed-live";
import { buildFindSeedPaperTool } from "./seed-tool";
import { buildProposeTopicSearchTool, type ReaderLine } from "./propose-tool";
import { buildResumeXReadingTool } from "./resume-tool";
import { buildRetryFirstRunTool } from "./retry-tool";
import { resumeXReading, retryDeps, xReadingPaused } from "./runs-live";
import { changeTopicSearch, knownTopicSearches, loadTopicSearches, putTopicSearch } from "./store";

const editDeps: EditToolDeps = {
  searches: () => loadTopicSearches(),
  known: knownTopicSearches,
  change: (id, change) => changeTopicSearch(id, change),
  setLapsed: (id, lapsed) => statementStore.setLapsed(id, lapsed),
  now: () => Date.now(),
};

export interface TopicSearchDoorPorts {
  threadId: string;
  readerLines(): readonly ReaderLine[];
  /** The drafting card and the seed card, put in the conversation. */
  raiseCard(card: TopicSearchProposalCardData | StudySeedsCardData): void;
  /** The seed cards in the conversation, oldest first, read when propose_topic_search is called. */
  seedCards(): readonly StudySeedsCardData[];
  /** The newest drafting card in the conversation, read when confirm_topic_search is called. */
  latestCard: ConfirmToolDeps["latestCard"];
  /** The card's Apply as the conversation answers it, the card then marked applied. */
  applyCard: ConfirmToolDeps["apply"];
}

/** find a seed paper, propose, confirm, update and stop a topic search, then resume_x_reading and retry_topic_search_first_run. */
export function topicSearchDoorTools(ports: TopicSearchDoorPorts): AgentTool[] {
  // Read now, so the lines of update and stop can name the search by the time
  // the model calls them (edit-tools.ts known).
  void loadTopicSearches().catch(() => {});
  return [
    buildFindSeedPaperTool({
      threadId: ports.threadId,
      readerLines: ports.readerLines,
      searches: liveSeedSearches,
      now: () => Date.now(),
      raiseCard: ports.raiseCard,
    }),
    buildProposeTopicSearchTool({
      threadId: ports.threadId,
      readerLines: ports.readerLines,
      searches: () => loadTopicSearches(),
      statements: () => listStatements(),
      claims: () => appClaims().readAll(),
      seedCards: ports.seedCards,
      now: () => Date.now(),
      raiseCard: ports.raiseCard,
    }),
    buildConfirmTopicSearchTool({ latestCard: ports.latestCard, apply: ports.applyCard }),
    buildUpdateTopicSearchTool(editDeps),
    buildStopTopicSearchTool(editDeps),
    buildResumeXReadingTool({ resume: resumeXReading }),
    buildRetryFirstRunTool({ searches: editDeps.searches, known: editDeps.known, ...retryDeps }),
  ];
}

/** The drafting rules and roster for the door's system prompt. */
export async function loadTopicSearchGuidance(): Promise<string> {
  const [searches, statements, xPaused] = await Promise.all([
    loadTopicSearches().catch(() => []),
    listStatements().catch(() => []),
    xReadingPaused().catch(() => null),
  ]);
  return topicSearchGuidance({ searches, statements, xPaused });
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
    addLabels: (searchId, labels) => addTopicLabels(searchId, labels),
    dispatchFirstRun,
    now: () => Date.now(),
  });
}
