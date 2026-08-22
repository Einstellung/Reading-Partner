// The receipt a side conversation leaves on the lesson it was pulled out of
// (docs/03, docs/09). Not a turn of the lesson and not drawn as one: a footnote
// row set against the left rule, tucked up under the message it interrupted
// (the pull is in chat.tsx, which knows the row spacing it has to cancel).
//
// It is also a door. A side conversation opened out of a reply has no mark and
// no page, so nothing in the margins of the book leads back to it; the lesson's
// transcript is the only place it exists, and pressing the row reopens it.
//
// One card carries every aside left in a row with nothing said in the lesson
// between them (reading/aside.ts). One of them is the row itself; several are
// collapsed to a count and open in place — a native disclosure, so the open
// state is the element's and nothing about it is written down.
// Presentational, Tailwind-only, like the other cards.

import {
  asideAnchorLabel,
  asideReceiptItems,
  asideReceiptSummary,
  type AsideCard,
  type AsideReceiptCardData,
  type AsideReceiptItem,
} from "../../../reading/aside";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";

// The rule down the left, which is what makes a run of rows read as one block
// of margin notes rather than as several stray lines. No display of its own:
// `display: flex` on a <details> is what stops WebKit hiding its closed
// content, and the rows do their own stacking.
const BLOCK = "border-l-2 border-muted-strong pl-3";

const LABEL =
  "shrink-0 text-[calc(0.6875rem*var(--chat-scale,1))] font-medium uppercase tracking-wider text-[#8a7fd0]";

// A Button rather than a bare <button>: the 44px touch target belongs to the
// size table (ui/button.tsx), and these rows are pressed on a tablet.
function AsideReceiptRow({
  item,
  onOpen,
}: {
  item: AsideReceiptItem;
  onOpen: () => void;
}) {
  const anchor = asideAnchorLabel(item);
  return (
    <Button
      type="button"
      variant="ghost"
      size="footnote"
      title={item.question}
      onClick={onOpen}
      className="w-full items-baseline justify-start gap-2 text-left text-[#555]"
    >
      <span className={LABEL}>Aside</span>
      {anchor !== "" && (
        <span className="max-w-[10em] shrink-0 truncate tabular-nums text-[#a99f88]">
          {anchor}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{item.question}</span>
      <span aria-hidden className="shrink-0 leading-none text-[#c0b6a0]">
        ›
      </span>
    </Button>
  );
}

export function AsideReceiptCard({ payload, dispatch }: CardComponentProps<AsideReceiptCardData>) {
  const items = asideReceiptItems(payload);
  if (items.length === 0) return null;
  const rows = items.map((item) => (
    <AsideReceiptRow
      key={item.threadId}
      item={item}
      onOpen={() => dispatch({ kind: "navigate", to: "aside", arg: item.threadId })}
    />
  ));
  if (items.length === 1) return <div className={`${BLOCK} flex flex-col`}>{rows}</div>;
  return (
    <details className={`group ${BLOCK}`}>
      <Button
        asChild
        variant="ghost"
        size="footnote"
        className="flex w-full cursor-pointer items-baseline justify-start gap-2 text-left text-[#6a6252] [&::-webkit-details-marker]:hidden"
      >
        <summary className="list-none">
          <span
            aria-hidden
            className="shrink-0 leading-none text-[#c0b6a0] transition-transform group-open:rotate-90"
          >
            ›
          </span>
          <span className={LABEL}>Aside</span>
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {asideReceiptSummary(items.length)}
          </span>
        </summary>
      </Button>
      <div className="flex flex-col">{rows}</div>
    </details>
  );
}

export const ASIDE_CARD_REGISTRY: CardRegistryFor<AsideCard["kind"]> = {
  aside: AsideReceiptCard,
};
