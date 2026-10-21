// The topic-search drafting card in the door conversation (docs/info/88 起草).
// Drawn like the lab-proposal card (info/InfoCards.tsx): the draft shown whole,
// corrections made by talking, one Apply. Presentational: Apply only raises
// intent; use-door-chat.ts writes the config and the concern.

import { useT } from "../../../i18n";
import {
  draftingSourcesLine,
  TOPIC_SEARCH_APPLY_OP,
  type TopicSearchCard as TopicSearchCardPayload,
  type TopicSearchProposalCardData,
} from "../../../info/topic-search/cards";
import { splitsFirstLook } from "../../../info/topic-search/pace";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";
import { StudySeedsCard } from "./StudySeedsCard";

function Bullets({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
          <span className="mt-2 h-1 w-1 flex-none rounded-full bg-muted-strong" />
          <span className="min-w-0 flex-1 text-muted-foreground">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2.5">
      <div className="text-[12px] font-medium text-faint-foreground">{title}</div>
      <Bullets items={items} />
    </div>
  );
}

export function TopicSearchProposalCard({ payload, dispatch }: CardComponentProps<TopicSearchProposalCardData>) {
  const t = useT();
  const applied = payload.phase === "applied";
  const sources = draftingSourcesLine(payload);
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
        {applied ? t("info.cards.topicSearchFollowing") : t("info.cards.topicSearchToFollow")}
      </div>
      <div className="mt-1 text-[15px] font-medium text-foreground">{payload.name}</div>
      <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{payload.scope}</div>
      {payload.subtopics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {payload.subtopics.map((s) => (
            <span
              key={s.id}
              className={
                s.picked
                  ? "rounded-full border border-border bg-card px-2 py-0.5 text-[12px] text-foreground"
                  : "rounded-full border border-border px-2 py-0.5 text-[12px] text-faint-foreground line-through"
              }
            >
              {s.name}
            </span>
          ))}
        </div>
      )}
      <Section title={t("info.cards.topicSearchWant")} items={payload.want} />
      <Section title={t("info.cards.topicSearchAvoid")} items={payload.avoid} />
      <Section title={t("info.cards.topicSearchJudgments")} items={payload.judgments} />
      {payload.seeds && payload.seeds.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[12px] font-medium text-faint-foreground">{t("info.cards.topicSearchSeeds")}</div>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
            {payload.seeds.map((seed) => (
              <li key={seed.key} className="text-[13px] leading-snug">
                <div className="text-foreground">{seed.title}</div>
                <div className="text-[12px] text-faint-foreground">
                  {[seed.authors.length > 3 ? `${seed.authors[0]} et al.` : seed.authors.join(", "), seed.date].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 text-[12px] leading-snug text-faint-foreground">{sources}</div>
      {payload.once && (
        <div className="mt-1 text-[12px] leading-snug text-faint-foreground">{t("info.cards.topicSearchOnce")}</div>
      )}
      {!applied && (
        <div className="mt-1 text-[12px] leading-snug text-faint-foreground">
          {payload.eta === "soon" ? t("info.cards.topicSearchEtaSoon") : t("info.cards.topicSearchEtaTonight")}
          {splitsFirstLook("first", payload) ? ` ${t("info.cards.topicSearchSlowSources")}` : ""}
        </div>
      )}
      <div className="mt-3.5 flex items-center justify-end gap-2">
        {applied ? null : (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            onClick={() => dispatch({ kind: "mutate", op: TOPIC_SEARCH_APPLY_OP })}
          >
            {t("info.cards.topicSearchFollow")}
          </Button>
        )}
      </div>
    </div>
  );
}

export const TOPIC_SEARCH_CARD_REGISTRY: CardRegistryFor<TopicSearchCardPayload["kind"]> = {
  "topic-search-proposal": TopicSearchProposalCard,
  "study-seeds": StudySeedsCard,
};
