// What the soul carries into every turn, whatever lies on the desk (docs/48,
// docs/61): what is known about the reader, and the tools that write it down.
// It is about the reader and not about the material — the same statements pitch
// an explanation of a book, of a briefing, of a talk being rehearsed.
//
// Kept apart from turn.ts so that "what the soul contributes" can be read
// without reading how a call is fitted to a window.

import {
  assembleStatements,
  buildObservationTools,
  buildStatementTools,
  getObservationAdapter,
  latestReaderMessage,
  listOtherTopicObservations,
  memorySection,
  notifyObservationChange,
  statementStore,
  type Statement,
} from "../memory";
import { buildConversationTools } from "../conversations";
import type { DeskEnv, DeskMemory } from "../desk";
import { getThread } from "../platform/app/threads";
import type { AgentTool } from "../ai/agent";
import {
  buildProposeTopicTool,
  liveTopicChoices,
  topicGuidance,
  type TopicProposalSurface,
} from "./topic/propose";

export interface Soul {
  // statement_write, the conversation tools, the observation tools wherever
  // there is a topic to scope them to, and propose_topic wherever there is not.
  tools: AgentTool[];
  // Every statement there is. Which of them ride the prompt is the ladder's
  // call, one pass at a time, so they are read once and filtered per pass.
  statements: readonly Statement[];
  // The soul's own paragraph of the system prompt: the topic roster and the
  // standing instruction to propose one, where the conversation has no topic
  // yet. Empty otherwise. It belongs to no item on the desk, so the assembly
  // prints it (turn.ts).
  prompt: string;
}

/**
 * Read what the soul brings to this turn: the tools it mounts and the
 * statements it may print. `anchor` is the memory of the item that anchors the
 * retrieval, which is where the observation tools get the book they are scoped
 * to.
 */
export async function openSoul(
  env: DeskEnv,
  anchor: DeskMemory | undefined,
  topic: TopicProposalSurface = {},
): Promise<Soul> {
  const topicId = env.topic.id;
  const messages = getThread(env.thread.key, env.thread.id)?.messages ?? [];
  // What the reader says about themselves, in their words (docs/48): evidenced
  // by the message they just sent, which the caller appended before assembling
  // this.
  const tools: AgentTool[] = buildStatementTools({
    store: statementStore,
    message: latestReaderMessage(messages),
    threadId: env.thread.id,
  });
  // Its own past conversations, on every desk and whether or not a topic is
  // settled (src/conversations): what was said is the reader's, the same way
  // the statements are, and the desk it was said over is only where to look
  // first.
  tools.push(...buildConversationTools({ topicId }));
  // Nothing has said what this conversation is about, so the offer to say it
  // rides the turn (docs/21): the roster in the prompt, the tool beside it. A
  // caller with no screen to draw the card on still mounts it — the AI is one
  // AI, and its answer is text (info/briefer/voice-call-live.ts).
  let prompt = "";
  if (topicId === null) {
    const list = topic.list ?? liveTopicChoices;
    prompt = topicGuidance(await list());
    tools.push(
      buildProposeTopicTool({
        threadId: env.thread.id,
        topics: list,
        onTopicCard: topic.onCard ?? (() => {}),
      }),
    );
  }
  if (topicId) {
    tools.push(
      ...buildObservationTools(getObservationAdapter(topicId), {
        bookId: anchor?.bookId ?? "",
        // The reader keeps one book as a standing frame while reading another,
        // and a search scoped to the topic in hand cannot see it
        // (memory/observations/recall.ts).
        otherTopics: () => listOtherTopicObservations(topicId),
        onWrite: () => notifyObservationChange(topicId),
      }),
    );
  }
  return { tools, statements: await assembleStatements(), prompt };
}

/**
 * The memory paragraph for one pass of the ladder: three blocks in a fixed
 * order (memory/live/memory-section.ts).
 *
 * The standing statements do not wait for an anchor. They are about the reader
 * and not about the material (docs/48), so they ride a turn with a book on the
 * desk, a turn with a briefing on it, and a turn with nothing on it at all. What
 * an anchor decides is the two blocks that are about material: what is still
 * open in this book, and the observations retrieval brought back.
 */
export function soulMemorySection(
  soul: Soul,
  env: DeskEnv,
  anchor: DeskMemory | undefined,
  dropped: ReadonlySet<string>,
): string {
  return memorySection({
    statements: dropped.has("reader-statements") ? [] : soul.statements,
    ...(anchor
      ? {
          anchor: {
            observations: anchor.observations,
            bookId: anchor.bookId,
            observationSnapshot: anchor.snapshot(dropped.has("observation-trim")),
          },
        }
      : {}),
    hasObservationTools: env.topic.id !== null,
  });
}
