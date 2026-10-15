// Lumen's conversation (docs/68): the day's conversation at the door, drawn with
// the chat every other conversation uses (CallView, its cards included).
//
// Rendering and event binding only; the conversation is use-door-chat.ts, which
// box items are drawn into the timeline is box-timeline.ts, and the sheet's pull
// is door-sheet.ts.
//
// The box is in here (2026-10-15): today's conversation draws every item still
// in the box as a card among its rows. Those rows are drawn, never sent and
// never written — the hook's own rows are what the model and the file see.
//
// Two forms, by shell. On the phone it is the whole screen, risen from the
// bottom and pulled back down by its top bar, and Lumen stands down while it is
// up: the sheet registers as one (BottomSheetLayer), which is what the corner
// already gets out of the way for. The sheet is `absolute` in
// the phone shell, not `fixed`: the shell moves to what the keyboard leaves
// visible (KeyboardShell, docs/pitfall/443) and the sheet has to move with it,
// as every other phone conversation does by being drawn inside it. On the iPad and the desktop
// it is a panel standing on top of Lumen at the corner's edge, so it follows the
// corner to whichever edge it was dragged to and Lumen stays where it was, under
// it. The panel is drawn in the shell too, in a layer of its own and not in the
// corner's `fixed` column, for the same reason as the sheet (docs/pitfall/506):
// the iPad's first keyboard scrolls the document and a `fixed` column goes with
// it. With a keyboard up the panel stands on the keyboard instead of on Lumen,
// which stands down for it (LumenCorner). The panel's expand button fills the
// shell with it and the same button brings it back; the page under it never
// moves.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import type { Fulltext } from "../../../fulltext/types";
import type { Citation } from "../../../reading/prep/anchors";
import { createQuoteCheck } from "../../../reading/session/citations";
import { CitationContext, QuoteCheckContext } from "../markdown/Markdown";
import { doorCitationJump, useOpenIssue, type IssueQuote } from "./issue-context";

import { BOX_CARD_DISMISS_OP, BOX_CARD_FOLLOW_OP } from "../../../box/card";
import type { BoxItem } from "../../../box/types";
import { useT } from "../../../i18n";
import { doorDate } from "../../../soul";
import { IconClose, IconExpand, IconShrink } from "../base/icons";
import type { CardAction } from "../chat/chatParts";
import CallView from "../chat/call/CallView";
import { holdInView } from "../common/stick-to-bottom";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { ShellKeyboardContext, useShellKeyboard, type ShellKeyboard } from "../common/useKeyboardInset";
import { BottomSheetLayer, OVERLAY_Z, OverlaySurface } from "../ui/overlay";
import { fullPadding, panelPadding } from "./door-panel";
import { sheetCloses, sheetOffset } from "./door-sheet";
import { itemIdOfBoxCard, timelineItems, withBoxCards } from "./box-timeline";
import { doorFocusSelector, type DoorFocus } from "./box-jump";
import lumenIcon from "./lumen-icon.webp";
import type { IntakeOpenDocument } from "./intake-view";
import { useDoorChat } from "./use-door-chat";

/** The box, as the corner reads it and acts on it. */
export interface DoorBox {
	/** The open items this device shows (use-box-items.ts). */
	items: BoxItem[];
	titles: Record<string, string>;
	onFollow(item: BoxItem): void;
	onDismiss(item: BoxItem): void;
	/** One line about the last card followed, when it could not be followed here. */
	note: string | null;
}

// How long the sheet takes to go once a pull lets it go.
const SHEET_OUT_MS = 200;

export function DoorChat({
	form,
	liftPx = 0,
	mirrored = false,
	full = false,
	onToggleFull,
	date,
	focus,
	box,
	onOpenDocument,
	openedFor,
	quote = null,
	onQuoteDone,
	onClose,
}: {
	form: "sheet" | "panel";
	/** The panel fills the shell (its expand button). */
	full?: boolean;
	onToggleFull?: () => void;
	box?: DoorBox;
	/** How far the corner stands above its usual place (use-corner-drag.ts). */
	liftPx?: number;
	/** The corner is docked at the left edge, and the panel stands there with it. */
	mirrored?: boolean;
	/** The day's conversation to open; today when absent. Read once, at mount. */
	date?: string;
	/** The row to bring into view once the conversation is drawn (a box card's jump). Read once, at mount. */
	focus?: DoorFocus;
	onOpenDocument?: (doc: IntakeOpenDocument) => void;
	/** The brief whose opening brought the conversation up; read once, at mount. */
	openedFor?: string;
	/** A passage asked about in the brief, shown above the composer and sent with the next line. */
	quote?: IssueQuote | null;
	/** The passage was sent or put away. */
	onQuoteDone?: () => void;
	onClose: () => void;
}) {
	const t = useT();
	const shellKeyboard = useShellKeyboard();
	const chat = useDoorChat({
		...(date ? { date } : {}),
		...(onOpenDocument ? { onOpenDocument } : {}),
		...(openedFor ? { openedFor } : {}),
	});

	// With a brief open, Lumen's page citations are the brief's: checked against
	// its text, and a tap puts the conversation away and takes the reader to the
	// passage (issue-context.ts). Otherwise whatever the shell provides stands.
	const issue = useOpenIssue();
	const [issueText, setIssueText] = useState<Fulltext | null>(null);
	useEffect(() => {
		let live = true;
		setIssueText(null);
		void issue
			?.fulltext()
			.then((text) => {
				if (live) setIssueText(text);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [issue]);
	const verifyQuote = useMemo(() => createQuoteCheck(issueText), [issueText]);
	const onCitation = useCallback(
		(c: Citation) => {
			const jump = doorCitationJump(c, issue !== null);
			if (!jump || !issue) return;
			onClose();
			issue.jump(jump.pageIndex, jump.quote);
		},
		[issue, onClose],
	);

	// Today's conversation carries the box; an earlier day opened from a card
	// is that day as it was.
	const [today] = useState(() => !date || date === doorDate());
	const rows = useMemo(
		() => (box ? withBoxCards(chat.messages, timelineItems(box.items, chat.messages, today), box.titles) : chat.messages),
		[box, chat.messages, today],
	);
	const chatAction = chat.onCardAction;
	const onCardAction = (cardId: string, action: CardAction) => {
		const itemId = itemIdOfBoxCard(cardId);
		if (itemId === null) {
			chatAction(cardId, action);
			return;
		}
		const item = box?.items.find((one) => one.id === itemId);
		if (!box || !item || action.kind !== "mutate") return;
		if (action.op === BOX_CARD_FOLLOW_OP) box.onFollow(item);
		else if (action.op === BOX_CARD_DISMISS_OP) box.onDismiss(item);
	};

	// The sheet's pull: a finger on its top bar drags it down, and lets it go
	// or springs it back on release (door-sheet.ts). Written straight onto the
	// sheet as a transform; nothing re-renders while the finger moves.
	const sheetRef = useRef<HTMLDivElement | null>(null);
	const pull = useRef<{ y: number; lastY: number; lastAt: number; velocity: number } | null>(null);
	const pullHandlers = {
		onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
			if ((event.target as Element).closest("button")) return;
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Without capture the moves still arrive while over the bar.
			}
			pull.current = { y: event.clientY, lastY: event.clientY, lastAt: event.timeStamp, velocity: 0 };
			if (sheetRef.current) sheetRef.current.style.transition = "none";
		},
		onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
			const p = pull.current;
			if (!p) return;
			const dt = event.timeStamp - p.lastAt;
			if (dt > 0) p.velocity = (event.clientY - p.lastY) / dt;
			p.lastY = event.clientY;
			p.lastAt = event.timeStamp;
			if (sheetRef.current) sheetRef.current.style.transform = `translateY(${sheetOffset(event.clientY - p.y)}px)`;
		},
		onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
			const p = pull.current;
			pull.current = null;
			const sheet = sheetRef.current;
			if (!p || !sheet) return;
			sheet.style.transition = `transform ${SHEET_OUT_MS}ms ease-out`;
			if (sheetCloses(event.clientY - p.y, p.velocity)) {
				sheet.style.transform = "translateY(100%)";
				window.setTimeout(onClose, SHEET_OUT_MS);
			} else sheet.style.transform = "";
		},
		onPointerCancel: () => {
			pull.current = null;
			const sheet = sheetRef.current;
			if (!sheet) return;
			sheet.style.transition = `transform ${SHEET_OUT_MS}ms ease-out`;
			sheet.style.transform = "";
		},
	};

	// Back to the row the box item stands for: once, after the rows are drawn
	// and the transcript has put its own scroll back. Held there while the cards
	// settle, or the transcript's pin takes it back to the bottom on their first
	// growth (common/stick-to-bottom.ts).
	const [selector] = useState(() => (focus ? doorFocusSelector(focus) : null));
	const focused = useRef(false);
	useEffect(() => {
		if (!selector || focused.current || !chat.ready || chat.messages.length === 0) return;
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				const row = document.querySelector(selector);
				if (!row) return;
				focused.current = true;
				holdInView(row);
			});
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [selector, chat.ready, chat.messages.length]);

	const sizeLabel = full ? t("shell.door.shrink") : t("shell.door.expand");
	const header = (
		<div
			className={cn(
				"flex flex-none flex-col border-b border-border-subtle bg-background",
				form === "sheet" && "touch-none select-none",
			)}
			{...(form === "sheet" ? pullHandlers : {})}
		>
			{/* The sheet's grip: what says the bar can be pulled down. */}
			{form === "sheet" && <span aria-hidden="true" className="mx-auto mt-1.5 h-1 w-9 rounded-full bg-border" />}
			<div className="flex items-center gap-2 py-1.5 pl-3.5 pr-1.5">
			<img src={lumenIcon} alt="" draggable={false} className="h-6.5 w-6.5 select-none" />
			<span className="flex-1 text-[15px] font-semibold text-foreground">{t("shell.door.title")}</span>
			{form === "panel" && onToggleFull && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={sizeLabel}
					title={sizeLabel}
					aria-pressed={full}
					onClick={onToggleFull}
					className="text-muted-foreground"
				>
					{full ? <IconShrink size={16} /> : <IconExpand size={16} />}
				</Button>
			)}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label={t("shell.door.close")}
				title={t("shell.door.close")}
				onClick={onClose}
				className="text-muted-foreground"
			>
				<IconClose size={18} />
			</Button>
			</div>
			{box?.note && <p className="m-0 px-3.5 pb-1.5 text-[12px] text-muted-foreground">{box.note}</p>}
		</div>
	);

	// The passage an Ask in the brief brought, above the composer until it is
	// sent with the question or put away.
	const quoteStrip = quote ? (
		<div className="mb-2 flex items-start gap-1 rounded-xl border border-border-subtle bg-background py-1.5 pl-3 pr-1">
			<p className="m-0 line-clamp-3 flex-1 py-1 text-[13px] italic leading-snug text-muted-foreground">
				“{quote.text}”
			</p>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label={t("shell.door.dropQuote")}
				title={t("shell.door.dropQuote")}
				onClick={onQuoteDone}
				className="text-muted-foreground"
			>
				<IconClose size={14} />
			</Button>
		</div>
	) : undefined;

	const view = (
		<CallView
			messages={rows}
			onSend={(text) => {
				void chat.send(text, quote ?? undefined);
				if (quote) onQuoteDone?.();
			}}
			footer={quoteStrip}
			onHangUp={onClose}
			streaming={chat.streaming}
			onStop={chat.stop}
			emptyTitle={t("shell.door.empty")}
			placeholder={t("shell.door.placeholder")}
			// Dictation waits for voice to be designed across every surface.
			voice={false}
			onCardAction={onCardAction}
			scalable={false}
			stickKey={chat.stickKey}
			header={header}
		/>
	);
	const cited = issue ? (
		<CitationContext.Provider value={onCitation}>
			<QuoteCheckContext.Provider value={verifyQuote}>{view}</QuoteCheckContext.Provider>
		</CitationContext.Provider>
	) : (
		view
	);

	if (form === "sheet") {
		return (
			<OverlaySurface layer="floating">
				{/* Two boxes: the rise is a CSS animation, and an animation's
				    transform would win over the pull's inline one under it. */}
				<div
					role="dialog"
					aria-label={t("shell.door.title")}
					className={cn(
						"absolute inset-0 motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300",
						OVERLAY_Z.floating,
					)}
				>
					<div ref={sheetRef} className="flex h-full flex-col bg-chat-surface p-safe">
						<BottomSheetLayer />
						{cited}
					</div>
				</div>
			</OverlaySurface>
		);
	}

	// The panel itself stands clear of the keyboard, so the conversation in it
	// pads for none; only the shell's `cramped` still applies.
	const inPanel: ShellKeyboard = { covered: 0, cramped: shellKeyboard?.cramped ?? false };
	return (
		<OverlaySurface layer="floating">
			<div
				className={cn(
					"pointer-events-none absolute inset-0 flex flex-col justify-end",
					full ? "items-stretch" : mirrored ? "items-start pl-safe-4" : "items-end pr-safe-4",
					OVERLAY_Z.floating,
				)}
				style={full ? fullPadding(shellKeyboard) : panelPadding(shellKeyboard, liftPx)}
			>
				<div
					role="dialog"
					aria-label={t("shell.door.title")}
					className={cn(
						"pointer-events-auto flex min-h-0 flex-col overflow-hidden bg-chat-surface",
						full
							? "h-full w-full"
							: "h-[36rem] max-h-full w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border shadow-lg",
					)}
					onKeyDown={(event) => {
						if (event.key === "Escape") onClose();
					}}
				>
					<ShellKeyboardContext.Provider value={inPanel}>{cited}</ShellKeyboardContext.Provider>
				</div>
			</div>
		</OverlaySurface>
	);
}
