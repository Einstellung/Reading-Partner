// The brain's half of an assembled turn (docs/48, docs/61): what is known about
// the reader, and the tools that write it down. It rides every turn whatever is
// on the desk, because it is about the reader and not about the material — the
// same statements pitch an explanation of a book, of a briefing, of a talk being
// rehearsed.
//
// Kept apart from turn.ts so that "what the brain contributes" can be read
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
} from "../../memory";
import type { DeskEnv, DeskMemory } from "../../desk";
import { getThread } from "../../platform/app/threads";
import type { AgentTool } from "../agent";

export interface Brain {
  // statement_write, and the observation tools wherever there is a topic to
  // scope them to.
  tools: AgentTool[];
  // Every statement there is. Which of them ride the prompt is the ladder's
  // call, one pass at a time, so they are read once and filtered per pass.
  statements: readonly Statement[];
}

/**
 * Read what the brain brings to this turn: the tools it mounts and the
 * statements it may print. `anchor` is the memory of the item that anchors the
 * retrieval, which is where the observation tools get the book they are scoped
 * to.
 */
export async function openBrain(env: DeskEnv, anchor: DeskMemory | undefined): Promise<Brain> {
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
  return { tools, statements: await assembleStatements() };
}

/**
 * The memory paragraph for one pass of the ladder: three blocks in a fixed
 * order (memory/live/memory-section.ts). Empty when no item anchors the
 * retrieval — nothing on the desk is something the reader is working through,
 * so there is nothing for the statements to be about.
 */
export function brainMemorySection(
  brain: Brain,
  env: DeskEnv,
  anchor: DeskMemory | undefined,
  dropped: ReadonlySet<string>,
): string {
  if (!anchor) return "";
  return memorySection({
    statements: dropped.has("reader-statements") ? [] : brain.statements,
    observations: anchor.observations,
    bookId: anchor.bookId,
    observationSnapshot: anchor.snapshot(dropped.has("observation-trim")),
    hasObservationTools: env.topic.id !== null,
  });
}
