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
// the custom-property defaults paint is what stands there. The only thing that
// changes in the reader is the arrival pose — the parcel in its hands, on for as
// long as anything in the box is open.
//
// The count. `appBox()` caches nothing, so the number is read twice over: the
// store's own subscribe covers a write made in this process, and the sync tick
// covers an item that arrived from the other device.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { appBox } from "../../../box";
import type { BoxItem } from "../../../box/types";
import { getLibraryEntry } from "../../../platform/app/library";
import { TICK_MS } from "../../../platform/sync";
import { displayFileTitle } from "../shelf/file-title";
import { cn } from "../lib/utils";
import { OVERLAY_Z } from "../ui/overlay";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type { VoiceCallHandle } from "../orb/orb";
import { Lumen } from "./Lumen";
import {
	bookIdsIn,
	badgeCount,
	columnMaxPx,
	EMPTY_LINE,
	holdsBox,
	isDismissSwipe,
	originLabel,
	sortBoxCards,
} from "./box-cards";
import { planJump, type Place, type Shell } from "./box-jump";

// The corner is not a call. Lumen still wants a handle — it is the same body the
// voice entry draws — so it gets one that never speaks: phase `idle` for the
// whole life of the app, and two subscriptions nothing ever pushes to. The voice
// entry returns as the bottom item of this column later (docs/68).
const SILENT: VoiceCallHandle = {
	phase: "idle",
	start: () => {},
	stop: () => {},
	error: null,
	subscribeLevel: () => () => {},
	subscribeEnvelope: () => () => {},
};

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
	inReader = false,
	openBookId = null,
	targets,
}: {
	shell: Shell;
	/** The logo's switch, per device (corner-pref.ts). Hidden draws nothing. */
	shown: boolean;
	inReader?: boolean;
	openBookId?: string | null;
	targets: LumenJumpTargets;
}) {
	const [open, setOpen] = useState(false);
	const [count, setCount] = useState(0);
	const [items, setItems] = useState<BoxItem[] | null>(null);
	const [titles, setTitles] = useState<Record<string, string>>({});
	const [note, setNote] = useState<string | null>(null);

	// The number on the badge. Both readings land here: the store's announcement
	// of a write this process made, and the tick that catches the other device's.
	useEffect(() => {
		let alive = true;
		const read = () => {
			void appBox()
				.openCount()
				.then((n) => {
					if (alive) setCount(n);
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
			.open()
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
		>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Lumen
						handle={SILENT}
						// Beside an open book nothing moves but the pose (docs/68).
						still={inReader}
						holding={holdsBox(count)}
						label="Lumen"
						// The press belongs to the trigger: Radix hands its own
						// onClick down through asChild, and it is spread onto the
						// button after this component's own handler.
						className="pointer-events-auto h-18 w-18"
						overlay={<CountBadge count={count} />}
					/>
				</PopoverTrigger>
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

// The count, at the top right of the body. Outside the body group on purpose:
// it is not part of the character, and the pose that holds the box does not
// carry the number (docs/68).
function CountBadge({ count }: { count: number }) {
	const shown = badgeCount(count);
	if (shown === null) return null;
	return (
		<span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-line px-1 text-[11px] font-semibold leading-none text-background ring-2 ring-background">
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
