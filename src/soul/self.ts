// What the soul carries into every turn, whatever lies on the desk (docs/48,
// docs/61): what is known about the reader, and the tools that write it down.
// It is about the reader and not about the material — the same statements pitch
// an explanation of a book, of a briefing, of a talk being rehearsed.
//
// Kept apart from turn.ts so that "what the soul contributes" can be read
// without reading how a call is fitted to a window.

import {
  OBSERVATION_WRITE_TOOL,
  assembleStatements,
  buildObservationTools,
  buildStatementTools,
  getObservationAdapter,
  latestReaderMessage,
  listOtherTopicObservations,
  filingTools,
  memorySection,
  notifyObservationChange,
  statementStore,
  type Statement,
  type TopicProposalSurface,
} from "../memory";
import { buildConversationTools } from "../conversations";
import type { DeskEnv, DeskMemory } from "../desk";
import { getThread } from "../platform/app/threads";
import type { AgentTool } from "../ai/agent";

export interface Soul {
  // statement_write, the conversation tools, the observation tools — all three
  // where there is a topic to file a new one under, the two that only read where
  // there is not — and propose_topic wherever the conversation is filed under no
  // topic and the caller can draw the card the proposal ends in.
  tools: AgentTool[];
  // Every statement there is. Which of them ride the prompt is the ladder's
  // call, one pass at a time, so they are read once and filtered per pass.
  statements: readonly Statement[];
  // Whether this turn has a topic to file an observation under. It decides
  // whether the memory paragraph explains the observation tools: that paragraph
  // is written around observation_update, and a turn that cannot write one would
  // be told how to use a tool it was not given.
  writesObservations: boolean;
  // What the capabilities the soul mounted publish into the system prompt —
  // today the topic roster filing prints beside propose_topic, and nothing else.
  // Empty where nothing was mounted. The soul says nothing in its own name: it
  // belongs to no topic and to no material, so it has no paragraph of its own.
  // It belongs to no item on the desk either, so the assembly prints it
  // (turn.ts).
  prompt: string;
}

/**
 * Read what the soul brings to this turn: the tools it mounts and the
 * statements it may print.
 *
 * The soul is under no topic. A topic is where data is filed, so what decides
 * the scope of a write is the material: `anchor` is the memory of the item that
 * anchors the retrieval, and the topic it lies under is the topic an observation
 * written this turn goes to. Failing that, the topic this conversation was filed
 * under. Failing both, memory still rides — recall reaches every topic — and
 * only the write tool stays behind, because there is nowhere to put what it
 * would write.
 *
 * `filing` is where a proposal for this conversation's topic would be drawn; a
 * caller that has nowhere to draw one is offered no way to propose.
 */
export async function openSoul(
  env: DeskEnv,
  anchor: DeskMemory | undefined,
  filing?: TopicProposalSurface,
): Promise<Soul> {
  const thread = getThread(env.thread.key, env.thread.id);
  const messages = thread?.messages ?? [];
  // What this conversation is filed under, read per turn rather than when it
  // opened: filing is a gesture made mid-conversation, and the turn right after
  // it is the one that has to read the new topic's memory.
  const filedTopic = thread?.topicId ?? null;
  // The topic this turn's writes are filed under: the material's first, since an
  // observation is about what is being read, and the conversation's own where
  // nothing on the desk carries one.
  const scope = anchor?.topicId ?? filedTopic;
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
  tools.push(...buildConversationTools({ topicId: scope }));
  // Nothing has said what this conversation is about, so the offer to say it
  // rides the turn (docs/21, memory/filing). Only where the caller can draw the
  // card, though — the tool writes nothing, the card is its whole effect, and
  // mounting it on a surface with nowhere to draw one leaves the model telling
  // the reader to confirm a card that was never shown.
  let prompt = "";
  if (filing) {
    const mounted = await filingTools({ ...filing, threadId: env.thread.id, filedTopic });
    tools.push(...mounted.tools);
    prompt = mounted.prompt;
  }
  // What is known about the reader rides every turn, because it is about the
  // reader and not about what they are reading. With no topic to file under, the
  // write tool is the one thing that cannot ride: recall still reaches every
  // topic the reader has, and a write would have nowhere to land.
  const observation = buildObservationTools(getObservationAdapter(scope ?? ""), {
    bookId: anchor?.bookId ?? "",
    // The reader keeps one book as a standing frame while reading another,
    // and a search scoped to the topic in hand cannot see it
    // (memory/observations/recall.ts). With no topic in hand at all, this is
    // every topic there is.
    otherTopics: () => listOtherTopicObservations(scope ?? ""),
    ...(scope ? { onWrite: () => notifyObservationChange(scope) } : {}),
  });
  tools.push(...(scope ? observation : observation.filter((t) => t.name !== OBSERVATION_WRITE_TOOL)));
  return {
    tools,
    statements: await assembleStatements(),
    prompt,
    writesObservations: scope !== null,
  };
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
    hasObservationTools: soul.writesObservations,
  });
}
