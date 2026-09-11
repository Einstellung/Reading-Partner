// What the topic card's Apply does (docs/21): the one write in the whole
// gesture, and the only place a proposal becomes a topic.
//
// Filing is memory's: the topic is where the material ends up, and nothing
// about it is the soul's.
//
// A sequence over ports rather than over the live stores, so the rules ("a
// second click does nothing", "a failed write changes nothing") are testable
// without React and without a filesystem.

import type { TopicProposalCardData } from "./card";

/** What one item on the desk asked to be told when the topic settles. */
export type TopicSettledHook = (topicId: string) => Promise<void>;

export interface TopicSettlePorts {
  // Mint the topic the proposal named. Only reached where the proposal was for
  // a new one; an existing topic is already an id.
  createTopic(name: string): Promise<{ id: string }>;
  // File this conversation under it, so the next turn's desk, the distillation
  // of what was said and its conversation search all read the topic the reader
  // chose (platform/app/threads: setThreadTopic).
  fileThread(threadId: string, topicId: string): void;
  // What the desk items registered (DeskItem.onTopicSettled). Filing the kept
  // article under the topic is one of these; which of them there are is the
  // items' business, and none of it is known here.
  settled?: readonly TopicSettledHook[];
  // The shelf reloads: a new topic has to appear on it.
  topicsChanged(): void;
}

export interface TopicApplied {
  // False when nothing was filed — the card was already applied, or the topic
  // could not be minted and the sequence stopped.
  ok: boolean;
  // The topic everything went under, once there is one.
  topicId: string | null;
}

/**
 * The topic card's Apply: create the topic where it is new, file this
 * conversation under it, and tell whatever else on the desk asked to be told.
 * Apply is the only write; the tool that drafted the card never saves.
 *
 * A second click on an applied card does nothing — it stays on screen for the
 * rest of the conversation and comes back on reopen, so re-clicking is an
 * ordinary thing to do, and without the guard it would mint a second topic by
 * the same name.
 *
 * A topic that could not be minted stops the sequence: there is nothing to file
 * anything under. A hook that throws does not — the conversation is filed, which
 * is the gesture the reader made, and what an item does about its own material
 * is the item's to retry.
 */
export async function applyTopicProposal(
  card: TopicProposalCardData,
  ports: TopicSettlePorts,
): Promise<TopicApplied> {
  if (card.phase === "applied") return { ok: false, topicId: null };
  let topicId: string;
  try {
    topicId = "id" in card.topic ? card.topic.id : (await ports.createTopic(card.topic.newName)).id;
  } catch {
    return { ok: false, topicId: null };
  }
  ports.fileThread(card.threadId, topicId);
  for (const hook of ports.settled ?? []) {
    try {
      await hook(topicId);
    } catch (e) {
      console.warn("a desk item could not follow the topic it was filed under", e);
    }
  }
  ports.topicsChanged();
  return { ok: true, topicId };
}
