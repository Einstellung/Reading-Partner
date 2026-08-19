// The line a side conversation leaves on the lesson it was pulled out of
// (docs/03, docs/09). The row carrying it renders no prose — a card part stands
// alone — so this chip is what the reader sees where the model sees a sentence.
//
// It is also a door. A side conversation opened out of a reply has no mark and
// no page, so nothing in the margins of the book leads back to it; the lesson's
// transcript is the only place it exists, and pressing the chip reopens it.
// Presentational, Tailwind-only, like the other cards.

import type { AsideCard, AsideReceiptCardData } from "../../../reading/aside";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";

// A Button rather than a bare <button>: the 44px touch target belongs to the
// size table (ui/button.tsx), and this chip is pressed on a tablet.
export function AsideReceiptCard({ payload, dispatch }: CardComponentProps<AsideReceiptCardData>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="chip"
      title={payload.span}
      onClick={() => dispatch({ kind: "navigate", to: "aside", arg: payload.threadId })}
      className="w-full max-w-md justify-start gap-2 rounded-xl bg-white/60 px-3 py-2 text-left can-hover:hover:bg-white"
    >
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-[#8a7fd0]">
        Aside
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] leading-snug text-[#555]">
        {payload.question}
      </span>
      <span aria-hidden className="shrink-0 text-[13px] leading-none text-neutral-400">
        ›
      </span>
    </Button>
  );
}

export const ASIDE_CARD_REGISTRY: CardRegistryFor<AsideCard["kind"]> = {
  aside: AsideReceiptCard,
};
