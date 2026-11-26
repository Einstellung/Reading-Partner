// The note a conversation gets when the reader files it under the topic it
// proposed (the door, meals). Said in the reader's voice, because it is their
// gesture the AI is being told about.

import { proposedTopicName, type TopicProposalCardData } from "../../../../memory";
import { t } from "../../../../i18n";

export function topicFiledNote(card: TopicProposalCardData): string {
  return t("chat.call.note.topicFiled", { name: proposedTopicName(card.topic) });
}
