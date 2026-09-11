// The card propose_topic draws (docs/21, docs/61).
//
// Filing is memory's, not the soul's: a topic is where data is kept, and the
// person at the desk belongs under none of them.
//
// A separate file from the tool because the renderer imports the type and
// nothing else: a card is drafted in one place, drawn in another, applied in a
// third.

/**
 * Shown when propose_topic offers a home for the conversation: the topic it
 * belongs under — one the reader already has, or a new one — and what the
 * material adds to that topic. The tool writes nothing; Apply mints the topic
 * where it is new and files the conversation under it.
 */
export interface TopicProposalCardData {
  kind: "topic-proposal";
  // The conversation the proposal files, so a card read back off disk still
  // knows what it was about.
  threadId: string;
  // An existing topic, or a name for one that does not exist yet.
  topic: { id: string; name: string } | { newName: string };
  // What this material adds to that topic: what it contributes, and whether it
  // confirms or contradicts what the reader has already read.
  meaning: string;
  phase: "draft" | "applied";
}

/** The name a proposal reads as, whichever half of the union it is. */
export function proposedTopicName(topic: TopicProposalCardData["topic"]): string {
  return "id" in topic ? topic.name : topic.newName;
}
