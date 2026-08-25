// The reading domain's chat cards. One so far: the receipt a retell leaves
// when it records what a chapter contributes to the retell (docs/31).
//
// Read-only on purpose. Changing a decision is a sentence to the AI, which
// re-records it and raises a fresh card; a row of Edit/Delete buttons here would
// be a second, worse editor for something the conversation already edits well.
// Presentational, Tailwind-only, like the info cards.

import type { RetellDecisionCardData } from "../../../reading/retell/cards";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import type { ReadingCard } from "../../../reading/retell/cards";
import { Badge } from "../ui/badge";
import { TalkArrangementCard } from "./TalkArrangementCard";

export function RetellDecisionCard({ payload }: CardComponentProps<RetellDecisionCardData>) {
  const kept = payload.include;
  return (
    <div className="w-full max-w-md rounded-xl border border-black/10 bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#8a7fd0]">
          Chapter {payload.chapter}
        </span>
        <span className="flex-1" />
        <Badge className="shrink-0">{kept ? "In the retell" : "Cut"}</Badge>
      </div>
      <div className="mt-1 text-[15px] font-medium text-[#1b1b1b]">{payload.title}</div>
      {payload.points.length > 0 && (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
          {payload.points.map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-[#333]">
              <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-[#d0d0d0]" />
              <span className="min-w-0 flex-1">{p}</span>
            </li>
          ))}
        </ul>
      )}
      {payload.figure && (
        <div className="mt-2 text-[12px] text-[#666]">Figure: {payload.figure}</div>
      )}
      {payload.note && (
        <div className="mt-2 text-[12px] leading-snug text-[#999]">{payload.note}</div>
      )}
    </div>
  );
}

export const READING_CARD_REGISTRY: CardRegistryFor<ReadingCard["kind"]> = {
  "retell-decision": RetellDecisionCard,
  "talk-arrangement": TalkArrangementCard,
};
