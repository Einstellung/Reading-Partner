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
//
// Voice chat is entered here (2026-10-20): the round waveform button beside the
// composer starts a hands-free call and puts the conversation away, and the
// reader talks to Lumen in the corner. The call is the corner's, not this
// view's, so closing this leaves it running. Opened during a call, the composer
// is a bar that says what the call is doing and the button beside it ends the
// call; there is no typing while one is up. What is said in the call is written
// into today's conversation as it settles (info/briefer/call-transcript.ts) and
// arrives here like any other line. Where a call cannot start the button is
// grey, and a tap on it says why in one line (door-voice.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import type { Fulltext } from "../../../fulltext/types";
import type { Citation } from "../../../reading/prep/anchors";
import { createQuoteCheck } from "../../../reading/session/citations";
import { CitationContext, QuoteCheckContext } from "../markdown/Markdown";
import { doorCitationJump, openingReplyTs, useOpenIssue, type IssueQuote } from "./issue-context";

import { BOX_CARD_DISMISS_OP, BOX_CARD_FOLLOW_OP } from "../../../box/card";
import type { BoxItem } from "../../../box/types";
import { useT } from "../../../i18n";
import { doorDate } from "../../../soul";
import { IconClose, IconEnd, IconExpand, IconShrink, IconWave } from "../base/icons";
import type { CardAction } from "../chat/chatParts";
import CallView from "../chat/call/CallView";
import { holdInView, revealSent } from "../common/stick-to-bottom";
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
import { useCompanionName } from "../base/use-companion-name";
import { useDoorChat } from "./use-door-chat";
import { voiceOffLine, voicePhaseLine, type VoiceEntry } from "./door-voice";
import type { SessionPhase } from "../../../soul/voice/voice-session";

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

/** Voice chat with Lumen, as the corner holds it (LumenCorner). */
export interface DoorVoice {
	/** A call is up. */
	live: boolean;
	phase: SessionPhase;
	entry: VoiceEntry;
	onStart(): void;
	onEnd(): void;
}

// How long the greyed button's one line stays up.
const VOICE_NOTE_MS = 4000;

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
	voice,
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
	/** Voice chat: the button beside the composer, and the bar in its place during a call. */
	voice?: DoorVoice;
	onClose: () => void;
}) {
	const t = useT();
	const companionName = useCompanionName();
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

	// The brief's opening, once it lands, is put near the top of the conversation
	// so what follows it (the questions) is in view. Once, not a follow: nothing
	// after it moves the list (common/stick-to-bottom.ts revealSent).
	const [cameUpAt] = useState(() => Date.now());
	const openingPlaced = useRef(false);
	useEffect(() => {
		if (!openedFor || openingPlaced.current) return;
		const ts = openingReplyTs(chat.messages, cameUpAt);
		if (ts === null) return;
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				const row = document.querySelector(`[data-reply-ts="${ts}"]`);
				if (!row) return;
				openingPlaced.current = true;
				revealSent(row);
			});
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [openedFor, chat.messages, cameUpAt]);

	// The greyed button's reason, up for a moment after a tap on it.
	const [voiceNote, setVoiceNote] = useState<string | null>(null);
	useEffect(() => {
		if (!voiceNote) return;
		const timer = window.setTimeout(() => setVoiceNote(null), VOICE_NOTE_MS);
		return () => window.clearTimeout(timer);
	}, [voiceNote]);
	const voiceLive = voice?.live ?? false;
	const voiceButton = voice ? (
		voice.live ? (
			<Button
				type="button"
				variant="end"
				size="voice"
				aria-label={t("shell.door.voiceEnd")}
				title={t("shell.door.voiceEnd")}
				onClick={voice.onEnd}
				className="shrink-0"
			>
				<IconEnd />
			</Button>
		) : (
			<Button
				type="button"
				variant={voice.entry.kind === "ready" ? "voice" : "voice-off"}
				size="voice"
				aria-label={t("shell.door.voiceStart")}
				title={t("shell.door.voiceStart")}
				// Not `disabled`: a tap on the grey button is how the reader learns why.
				aria-disabled={voice.entry.kind === "ready" ? undefined : true}
				onClick={() => {
					if (voice.entry.kind === "ready") {
						setVoiceNote(null);
						voice.onStart();
					} else setVoiceNote(t(voiceOffLine(voice.entry.reason)));
				}}
				className="shrink-0"
			>
				<IconWave />
			</Button>
		)
	) : undefined;
	// In the composer's place during a call: what the call is doing, in the
	// pill's own shape.
	const voiceBar = voice?.live ? (
		<div
			role="status"
			className="box-border flex min-h-13 items-center gap-2.5 rounded-3xl border border-black/10 bg-background px-4 text-[14px] text-foreground shadow-sm"
		>
			<span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-blue-500 motion-safe:animate-pulse" />
			<span>{t(voicePhaseLine(voice.phase))}</span>
		</div>
	) : undefined;

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
			<span className="flex-1 text-[15px] font-semibold text-foreground">{t("shell.door.title", { name: companionName })}</span>
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
	const quoteStrip = quote && !voiceLive ? (
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
			footer={
				voiceNote ? (
					<>
						{quoteStrip}
						<p role="status" className="m-0 mb-2 px-1 text-[12.5px] text-muted-foreground">
							{voiceNote}
						</p>
					</>
				) : (
					quoteStrip
				)
			}
			beside={voiceButton}
			replaceComposer={voiceBar}
			onHangUp={onClose}
			streaming={chat.streaming}
			onStop={chat.stop}
			emptyTitle={t("shell.door.empty")}
			placeholder={t("shell.door.placeholder", { name: companionName })}
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
					aria-label={t("shell.door.title", { name: companionName })}
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
					aria-label={t("shell.door.title", { name: companionName })}
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
