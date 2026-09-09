// What the info side puts on the desk (docs/61): the day's briefing, and one
// article pulled out of it.
//
// Three ways in — the briefing chat, an article chat, the voice call — become
// two kinds of material. The briefing is the companion itself: the role, the
// tools, the reading profile, the source roster and the day's document. An
// article is one body of text that lies beside it, bringing no tools of its own.
// So an article chat is a desk with both on it, briefing first, and the voice
// call is the briefing desk in another modality (docs/33, docs/36).
//
// Onboarding is the briefing item in a variant rather than a kind of its own:
// the same conversation before there are any sources, whose prompt is the
// add-source skill (docs/17).
//
// This is also where info first reads memory: the briefing item anchors the
// retrieval, so the assembly hands it the statements and the topic's
// observations (docs/48). The topic is the caller's — the conversation's own
// once it has been given one, the brief queue until then (docs/21).

import {
  buildObservationSnapshot,
  getObservationAdapter,
  trimObservations,
  type Observation,
} from "../../memory";
import {
  registerDeskItemKind,
  type DeskEnv,
  type DeskItem,
  type DeskItemKind,
  type DeskPromptView,
  type DeskRef,
} from "../../desk";
import { listTopics } from "../../platform/app/topics";
import { addSourceSystemPrompt } from "../sources/source-skill";
import { topicGuidance, type TopicChoice } from "./topic-tool";
import { labGuidance } from "./lab-tool";
import {
  articleContextSection,
  briefingChatSystemPrompt,
  noBriefingChatSystemPrompt,
  type CompanionContext,
} from "./chat";
import type { AgentTool } from "../../ai/agent";
import type { AiLanguage } from "../../platform/app/settings";
import type { Briefing } from "../boxes/types";

/** The day's briefing, which is the companion itself. Marked on the palace row. */
export const INFO_BRIEFING_KIND = "info-briefing";
/** One article out of it, as a body of text beside the briefing. */
export const INFO_ARTICLE_KIND = "info-article";

// How many of the topic's observations ride the prompt, and how few when the
// ladder asks for less. The info conversation has no ladder of its own yet, so
// only the first number is reached today.
const OBSERVATION_CAP = 12;
const OBSERVATION_CAP_TIGHT = 4;

/**
 * The companion tools for this turn. Injected rather than built here: they take
 * the chat's card sinks and the host's briefing controller, and building them
 * fetches the article extractor's chunk (companion-live.ts), which no test of a
 * prompt should have to do. A ref with none mounts none.
 */
export type CompanionTools = () => Promise<AgentTool[]>;

/**
 * The topic's observations, for the retrieval this conversation anchors.
 * Injected the way the book's kept-article store is (reading/desk.ts), so a desk
 * can be laid with no AppData under it; the app leaves it out and the live store
 * answers.
 */
export type ListObservations = (topicId: string) => Promise<Observation[]>;

/**
 * The reader's topics, for the roster propose_topic proposes out of (docs/21).
 * Injected the same way, and for the same reason.
 */
export type ListTopicChoices = () => Promise<TopicChoice[]>;

/** The day's briefing on the desk, in one of its three states. */
export type InfoBriefingDeskRef =
  | {
      // Before there are any sources: the same conversation, opened on the
      // add-source skill (docs/17).
      onboarding: true;
      aiLanguage?: AiLanguage;
      tools?: CompanionTools;
      listObservations?: ListObservations;
    }
  | {
      onboarding?: false;
      dateKey: string;
      // Null where the day's briefing has not landed or failed (docs/35).
      briefing: Briefing | null;
      ctx: CompanionContext;
      // Only read when there is no briefing: why the last attempt failed, and
      // what is known about the machine that would have built it.
      error?: string | null;
      notices?: string[];
      tools?: CompanionTools;
      listObservations?: ListObservations;
      listTopics?: ListTopicChoices;
    };

export interface InfoArticleDeskRef {
  dateKey: string;
  itemId: string;
  title: string;
  // The day's overview, so the article block can say what it was one of.
  overview: string;
  bodyText: string;
}

const briefingKind: DeskItemKind<InfoBriefingDeskRef> = {
  kind: INFO_BRIEFING_KIND,
  open: openBriefing,
};
const articleKind: DeskItemKind<InfoArticleDeskRef> = {
  kind: INFO_ARTICLE_KIND,
  open: openArticle,
};

/**
 * Register what info can put on the desk. Called once at startup by the shell
 * (useShellBootstrap's bootDomains), and by the tests that lay a desk of their
 * own.
 */
export function registerInfoDesk(): () => void {
  const off = [registerDeskItemKind(briefingKind), registerDeskItemKind(articleKind)];
  return () => {
    for (const undo of off) undo();
  };
}

/**
 * Bind the companion tools to the briefing ref on a desk an anchor described.
 * An anchor is decidable from what is already read off disk (anchors.ts); the
 * tools are the running turn's, so the runner attaches them here rather than
 * the anchor carrying a closure.
 */
export function withCompanionTools(
  refs: readonly DeskRef[],
  tools: CompanionTools,
): DeskRef[] {
  return refs.map((r) =>
    r.kind === INFO_BRIEFING_KIND
      ? { kind: r.kind, ref: { ...(r.ref as InfoBriefingDeskRef), tools } }
      : { kind: r.kind, ref: r.ref },
  );
}

// The briefing: every tool the companion has, the whole of what it is told about
// today, and the retrieval the conversation anchors. Null when the reader walked
// away while the tools were being built.
async function openBriefing(ref: InfoBriefingDeskRef, env: DeskEnv): Promise<DeskItem | null> {
  const tools = ref.tools ? await ref.tools() : [];
  if (env.signal?.aborted) return null;
  const observations = await topicObservations(env.topic.id, ref.listObservations);
  if (env.signal?.aborted) return null;
  const base = join(briefingPrompt(ref), await topicSection(ref), labSection(ref));
  return {
    kind: INFO_BRIEFING_KIND,
    label: ref.onboarding ? "Subscriptions" : "Today's briefing",
    tools,
    // The tool guidance is written into the prompt above, among the profile and
    // the source roster it governs; nothing else on this desk renders a frame.
    toolPrompts: [],
    rungs: [],
    prompt: (view: DeskPromptView) => join(base, view.memory),
    memory: {
      // Not a book: what "still open" is scoped to has no meaning here, so the
      // memory paragraph is the statements and the topic's observations.
      bookId: "",
      observations,
      snapshot: (tight: boolean) =>
        buildObservationSnapshot(
          trimObservations(observations, tight ? OBSERVATION_CAP_TIGHT : OBSERVATION_CAP),
        ),
    },
  };
}

// One article: its own block and nothing else. No tools — what the companion can
// do is the briefing's, and mounting a second copy of it here would be two names
// for one thing on the same desk.
async function openArticle(ref: InfoArticleDeskRef): Promise<DeskItem | null> {
  return {
    kind: INFO_ARTICLE_KIND,
    label: ref.title,
    tools: [],
    toolPrompts: [],
    rungs: [],
    prompt: () => articleContextSection(ref.overview, ref.title, ref.bodyText),
  };
}

function briefingPrompt(ref: InfoBriefingDeskRef): string {
  if (ref.onboarding) return addSourceSystemPrompt({ aiLanguage: ref.aiLanguage, onboarding: true });
  if (ref.briefing) return briefingChatSystemPrompt(ref.briefing, ref.ctx);
  return noBriefingChatSystemPrompt(ref.ctx, {
    error: ref.error ?? undefined,
    collecting: ref.ctx.collecting,
    notices: ref.notices ?? [],
  });
}

// The roster propose_topic proposes out of, and the standing instruction to
// propose. Left out of onboarding: there is nothing kept yet and no briefing to
// keep anything from, so the only thing that conversation is for is sources.
async function topicSection(ref: InfoBriefingDeskRef): Promise<string> {
  if (ref.onboarding) return "";
  const list = ref.listTopics ?? liveTopicChoices;
  // A roster that will not read leaves the companion proposing new topics rather
  // than failing the turn the reader is waiting for.
  const topics = await list().catch((): TopicChoice[] => []);
  return topicGuidance(topics);
}

// The rooms half of the same instruction (docs/63). The other two prompts carry
// it in their preamble, where the source roster it talks about is; onboarding's
// prompt is the add-source skill, which knows nothing about rooms, so it is
// appended here. There are none yet by construction at that point, which is
// exactly the state the guidance is written for: ask what to keep watch on.
function labSection(ref: InfoBriefingDeskRef): string {
  return ref.onboarding ? labGuidance([], []) : "";
}

function liveTopicChoices(): Promise<TopicChoice[]> {
  return listTopics().then((topics) => topics.map(({ id, name }) => ({ id, name })));
}

async function topicObservations(
  topicId: string | null,
  list: ListObservations = liveObservations,
): Promise<Observation[]> {
  if (!topicId) return [];
  // A store that will not answer leaves the conversation without its memory
  // rather than failing the turn the reader is waiting for.
  return list(topicId).catch((): Observation[] => []);
}

function liveObservations(topicId: string): Promise<Observation[]> {
  return getObservationAdapter(topicId).listObservations();
}

function join(...blocks: string[]): string {
  return blocks.filter((b) => b !== "").join("\n\n");
}
