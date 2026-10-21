// A box item in the companion's conversation (docs/68, 2026-10-15): a card the program
// put there, drawn as a card and not as something the companion said. One cover line
// over where it came from. A press follows it back to where it belongs; a
// sideways swipe of a finger presses it away, and where there is a pointer the
// same thing is an × that appears under the cursor. An item that waits for the
// reader's decision has neither.
//
// Presentational: both gestures only raise intent, and the corner does the
// following and the writing (CompanionCorner.tsx).

import { useRef, useState } from "react";

import { BOX_CARD_DISMISS_OP, BOX_CARD_FOLLOW_OP, type BoxItemCard } from "../../../box/card";
import { useT } from "../../../i18n";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { cn } from "../lib/utils";
import { isDismissSwipe, originLabel } from "./box-cards";

export function BoxCard({ payload, dispatch }: CardComponentProps<BoxItemCard>) {
	const t = useT();
	const { item, pinned } = payload;
	const from = useRef<{ x: number; y: number; touch: boolean } | null>(null);
	const [swiped, setSwiped] = useState(false);
	const [gone, setGone] = useState(false);
	if (gone) return null;

	const dismiss = () => {
		setGone(true);
		dispatch({ kind: "mutate", op: BOX_CARD_DISMISS_OP });
	};

	return (
		<div
			className="group relative w-full max-w-md"
			data-box-item={item.id}
			onPointerDown={(event) => {
				from.current = { x: event.clientX, y: event.clientY, touch: event.pointerType !== "mouse" };
				setSwiped(false);
			}}
			onPointerUp={(event) => {
				const start = from.current;
				from.current = null;
				if (!start || !start.touch || pinned) return;
				if (isDismissSwipe(event.clientX - start.x, event.clientY - start.y)) {
					setSwiped(true);
					dismiss();
				}
			}}
		>
			<button
				type="button"
				className="flex w-full flex-col items-start gap-1 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left can-hover:hover:bg-muted coarse:min-h-[44px]"
				onClick={() => {
					if (!swiped) dispatch({ kind: "mutate", op: BOX_CARD_FOLLOW_OP });
				}}
			>
				<span
					className={cn(
						"text-[11px] font-medium uppercase tracking-wider",
						item.needsDecision ? "text-accent-line" : "text-faint-foreground",
					)}
				>
					{item.needsDecision ? t("shell.companion.needsDecision") : t("shell.box.cardKicker")}
				</span>
				<span className="line-clamp-3 pr-5 text-[14px] leading-snug text-foreground">{item.cover}</span>
				<span className="text-[12px] text-muted-foreground">{originLabel(item.origin, payload.bookTitle)}</span>
			</button>
			{/* The finger swipes; the cursor gets a target, because there is no
			    swipe on a mouse and a card with no way out on the desktop would be
			    a card that only accumulates. */}
			{!pinned && (
				<button
					type="button"
					aria-label={t("shell.action.dismiss")}
					className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-md text-[14px] leading-none text-muted-foreground can-hover:group-hover:flex can-hover:hover:bg-muted"
					onClick={dismiss}
				>
					×
				</button>
			)}
		</div>
	);
}

export const BOX_CARD_REGISTRY: CardRegistryFor<"box-item"> = {
	"box-item": BoxCard,
};
