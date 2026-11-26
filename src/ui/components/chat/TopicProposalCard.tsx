// The topic-proposal card: the companion says where a conversation belongs and
// what it adds, the reader nods (docs/21). Presentational — Apply only raises
// intent; the host mints the topic and files the conversation.

import { proposedTopicName, type TopicProposalCardData } from "../../../memory";
import type { CardComponentProps, CardRegistryFor } from "./chatParts";
import { Button } from "../ui/button";
import { useT } from "../../../i18n";

export function TopicProposalCard({ payload, dispatch }: CardComponentProps<TopicProposalCardData>) {
  const t = useT();
  const applied = payload.phase === "applied";
  const isNew = !("id" in payload.topic);
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? t("chat.topicCard.filed") : t("chat.topicCard.whereThisBelongs")}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">
        {proposedTopicName(payload.topic)}
      </div>
      {isNew && !applied ? (
        <div className="mt-0.5 text-[12px] text-faint-foreground">{t("chat.topicCard.newTopic")}</div>
      ) : null}
      <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{payload.meaning}</div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {applied ? (
          <span className="text-[12px] text-faint-foreground">{t("chat.topicCard.onYourShelf")}</span>
        ) : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: "apply-topic" })}
          >
            {isNew ? t("chat.topicCard.createAndFile") : t("chat.topicCard.fileIt")}
          </Button>
        )}
      </div>
    </div>
  );
}

// The lab-proposal card: the companion drafts a room's charter out of the

export const TOPIC_PROPOSAL_CARD_REGISTRY: CardRegistryFor<"topic-proposal"> = {
  "topic-proposal": TopicProposalCard,
};
