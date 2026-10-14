// The drafting card (docs/info/88 起草：来回问): what propose_topic_search drew
// in the door conversation. The tool writes nothing; the card's Apply writes
// the config and the concern (apply.ts). Everything the runs need rides on the
// card, the queries included, but only what the reader agrees to is drawn:
// the search words are never shown.

import { t } from "../../i18n";
import type { TopicQuery, TopicSubtopic } from "./types";

/** The card's Apply, as a mutate op the door chat answers. */
export const TOPIC_SEARCH_APPLY_OP = "apply-topic-search";

/** When the first result can be expected, from the desktop's claim heartbeat (eta.ts). */
export type FirstRunEta = "soon" | "tonight";

export interface TopicSearchProposalCardData {
  kind: "topic-search-proposal";
  threadId: string;
  // A stopped search this re-drafts. Apply then follows it again under the
  // same id and concern instead of starting a second one.
  searchId: string | null;
  name: string;
  scope: string;
  subtopics: TopicSubtopic[];
  want: string[];
  avoid: string[];
  judgments: string[];
  // The reading topic it files into: an existing one by id, or a new one made
  // under `name` on Apply.
  topic: { id: string | null; name: string };
  eta: FirstRunEta;
  // Not drawn.
  anchors: string[];
  queries: TopicQuery[];
  answers: { asked: string; answer: string }[];
  concern: {
    // One sentence: the reader is following this.
    text: string;
    // A concern already saying the same thing, as the model pointed it out.
    existingId: string | null;
    // The anchor of the message the reader opened with, resolved by the program.
    evidence: string | null;
  };
  phase: "draft" | "applied";
}

export type TopicSearchCard = TopicSearchProposalCardData;

/** The line left in the conversation once the card is applied. */
export function topicSearchAppliedNote(card: TopicSearchProposalCardData): string {
  return t("info.call.note.topicSearchApplied", { name: card.name });
}
