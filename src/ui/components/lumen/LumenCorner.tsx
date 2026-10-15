// Lumen in the corner of every place, and the way into his conversation
// (docs/68).
//
// Rendering and event binding only. What a press means is lumen-press.ts, which
// box items the conversation draws and where is box-timeline.ts, the count is
// box-cards.ts, and where a card jumps to is box-jump.ts.
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
// The corner is only a way in (2026-10-15). A tap on Lumen or on the case opens
// his conversation, the day's conversation at the door (DoorChat.tsx): the
// whole screen on the phone, with Lumen standing down, and a panel standing on
// Lumen everywhere else, which its expand button fills the shell with. What is
// in the box is drawn there as cards among the day's rows. A hold on Lumen
// talks to him — the info voice session — and during a call the same hold ends
// it; where there is no call to have, the hold does not charge and a long press
// is a tap. The desktop's right-click is the hold.
//
// The body is also the handle it is dragged by (corner-drag.ts). One press
// feeds both machines and the first one to claim it wins: past the slop it is a
// drag, and the hold is cancelled on that same move, so a press that travels
// never opens a call and a press that stays never moves the corner. Dragged to
// the left edge the whole corner is mirrored — the case to the body's right,
// the badge on its outer corner, the panel standing on the left — which is one
// transform on the box the two stand in rather than a second composition.
//
// The session is the info screen's. What it would be about is published by
// whichever screen holds it (voice-context.ts) and the call is built here, so
// it outlives the screen it was opened from and can be hung up from anywhere.
//
// A call that never got going says so. The hold charges and buzzes before
// anything is known about the microphone, and iOS can refuse it outright, so a
// failure with nothing on screen is a hold that swallowed the gesture. The one
// line stacks over the body the way the briefing's layer drew it (ErrorLine),
// and takes no presses: the way back is another hold, on the body behind it.

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent,
	type PointerEvent,
} from "react";

import { appBox } from "../../../box";
import type { BoxItem } from "../../../box/types";
import { useT } from "../../../i18n";
import { voiceStartFeedback, voiceStopFeedback } from "../../../platform/app/haptics";
import { hasNativeSpeech } from "../../../platform/app/platform";
import { cn } from "../lib/utils";
import { orbErrorLine } from "../orb/orb";
import { OVERLAY_Z, useBottomSheetOpen } from "../ui/overlay";
import { useShellKeyboard } from "../common/useKeyboardInset";
import { panelOnKeyboard } from "./door-panel";
import { ErrorLine } from "./ErrorLine";
import { Lumen, LumenCase } from "./Lumen";
import { DoorChat, type DoorBox } from "./DoorChat";
import { PRESS_REST, lumenPressStep, startsHold, type LumenPressEffect, type LumenPressInput } from "./lumen-press";
import { useHoldToggle } from "./use-hold-toggle";
import { useVoiceCall, voiceCallHandle } from "./use-voice-call";
import { getVoiceContext, subscribeVoiceContext, type VoiceContext } from "./voice-context";
import { badgeCount, caseLabel } from "./box-cards";
import { useBoxItems } from "./use-box-items";
import { useCaseMotion } from "./use-case-motion";
import { useCornerDrag } from "./use-corner-drag";
import { doorFocusKey, planItemJump, stateAfterFollow, staysUntilDecided, type DoorFocus, type Place, type Shell } from "./box-jump";
import type { IntakeOpenDocument } from "./intake-view";

// What the body is announced as during a call: the hold that ends it.
const HOLD_TO_END = "Hold to end the conversation";

/** What the shell can do about a card, in the shell's own terms. */
export interface LumenJumpTargets {
	/** Desktop only: the phone opens a book's conversation in one step (openBookConversation). */
	openBook?: (bookId: string) => void | Promise<void>;
	goToPage?: (page: number) => void;
	openThread?: (bookId: string, threadId: string) => void;
	openAnnotation?: (annotationId: string) => void;
	goToBriefing: (date: string) => void;
	goToMeals: () => void;
	/** Phone only: a book's conversation, in the lesson or over the page. */
	openBookConversation?: (bookId: string, threadId: string) => void | Promise<void>;
	/** Desktop only: a talk's coaching and a retell, in their topic. */
	openCoach?: (outlineId: string) => void | Promise<void>;
	openRetell?: (retellId: string) => void | Promise<void>;
	/** A document an intake card filed (its 「打开阅读」), opened in this shell's reader. */
	openDocument?: (doc: IntakeOpenDocument) => void | Promise<void>;
}

/** The door conversation, when it is up: today's, or the day and card a box card went back to. */
interface DoorOpen {
	date?: string;
	focus?: DoorFocus;
}

export function LumenCorner({
	shell,
	shown,
	liftPx = 0,
	inReader = false,
	stoodDown = false,
	openBookId = null,
	targets,
}: {
	shell: Shell;
	/** The logo's switch, per device (corner-pref.ts). Hidden draws nothing. */
	shown: boolean;
	/**
	 * How far above the bottom edge to stand, for a screen whose own controls
	 * are on that edge — the full-window chat's composer (corner-placement.ts).
	 * The panel stands on the corner, so lifting the corner lifts it too.
	 */
	liftPx?: number;
	/**
	 * A screen that wants the corner out of the way for as long as it is up:
	 * the phone's lesson, whose replies are read and held right where the
	 * lifted corner would stand (docs/74). Same treatment as an open sheet,
	 * invisible and not unmounted, so nothing replays.
	 */
	stoodDown?: boolean;
	inReader?: boolean;
	openBookId?: string | null;
	targets: LumenJumpTargets;
}) {
	// Which edge the corner is docked at and how high, from this device's own
	// slot; `liftPx` is the composer's claim on the bottom edge and only wins
	// where the reader has not carried the corner above it.
	const drag = useCornerDrag(liftPx);
	// A sheet comes up across that same edge, and this corner paints over it
	// (base/bottom-sheet.ts). It stands down while one is up.
	const sheet = useBottomSheetOpen();
	const shellKeyboard = useShellKeyboard();
	const mirrored = drag.side === "left";

	// What is in the box for this device, read continuously: the badge counts
	// it and the conversation draws it.
	const box = useBoxItems();
	const count = box.items.length;
	const [note, setNote] = useState<string | null>(null);
	// The case's own life: pulled out when the count first rises, put back
	// when the box empties, and where it is drawn on every frame in between
	// (use-case-motion.ts).
	const motion = useCaseMotion(count);

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
	// about, unless the call the hold would end is already up. There the body
	// does not charge, and a long press is a press.
	const canTalk = hasNativeSpeech() && (live || context !== null);
	const handle = voiceCallHandle(call);
	const t = useT();
	const [door, setDoor] = useState<DoorOpen | null>(null);
	const [full, setFull] = useState(false);
	// Only where the body is a voice control: everywhere else there is no call
	// of theirs to have broken, and a sentence in the corner of a book would be
	// about nothing they did.
	const errorLine = canTalk ? orbErrorLine(handle.error) : null;
	const { start, stop } = call;

	const liveRef = useRef(live);
	liveRef.current = live;

	const openDoor = useCallback(() => {
		setNote(null);
		setDoor((open) => open ?? {});
	}, []);
	const closeDoor = useCallback(() => {
		setDoor(null);
		setFull(false);
		setNote(null);
	}, []);

	// What a press decided. Read at the moment it lands, not at the render the
	// press began in.
	const act = useCallback(
		(effect: LumenPressEffect) => {
			if (effect === "hang-up") {
				stop();
				void voiceStopFeedback();
			} else if (effect === "voice") {
				if (!getVoiceContext()) return;
				start();
				void voiceStartFeedback();
			} else if (effect === "open-door") openDoor();
		},
		[start, stop, openDoor],
	);
	// The press's state, stepped synchronously: a late fire and the release
	// that follows it arrive in one event.
	const pressState = useRef(PRESS_REST);
	const press = useCallback(
		(input: LumenPressInput) => {
			const step = lumenPressStep(pressState.current, input);
			pressState.current = step.state;
			act(step.effect);
		},
		[act],
	);
	const pressContext = useCallback(
		() => ({ live: liveRef.current, canVoice: hasNativeSpeech() && getVoiceContext() !== null }),
		[],
	);

	const fire = useCallback(() => press({ kind: "fired", ...pressContext() }), [press, pressContext]);
	const hold = useHoldToggle(canTalk, fire);

	// One press and two machines to feed. The drag answers first: the move that
	// carries the press past the slop is the move the hold is told to let go on,
	// so a press ends as a drag or as a hold and never as both, and a press that
	// never travels is the hold, or the tap, it always was.
	const handlers = {
		onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
			if (!startsHold(event.pointerType, event.button)) return;
			press({ kind: "down" });
			drag.onPointerDown(event);
			hold.handlers.onPointerDown(event);
		},
		onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
			if (drag.onPointerMove(event)) {
				hold.handlers.onPointerCancel(event);
				press({ kind: "dragged" });
			} else hold.handlers.onPointerMove(event);
		},
		onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
			drag.onPointerUp(event);
			// A release past full charge that no frame saw fires here, before the
			// press hears the release.
			hold.handlers.onPointerUp(event);
			press({ kind: "up" });
		},
		onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
			drag.onPointerCancel(event);
			hold.handlers.onPointerCancel(event);
			press({ kind: "cancel" });
		},
		onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
			hold.handlers.onContextMenu(event);
			press({ kind: "context", ...pressContext() });
		},
	};

	const place = useMemo<Place>(
		() => ({ shell, inReader, openBookId }),
		[shell, inReader, openBookId],
	);

	// Awaited step by step, not fired off together: opening a book is the one
	// step with a wait in it, and the page and the thread after it are both
	// inside the book being opened. A card that goes back to a door
	// conversation reopens the conversation at that day and row; any other
	// takes the conversation down, since what it goes to is under it.
	const follow = useCallback(
		async (item: BoxItem) => {
			const jump = planItemJump(item, place);
			if (jump.unreachable) {
				setNote(jump.unreachable);
				return;
			}
			setNote(null);
			if (!jump.steps.some((step) => step.step === "open-door-chat")) closeDoor();
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
					case "go-to-briefing":
						targets.goToBriefing(step.date);
						break;
					case "go-to-meals":
						targets.goToMeals();
						break;
					case "open-book-conversation":
						await targets.openBookConversation?.(step.bookId, step.threadId);
						break;
					case "open-coach":
						await targets.openCoach?.(step.outlineId);
						break;
					case "open-retell":
						await targets.openRetell?.(step.retellId);
						break;
					case "open-door-chat":
						setDoor({ date: step.date, ...(step.focus ? { focus: step.focus } : {}) });
						break;
				}
			}
			const next = stateAfterFollow(item);
			if (next) void appBox().setState(item.id, next);
		},
		[place, targets, closeDoor],
	);

	const dismiss = useCallback((item: BoxItem) => {
		if (staysUntilDecided(item)) return;
		void appBox().setState(item.id, "dismissed");
	}, []);

	const doorBox = useMemo<DoorBox>(
		() => ({
			items: box.items,
			titles: box.titles,
			onFollow: (item) => void follow(item),
			onDismiss: dismiss,
			note,
		}),
		[box, follow, dismiss, note],
	);

	const openDocument = useCallback(
		(doc: IntakeOpenDocument) => {
			closeDoor();
			void targets.openDocument?.(doc);
		},
		[targets, closeDoor],
	);

	if (!shown) return null;

	const asSheet = shell === "phone";
	// The panel stands on the keyboard while one is up, over where Lumen would be
	// (door-panel.ts), and filled it stands over the whole shell; Lumen stands
	// down under it either way.
	const underPanel = !asSheet && door !== null && (full || panelOnKeyboard(shellKeyboard));
	return (
		<>
		{door && (
			<DoorChat
				key={`${door.date ?? "today"}:${doorFocusKey(door.focus)}`}
				form={asSheet ? "sheet" : "panel"}
				{...(asSheet ? {} : { liftPx: drag.bottomPx, mirrored, full, onToggleFull: () => setFull((f) => !f) })}
				{...(door.date ? { date: door.date } : {})}
				{...(door.focus ? { focus: door.focus } : {})}
				box={doorBox}
				onOpenDocument={openDocument}
				onClose={closeDoor}
			/>
		)}
		<div
			ref={drag.frameRef}
			className={cn(
				"pointer-events-none fixed inset-x-0 bottom-0 flex flex-col gap-2 pb-safe-6",
				mirrored ? "items-start pl-safe-4" : "items-end pr-safe-4",
				// `invisible` and not unmounted: the case's animation is state in the
				// tree, and a sheet opened and closed would replay the whole pull-out.
				// Nothing hidden this way takes a press either.
				(sheet || stoodDown || underPanel) && "invisible",
				OVERLAY_Z.floating,
			)}
			// Margin and not padding: the padding above is the corner's own margin
			// from the edge, and a screen that wants it higher is saying where the
			// edge is for it, not how much air the body keeps.
			//
			// This is also the box a drag moves, by a transform written straight
			// onto it — which is why the drag never touches this style.
			style={drag.bottomPx ? { marginBottom: `${drag.bottomPx}px` } : undefined}
		>
			{errorLine && <ErrorLine line={errorLine} />}
			{/* The body's own box, with the case hanging off its left edge.
			    Nothing here clips: the corner's footprint is wider than the body
			    now, and the layer it sits in is the screen.

			    `isolate`: the case comes out from behind the body, and a negative
			    layer only means "under the body" inside a stacking context of its
			    own — without one it would go under the page the corner floats
			    over. */}
			<div
				className="relative isolate"
				// Docked at the left edge the corner is the same composition seen in
				// a mirror: the case comes out on the body's right, away from the
				// screen edge, and the eyes and the lean that follow it
				// (case-motion.ts) go with it for nothing. The count is the one
				// thing that must not read backwards, so it turns itself back over.
				style={mirrored ? { transform: "scaleX(-1)" } : undefined}
			>
				<Lumen
					ref={hold.ref}
					handle={handle}
					attention={call.attention}
					// Beside an open book nothing moves but the case and the hands on
					// it (docs/68).
					still={inReader}
					reach={motion.reach}
					reaching={motion.moving}
					label={live ? HOLD_TO_END : t("shell.lumen.tapToChat")}
					aria-haspopup={live ? undefined : "dialog"}
					aria-expanded={live ? undefined : door !== null}
					// The tap. A keyboard's Enter lands here too, with no press
					// before it; a press that was a drag or a hold swallows the
					// click its release brings (lumen-press.ts).
					onActivate={() => press({ kind: "click" })}
					// Which way round the body is drawn, so the eyes still follow
					// the real pointer through the mirror.
					mirrored={mirrored}
					// `touch-none`, `select-none` and the callout off: a hold on iOS
					// otherwise raises the system callout and starts a selection over
					// the body (docs/pitfall/49, 262). Unconditional — the body takes
					// a press everywhere, because everywhere it can be dragged.
					className="h-18 w-18 pointer-events-auto touch-none select-none [-webkit-touch-callout:none]"
					{...handlers}
				/>
				{motion.drawn && (
					<button
						ref={motion.caseRef}
						type="button"
						aria-label={caseLabel(count)}
						aria-haspopup="dialog"
						// A case in Lumen's hands is not a button: no press, no tab stop
						// and nothing announced until it is standing in its place.
						aria-hidden={motion.atRest ? undefined : true}
						tabIndex={motion.atRest ? undefined : -1}
						// `box-content`: the style's padding is the 44px touch target
						// and it grows outwards, so the case draws at its own size
						// (case-box.ts).
						className={cn(
							"absolute box-content block",
							motion.atRest ? "pointer-events-auto" : "pointer-events-none",
						)}
						// The pose at the last render. The loop owns the element's
						// style between renders, and every render it does make lands on
						// the same numbers.
						style={motion.style}
						// The same as a tap on Lumen: his conversation, with the box in it.
						onClick={openDoor}
					>
						<span className="relative block h-full w-full">
							<LumenCase />
							{/* The number rides the case, it does not travel with it: it
							    appears once the case is down. */}
							{motion.atRest && <CountBadge count={count} mirrored={mirrored} />}
						</span>
					</button>
				)}
			</div>
		</div>
		</>
	);
}

// The count, straddling the case's outer top corner (docs/68). On the case and
// not on the body: the number is how many are in the box, and the box is the
// thing standing there. Centred on the corner, so it never reaches the latch.
//
// The outer corner and not the inner one. The case leans in over the body's
// lower left and its top edge comes up to the eyes, so a badge on the inside
// corner sits on Lumen's face; on the outside it has the corner of the screen
// to itself.
function CountBadge({ count, mirrored }: { count: number; mirrored: boolean }) {
	const shown = badgeCount(count);
	if (shown === null) return null;
	return (
		<span
			className={cn(
				"pointer-events-none absolute -left-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-line px-1 text-[10px] font-semibold leading-none text-background ring-2 ring-background",
				// The corner's mirror carries the badge to the case's other outer
				// corner, which is the rule; the digits are turned back over here.
				mirrored && "[transform:scaleX(-1)]",
			)}
		>
			{shown}
		</span>
	);
}

