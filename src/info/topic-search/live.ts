// The live wiring of the topic-search door tools, the Apply, and the drafting
// guidance: this device's files, statements, topics and claims.

import type { AgentTool } from "../../legion/durable/contract";
import { appClaims } from "../../legion/claim";
import { listStatements, statementStore } from "../../memory";
import { listTopics } from "../../platform/app/topics";
import { applyTopicSearchProposal, stopFollowing, type ApplyResult } from "./apply";
import type { StudyLinesCardData, StudyMoveCardData, StudySeedsCardData, TopicSearchProposalCardData } from "./cards";
import { buildConfirmTopicSearchTool, type ConfirmToolDeps } from "./confirm-tool";
import { buildStopTopicSearchTool, buildUpdateTopicSearchTool, type EditToolDeps } from "./edit-tools";
import { dispatchFirstRun } from "./first-run";
import { topicSearchGuidance } from "./guidance";
import { addTopicLabels, loadTopicLabels } from "./labels";
import { liveSeedSearches } from "./seed-live";
import { buildFindSeedPaperTool } from "./seed-tool";
import { buildProposeTopicSearchTool, type ReaderLine } from "./propose-tool";
import { buildResumeXReadingTool } from "./resume-tool";
import { buildRetryFirstRunTool } from "./retry-tool";
import { askStudyUpdate, loadStudyResult, resumeXReading, retryDeps, xReadingPaused } from "./runs-live";
import type { TopicSearch } from "./types";
import { changeTopicSearch, knownTopicSearches, loadTopicSearches, putTopicSearch } from "./store";
import { loadStudy, putStudyLines } from "./study";
import { keptCounts, sendStudyLines, studyBrief, type SendResult, type StudyBrief } from "./study-lines";
import { buildEndStudyTool, buildProposeStudyLinesTool, buildUpdateStudyBriefTool, type EndStudyToolDeps, type UpdateBriefToolDeps } from "./study-tools";
import type { DraftQuery } from "./topic-searches";

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
  raiseCard(card: TopicSearchProposalCardData | StudySeedsCardData | StudyLinesCardData | StudyMoveCardData): void;
  /** The seed cards in the conversation, oldest first, read when propose_topic_search is called. */
  seedCards(): readonly StudySeedsCardData[];
  /** The newest drafting card in the conversation, read when confirm_topic_search is called. */
  latestCard: ConfirmToolDeps["latestCard"];
  /** The card's Apply as the conversation answers it, the card then marked applied. */
  applyCard: ConfirmToolDeps["apply"];
  /** The newest confirm-lines card in the conversation, read when update_study_brief is called. */
  latestLinesCard: UpdateBriefToolDeps["latestCard"];
  /** The confirm card's button as the conversation answers it, the card then redrawn. */
  sendLines: UpdateBriefToolDeps["send"];
  /** A study's current version and its book on the info shelf (the shelf is info/issue's, read by the caller). */
  studyBook: EndStudyToolDeps["studyBook"];
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
    // Revising a study's brief in conversation and ending it (docs/info/91); the cards' presses are in use-door-chat.ts.
    buildProposeStudyLinesTool({
      threadId: ports.threadId,
      readerLines: ports.readerLines,
      searches: editDeps.searches,
      known: editDeps.known,
      brief: loadStudyBrief,
      now: () => Date.now(),
      raiseCard: ports.raiseCard,
    }),
    buildUpdateStudyBriefTool({ latestCard: ports.latestLinesCard, send: ports.sendLines }),
    buildEndStudyTool({
      threadId: ports.threadId,
      searches: editDeps.searches,
      known: editDeps.known,
      studyBook: ports.studyBook,
      topics: async () => (await listTopics()).map((tp) => ({ id: tp.id, name: tp.name })),
      now: () => Date.now(),
      raiseCard: ports.raiseCard,
    }),
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

/** A study's brief as the reader sees it on this device. */
export async function loadStudyBrief(searchId: string): Promise<StudyBrief> {
  const [result, study] = await Promise.all([loadStudyResult(searchId), loadStudy(searchId)]);
  return studyBrief(result, study.rollbacks);
}

/** The confirm card's 「按这几条更新简报」 on this device (study-lines.ts sendStudyLines). */
export function sendStudyLinesCard(card: StudyLinesCardData, queries: readonly DraftQuery[]): Promise<SendResult> {
  return sendStudyLines(card, queries, {
    searches: () => loadTopicSearches(),
    change: (id, change) => changeTopicSearch(id, change),
    study: (searchId) => loadStudy(searchId),
    putLines: (searchId, lines) => putStudyLines(searchId, lines),
    addLabels: (searchId, labels) => addTopicLabels(searchId, labels),
    brief: loadStudyBrief,
    ask: async (searchId, ask) => {
      const asked = await askStudyUpdate(searchId, ask);
      if (asked.status === "asked") return { status: "asked", runId: asked.run.id, n: asked.n };
      return asked.status === "busy" ? { status: "busy" } : asked;
    },
    now: () => Date.now(),
  });
}

/** end_study's stop: stop_topic_search's (apply.ts stopFollowing). */
export function stopStudy(searchId: string): Promise<TopicSearch | null> {
  return stopFollowing(searchId, editDeps);
}

/** What the end card says is kept of a study. */
export async function studyKept(searchId: string): Promise<{ pins: number; marks: number }> {
  const [labels, study] = await Promise.all([loadTopicLabels(searchId), loadStudy(searchId)]);
  return keptCounts(labels, study.lines);
}
