// Lumen in the corner of every place, and the column of cards that rises from
// it (docs/68).
//
// Rendering and event binding only. The order of the column, the labels under
// the covers, the pose and where a card jumps to are box-cards.ts and
// box-jump.ts.
//
// One body, bottom right, 72px, in both shells and on every screen including
// the open reader. It does not grow and it does not re-centre — that was the
// mistake the briefing's corner was built to correct (info/VoiceOrbEntry), and
// a body that threw itself across an open book would be worse.
//
// Beside a book it is still: `still` stops the loop dead, and the resting pose
// the custom-property defaults paint is what stands there. The one thing that
// moves in the reader is the case: something arrives and Lumen pulls it out
// from behind itself and sets it down, the box empties and it puts it back
// (case-motion.ts). The eyes and the lean go with it, in the reader too.
//
// Two controls, and the body is one of them now. The case is the trigger the
// column rises from; a long press on Lumen opens the info voice session and a
// second one ends it (docs/68, hold-toggle.ts). A tap on the body is still
// wired to nothing — Lumen is not a button, the props it brings are.
//
// The session is the info screen's. What it would be about is published by
// whichever screen holds it (voice-context.ts) and the call is built here, so
// it outlives the screen it was opened from and can be hung up from anywhere.
// Where nothing is registered and no call is up the body does not even charge,
// which is what makes the gesture legible: it only lights up where it can talk.
//
// The count. `appBox()` caches nothing, so the number is read twice over: the
// store's own subscribe covers a write made in this process, and the sync tick
// covers an item that arrived from the other device.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UNSEEN, appBox } from "../../../box";
import type { BoxItem } from "../../../box/types";
import { voiceStartFeedback, voiceStopFeedback } from "../../../platform/app/haptics";
import { getLibraryEntry } from "../../../platform/app/library";
import { hasNativeSpeech } from "../../../platform/app/platform";
import { TICK_MS } from "../../../platform/sync";
import { displayFileTitle } from "../shelf/file-title";
import { cn } from "../lib/utils";
import { OVERLAY_Z } from "../ui/overlay";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Lumen, LumenCase } from "./Lumen";
import { useHoldToggle } from "./use-hold-toggle";
import { useVoiceCall, voiceCallHandle } from "./use-voice-call";
import { getVoiceContext, subscribeVoiceContext, type VoiceContext } from "./voice-context";
import {
	bookIdsIn,
	badgeCount,
	caseLabel,
	columnMaxPx,
	EMPTY_LINE,
	isDismissSwipe,
	originLabel,
	showsCase,
	sortBoxCards,
} from "./box-cards";
import { useCaseMotion } from "./use-case-motion";
import { planJump, type Place, type Shell } from "./box-jump";

// What the body is announced as while it can talk: the two names are the two
// directions of the one gesture. On a screen with nothing to talk about it is
// not a control at all and has no name.
const HOLD_TO_TALK = "Hold to talk";
const HOLD_TO_END = "Hold to end the conversation";

/** What the shell can do about a card, in the shell's own terms. */
export interface LumenJumpTargets {
	/** Desktop only: the phone has no reader, so these are absent there. */
	openBook?: (bookId: string) => void | Promise<void>;
	goToPage?: (page: number) => void;
	openThread?: (bookId: string, threadId: string) => void;
	openAnnotation?: (annotationId: string) => void;
	goToDoor: (date: string) => void;
	goToBriefing: (date: string) => void;
}

export function LumenCorner({
	shell,
	shown,
	liftPx = 0,
	inReader = false,
	openBookId = null,
	targets,
}: {
	shell: Shell;
	/** The logo's switch, per device (corner-pref.ts). Hidden draws nothing. */
	shown: boolean;
	/**
	 * How far above the bottom edge to stand, for a screen whose own controls
	 * are on that edge — the full-window chat's composer (corner-placement.ts).
	 * The column rises from the corner, so lifting the corner lifts it too.
	 */
	liftPx?: number;
	inReader?: boolean;
	openBookId?: string | null;
	targets: LumenJumpTargets;
}) {
	const [open, setOpen] = useState(false);
	const [count, setCount] = useState(0);
	const [items, setItems] = useState<BoxItem[] | null>(null);
	const [titles, setTitles] = useState<Record<string, string>>({});
	const [note, setNote] = useState<string | null>(null);
	// The case's own life: pulled out when the count first rises, put back
	// when the box empties, and where it is drawn on every frame in between
	// (use-case-motion.ts).
	const box = useCaseMotion(count);

	// What a hold would talk about, as whichever screen holds it publishes it.
	const [context, setContext] = useState<VoiceContext | null>(getVoiceContext);
	useEffect(() => subscribeVoiceContext(() => setContext(getVoiceContext())), []);

	// Built unconditionally and held for the life of the shell. A call that
	// belonged to the screen would die the moment the reader walked away from
	// it, and there would be no way to hang up from where they landed.
	const call = useVoiceCall({
		dateKey: context?.dateKey ?? "",
		briefing: context?.briefing ?? null,
		control: context?.control,
	});
	const live = call.phase !== "idle";
	// A host that cannot speak has nothing to hold for — the whole audio path is
	// the iOS plugin's (docs/33) — and neither has a screen with nothing to talk
	// about, unless the call the hold would end is already up.
	const canTalk = hasNativeSpeech() && (live || context !== null);
	const { start, stop } = call;

	const toggle = useCallback(() => {
		if (live) {
			stop();
			void voiceStopFeedback();
			return;
		}
		// Read at the moment of the press, not at the render the press began in.
		if (!getVoiceContext()) return;
		start();
		void voiceStartFeedback();
	}, [live, start, stop]);

	const hold = useHoldToggle(canTalk, toggle);

	// The number on the badge. Both readings land here: the store's announcement
	// of a write this process made, and the tick that catches the other device's.
	useEffect(() => {
		let alive = true;
		const read = () => {
			void appBox()
				.openCount(UNSEEN)
				.then((n) => {
					if (!alive) return;
					setCount(n);
					// The last card followed or pressed away takes the column with
					// it: the case is about to be put away, and a column hanging off
					// a case on its way out reads as a tear.
					if (!showsCase(n)) setOpen(false);
				})
				.catch(() => {});
		};
		read();
		const timer = window.setInterval(read, TICK_MS);
		const stop = appBox().subscribe(read);
		return () => {
			alive = false;
			window.clearInterval(timer);
			stop();
		};
	}, []);

	// The column is read when it opens, not held between openings: an item the
	// other device moved on is one nobody wants to see a stale copy of.
	const load = useCallback(() => {
		void appBox()
			.open(UNSEEN)
			.then(async (open) => {
				setItems(sortBoxCards(open));
				const names: Record<string, string> = {};
				for (const bookId of bookIdsIn(open)) {
					const entry = await getLibraryEntry(bookId).catch(() => null);
					// The shelf's own name for it, and the file name cleaned up where the
					// entry never got one (the same fallback the shelf draws).
					if (entry) names[bookId] = entry.title || displayFileTitle(entry.originalFilename);
				}
				setTitles(names);
			})
			.catch(() => setItems([]));
	}, []);

	useEffect(() => {
		if (!open) return;
		setNote(null);
		load();
	}, [open, load]);

	const place = useMemo<Place>(
		() => ({ shell, inReader, openBookId }),
		[shell, inReader, openBookId],
	);

	// Awaited step by step, not fired off together: opening a book is the one
	// step with a wait in it, and the page and the thread after it are both
	// inside the book being opened.
	const follow = useCallback(
		async (item: BoxItem) => {
			const jump = planJump(item.origin, place);
			if (jump.unreachable) {
				setNote(jump.unreachable);
				return;
			}
			for (const step of jump.steps) {
				switch (step.step) {
					case "open-book":
						await targets.openBook?.(step.bookId);
						break;
					case "go-to-page":
						targets.goToPage?.(step.page);
						break;
					case "open-thread":
						targets.openThread?.(step.bookId, step.threadId);
						break;
					case "open-annotation":
						targets.openAnnotation?.(step.annotationId);
						break;
					case "go-to-door":
						targets.goToDoor(step.date);
						break;
					case "go-to-briefing":
						targets.goToBriefing(step.date);
						break;
				}
			}
			void appBox().setState(item.id, "told");
			setOpen(false);
		},
		[place, targets],
	);

	const onFollow = useCallback(
		(item: BoxItem) => {
			void follow(item);
		},
		[follow],
	);

	const dismiss = useCallback((item: BoxItem) => {
		setItems((current) => current?.filter((one) => one.id !== item.id) ?? current);
		void appBox().setState(item.id, "dismissed");
	}, []);

	if (!shown) return null;

	return (
		<div
			className={cn(
				"pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-end pb-safe-6 pr-safe-4",
				OVERLAY_Z.floating,
			)}
			// Margin and not padding: the padding above is the corner's own margin
			// from the edge, and a screen that wants it higher is saying where the
			// edge is for it, not how much air the body keeps.
			style={liftPx ? { marginBottom: `${liftPx}px` } : undefined}
		>
			<Popover open={open} onOpenChange={setOpen}>
				{/* The body's own box, with the case hanging off its left edge.
				    Nothing here clips: the corner's footprint is wider than the
				    body now, and the layer it sits in is the screen.

				    It is also what the column is measured from. The case is the
				    button, but the column rises from the corner (docs/68), and
				    anchoring it to the case alone would set it in from the margin
				    the corner keeps by the width of the body. */}
				<PopoverAnchor asChild>
					{/* `isolate`: the case comes out from behind the body, and a
					    negative layer only means "under the body" inside a stacking
					    context of its own — without one it would go under the page
					    the corner floats over. */}
					<div className="relative isolate">
						<Lumen
							ref={hold.ref}
							handle={voiceCallHandle(call)}
							attention={call.attention}
							// Beside an open book nothing moves but the case and the
							// hands on it (docs/68).
							still={inReader}
							reach={box.reach}
							reaching={box.moving}
							// A control only where a hold means something. Everywhere
							// else it keeps what it was: no pointer events, off the tab
							// order and out of the accessibility tree, a picture that
							// happens to be drawn on a button.
							label={canTalk ? (live ? HOLD_TO_END : HOLD_TO_TALK) : "Lumen"}
							aria-hidden={canTalk ? undefined : true}
							tabIndex={canTalk ? undefined : -1}
							role={canTalk ? undefined : "presentation"}
							// A tap is still wired to nothing: Lumen is not a button,
							// the props it brings are (docs/68).
							onActivate={NOTHING}
							// `touch-none`, `select-none` and the callout off: a hold on
							// iOS otherwise raises the system callout and starts a
							// selection over the body (docs/pitfall/49, 262).
							className={cn(
								"h-18 w-18",
								canTalk &&
									"pointer-events-auto touch-none select-none [-webkit-touch-callout:none]",
							)}
							{...hold.handlers}
						/>
						{box.drawn && (
							<PopoverTrigger asChild>
								<button
									ref={box.caseRef}
									type="button"
									aria-label={caseLabel(count)}
									// A case in Lumen's hands is not a button: no press, no
									// tab stop and nothing announced until it is standing in
									// its place.
									aria-hidden={box.atRest ? undefined : true}
									tabIndex={box.atRest ? undefined : -1}
									// `box-content`: the style's padding is the 44px
									// touch target and it grows outwards, so the case
									// draws at its own size (case-box.ts).
									className={cn(
										"absolute box-content block",
										box.atRest ? "pointer-events-auto" : "pointer-events-none",
									)}
									// The pose at the last render. The loop owns the
									// element's style between renders, and every render it
									// does make lands on the same numbers.
									style={box.style}
								>
									<span className="relative block h-full w-full">
										<LumenCase />
										{/* The number rides the case, it does not travel
										    with it: it appears once the case is down. */}
										{box.atRest && <CountBadge count={count} />}
									</span>
								</button>
							</PopoverTrigger>
						)}
					</div>
				</PopoverAnchor>
				<PopoverContent side="top" className="pointer-events-auto w-[19rem]">
					<Column
						items={items}
						titles={titles}
						note={note}
						onFollow={onFollow}
						onDismiss={dismiss}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}

// Nothing, named so the corner says out loud that the body's press is wired to
// nothing rather than looking like an oversight.
const NOTHING = () => {};

// The count, straddling the case's outer top corner (docs/68). On the case and
// not on the body: the number is how many are in the box, and the box is the
// thing standing there. Centred on the corner, so it never reaches the latch.
//
// The outer corner and not the inner one. The case leans in over the body's
// lower left and its top edge comes up to the eyes, so a badge on the inside
// corner sits on Lumen's face; on the outside it has the corner of the screen
// to itself.
function CountBadge({ count }: { count: number }) {
	const shown = badgeCount(count);
	if (shown === null) return null;
	return (
		<span className="pointer-events-none absolute -left-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-line px-1 text-[10px] font-semibold leading-none text-background ring-2 ring-background">
			{shown}
		</span>
	);
}

// The column. Five cards of room and a scroll under them.
function Column({
	items,
	titles,
	note,
	onFollow,
	onDismiss,
}: {
	items: BoxItem[] | null;
	titles: Record<string, string>;
	note: string | null;
	onFollow: (item: BoxItem) => void;
	onDismiss: (item: BoxItem) => void;
}) {
	if (items !== null && items.length === 0) {
		return <p className="m-0 px-2 py-3 text-[13px] text-muted-foreground">{EMPTY_LINE}</p>;
	}
	return (
		<>
			<div
				className="flex flex-col gap-2 overflow-y-auto"
				style={{ maxHeight: `${columnMaxPx()}px` }}
			>
				{(items ?? []).map((item) => (
					<Card
						key={item.id}
						item={item}
						title={item.origin.place === "book" ? (titles[item.origin.bookId] ?? null) : null}
						onFollow={() => onFollow(item)}
						onDismiss={() => onDismiss(item)}
					/>
				))}
			</div>
			{note && <p className="m-0 px-2 pt-2 text-[12px] text-muted-foreground">{note}</p>}
		</>
	);
}

// One card. A press follows it; a horizontal drag on a finger presses it away,
// and where there is a pointer instead of a finger the same thing is a control
// that only appears under the cursor.
function Card({
	item,
	title,
	onFollow,
	onDismiss,
}: {
	item: BoxItem;
	title: string | null;
	onFollow: () => void;
	onDismiss: () => void;
}) {
	const from = useRef<{ x: number; y: number; touch: boolean } | null>(null);
	const [swiped, setSwiped] = useState(false);

	return (
		<div
			className="group relative"
			onPointerDown={(event) => {
				from.current = {
					x: event.clientX,
					y: event.clientY,
					touch: event.pointerType !== "mouse",
				};
				setSwiped(false);
			}}
			onPointerUp={(event) => {
				const start = from.current;
				from.current = null;
				if (!start || !start.touch) return;
				if (isDismissSwipe(event.clientX - start.x, event.clientY - start.y)) {
					setSwiped(true);
					onDismiss();
				}
			}}
		>
			<button
				type="button"
				className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border-soft bg-card px-3 py-2 text-left can-hover:hover:bg-muted coarse:min-h-[44px]"
				onClick={() => {
					if (!swiped) onFollow();
				}}
			>
				<span className="flex w-full items-start gap-1.5">
					{/* "要你定": the one mark a card carries. */}
					{item.needsDecision && (
						<span
							aria-label="Needs a decision"
							className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-accent-line"
						/>
					)}
					<span className="line-clamp-2 text-[13px] leading-snug text-foreground">
						{item.cover}
					</span>
				</span>
				<span className="text-[11px] text-muted-foreground">
					{originLabel(item.origin, title)}
				</span>
			</button>
			{/* The finger swipes; the cursor gets a target, because there is no
			    swipe on a mouse and a card with no way out on the desktop would be
			    a card that only accumulates. */}
			<button
				type="button"
				aria-label="Dismiss"
				className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-md text-[13px] leading-none text-muted-foreground can-hover:group-hover:flex can-hover:hover:bg-muted"
				onClick={onDismiss}
			>
				×
			</button>
		</div>
	);
}
