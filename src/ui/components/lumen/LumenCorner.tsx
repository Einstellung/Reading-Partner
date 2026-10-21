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
// (case-motion.ts). The eyes and the lean go with it, in the reader too. A live
// voice call is the exception: the reader is talking to him, so his face moves
// with the call beside a book as it does everywhere else.
//
// The corner is only a way in (2026-10-15). A tap on Lumen or on the case opens
// his conversation, the day's conversation at the door (DoorChat.tsx): the
// whole screen on the phone, with Lumen standing down, and a panel standing on
// Lumen everywhere else, which its expand button fills the shell with. What is
// in the box is drawn there as cards among the day's rows.
//
// Voice chat (2026-10-20) starts from the waveform button beside the door's
// composer and is hands-free: the conversation goes away and the reader talks
// to Lumen here, whose brows, eyes and mouth follow the call. While it is up a
// small X hangs on the body's corner away from the case, and one tap on it ends
// the call. A tap on the body or the case opens the conversation without ending
// it; there the composer is the call's state and its End button. A card that
// wants a tap arriving mid-call brings the conversation up on its own.
//
// The body is also the handle it is dragged by (corner-drag.ts). One press
// feeds both: past the slop it is a drag and opens nothing, and a press that
// never travels is the tap (lumen-press.ts). Dragged to the left edge the whole
// corner is mirrored — the case to the body's right, the badge on its outer
// corner, the hang-up on the body's other corner, the panel standing on the
// left — which is one transform on the box they stand in rather than a second
// composition.
//
// The call is built here, so it outlives the screen it was opened from and the
// conversation it was started in, and can be hung up from anywhere. Where it is
// held is read when it starts: on the briefing where that page has published
// its day (voice-context.ts), at the door everywhere else.
//
// A call that never got going says so. iOS can refuse the microphone outright,
// so a failure with nothing on screen is a tap that swallowed the gesture. The
// one line stacks over the body the way the briefing's layer drew it
// (ErrorLine), and takes no presses.

import { CallResultCard } from "./CallResultCard";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type PointerEvent,
} from "react";

import { appBox } from "../../../box";
import { markIssueTold } from "../../../info/issue/box-state";
import type { BoxItem } from "../../../box/types";
import { useT } from "../../../i18n";
import { voiceStartFeedback, voiceStopFeedback } from "../../../platform/app/haptics";
import { hasNativeSpeech } from "../../../platform/app/platform";
import { subscribeVoiceCapability } from "../../../platform/app/voice-capability";
import { cn } from "../lib/utils";
import { orbErrorLine } from "../orb/orb";
import { OVERLAY_Z, useBottomSheetOpen } from "../ui/overlay";
import { useShellKeyboard } from "../common/useKeyboardInset";
import { panelOnKeyboard } from "./door-panel";
import { ErrorLine } from "./ErrorLine";
import { Lumen, LumenCase } from "./Lumen";
import { DoorChat, type DoorBox } from "./DoorChat";
import { PRESS_REST, lumenPressStep, startsPress, type LumenPressInput } from "./lumen-press";
import { useVoiceCall, voiceCallHandle } from "./use-voice-call";
import { getVoiceContext, subscribeVoiceContext, type VoiceContext } from "./voice-context";
import { badgeCount, caseLabel } from "./box-cards";
import { useBoxItems } from "./use-box-items";
import { useCompanionName } from "../base/use-companion-name";
import { arrivedItem, carriesCard, voiceEntry } from "./door-voice";
import { onThreadMessage } from "../../../platform/app/threads";
import { doorDate, doorKey } from "../../../soul";
import { IconEnd } from "../base/icons";
import { Button } from "../ui/button";
import { useCaseMotion } from "./use-case-motion";
import { useCornerDrag } from "./use-corner-drag";
import { doorFocusKey, planItemJump, stateAfterFollow, staysUntilDecided, type DoorFocus, type Place, type Shell } from "./box-jump";
import type { IntakeOpenDocument } from "./intake-view";
import { getOpenIssue, opensDoor, subscribeAskLumen, subscribeOpenIssue, type IssueQuote } from "./issue-context";

/** What the shell can do about a card, in the shell's own terms. */
export interface LumenJumpTargets {
	/** Open a book in the reader. The phone has it only for a brief; a book's conversation opens in one step there (openBookConversation). */
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
	/** The brief whose opening brought it up (issue-context.ts). */
	issue?: string;
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

	// What a call would talk about, as whichever screen holds it publishes it.
	const [context, setContext] = useState<VoiceContext | null>(getVoiceContext);
	useEffect(() => subscribeVoiceContext(() => setContext(getVoiceContext())), []);

	// Built unconditionally and held for the life of the shell. A call that
	// belonged to the screen would die the moment the reader walked away from
	// it, and there would be no way to hang up from where they landed.
	// Where the call is held is read when it starts: the briefing where that
	// page is up, the door everywhere else (voice-call-mode.ts).
	const call = useVoiceCall({ context, inReader });
	const live = call.phase !== "idle";
	// A host that cannot speak has no call to have — the whole audio path is
	// native (docs/33). There the door's voice button is grey. Read through the
	// capability store: on Android the answer lands after first paint, and the
	// entry has to come out with it (docs/companion/89).
	const speaks = useSyncExternalStore(subscribeVoiceCapability, hasNativeSpeech);
	const entry = voiceEntry(speaks);
	const handle = voiceCallHandle(call);
	const t = useT();
	const companionName = useCompanionName();
	const [door, setDoor] = useState<DoorOpen | null>(null);
	const [full, setFull] = useState(false);
	// Only where the host can call: elsewhere there is no call of theirs to have
	// broken, and a sentence in the corner would be about nothing they did.
	const errorLine = speaks ? orbErrorLine(handle.error) : null;
	const { start, stop } = call;

	const liveRef = useRef(live);
	liveRef.current = live;

	// A brief opened in the reader brings the conversation up with it, whether
	// or not Lumen is shown (docs/info/88 「简报的对话」); the same brief
	// published again does not. An Ask on a passage in it brings today's
	// conversation up with the passage above the composer.
	const [quote, setQuote] = useState<IssueQuote | null>(null);
	const shownForRef = useRef<string | null>(null);
	useEffect(() => {
		const opened = () => {
			const issue = getOpenIssue();
			if (opensDoor(shownForRef.current, issue)) {
				shownForRef.current = issue!.bookId;
				// Opened from anywhere: the box has told the reader of this issue.
				void markIssueTold(appBox(), issue!.bookId).catch((e: unknown) =>
					console.warn("the issue's box item could not be marked told", e),
				);
				setNote(null);
				setFull(false);
				setDoor({ issue: issue!.bookId });
			} else if (!issue) {
				shownForRef.current = null;
				setQuote(null);
			}
		};
		opened();
		const offIssue = subscribeOpenIssue(opened);
		const offAsk = subscribeAskLumen((asked) => {
			setNote(null);
			setQuote(asked);
			setDoor((open) => (open && !open.date ? open : {}));
		});
		return () => {
			offIssue();
			offAsk();
		};
	}, []);

	const openDoor = useCallback(() => {
		setNote(null);
		setDoor((open) => open ?? {});
	}, []);
	const closeDoor = useCallback(() => {
		setDoor(null);
		setFull(false);
		setNote(null);
		setQuote(null);
	}, []);

	// Voice chat, from the door's button: the call starts and the conversation
	// goes away, so the reader talks to Lumen in the corner. Where the corner is
	// hidden there is no body to talk to, and the conversation stays up with
	// the call's End in it.
	const startVoice = useCallback(() => {
		start();
		void voiceStartFeedback();
		if (shown) closeDoor();
	}, [start, shown, closeDoor]);
	const endVoice = useCallback(() => {
		stop();
		void voiceStopFeedback();
	}, [stop]);

	// A card that wants the reader's tap, arriving while a call is up, brings the
	// conversation up on it; the call carries on. Two ways one arrives: a new
	// item in the box (drawn there as a card), or a card appended to today's
	// conversation (an intake's topic choice, a brief's questions).
	const seenRef = useRef<Set<string> | null>(null);
	useEffect(() => {
		const arrived = seenRef.current && live ? arrivedItem(seenRef.current, box.items) : null;
		seenRef.current = new Set(box.items.map((item) => item.id));
		if (arrived) openDoor();
	}, [box.items, live, openDoor]);
	useEffect(
		() =>
			onThreadMessage((append) => {
				if (liveRef.current && append.key === doorKey(doorDate()) && carriesCard(append.message)) openDoor();
			}),
		[openDoor],
	);

	// The press's state, stepped synchronously: the release and the click that
	// follows it arrive in one event.
	const pressState = useRef(PRESS_REST);
	const press = useCallback(
		(input: LumenPressInput) => {
			const step = lumenPressStep(pressState.current, input);
			pressState.current = step.state;
			if (step.effect === "open-door") openDoor();
		},
		[openDoor],
	);

	// One press and two readings of it: the drag answers first, and the move
	// that carries the press past the slop makes it a drag that opens nothing.
	const handlers = {
		onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
			if (!startsPress(event.pointerType, event.button)) return;
			press({ kind: "down" });
			drag.onPointerDown(event);
		},
		onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
			if (drag.onPointerMove(event)) press({ kind: "dragged" });
		},
		onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
			drag.onPointerUp(event);
			press({ kind: "up" });
		},
		onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
			drag.onPointerCancel(event);
			press({ kind: "cancel" });
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

	const asSheet = shell === "phone";
	const doorChat = door && (
		<DoorChat
			key={`${door.date ?? "today"}:${doorFocusKey(door.focus)}:${door.issue ?? ""}`}
			form={asSheet ? "sheet" : "panel"}
			{...(asSheet ? {} : { liftPx: drag.bottomPx, mirrored, full, onToggleFull: () => setFull((f) => !f) })}
			{...(door.date ? { date: door.date } : {})}
			{...(door.focus ? { focus: door.focus } : {})}
			{...(door.issue ? { openedFor: door.issue } : {})}
			quote={quote}
			onQuoteDone={() => setQuote(null)}
			box={doorBox}
			onOpenDocument={openDocument}
			voice={{ live, phase: call.phase, entry, onStart: startVoice, onEnd: endVoice }}
			onClose={closeDoor}
		/>
	);
	// Hidden is hidden: no body and no case, and no tool in their place. The
	// conversation still comes up for a brief (docs/68), on its own.
	if (!shown) return <>{doorChat}</>;

	// The panel stands on the keyboard while one is up, over where Lumen would be
	// (door-panel.ts), and filled it stands over the whole shell; Lumen stands
	// down under it either way.
	const underPanel = !asSheet && door !== null && (full || panelOnKeyboard(shellKeyboard));
	return (
		<>
		{doorChat}
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
			{call.card && <CallResultCard card={call.card} onClose={call.dismissCard} />}
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
					handle={handle}
					attention={call.attention}
					// Beside an open book nothing moves but the case and the hands on
					// it (docs/68), unless a call is up: then his face is the call.
					still={inReader && !live}
					reach={motion.reach}
					reaching={motion.moving}
					label={live ? t("shell.lumen.inCall", { name: companionName }) : t("shell.lumen.tapToChat", { name: companionName })}
					aria-haspopup="dialog"
					aria-expanded={door !== null}
					// The tap. A keyboard's Enter lands here too, with no press
					// before it; a press that was a drag swallows the click its
					// release brings (lumen-press.ts).
					onActivate={() => press({ kind: "click" })}
					// Which way round the body is drawn, so the eyes still follow
					// the real pointer through the mirror.
					mirrored={mirrored}
					// `touch-none`, `select-none` and the callout off: a long touch on
					// iOS otherwise raises the system callout and starts a selection
					// over the body (docs/pitfall/49, 262). Unconditional — the body
					// takes a press everywhere, because everywhere it can be dragged.
					className="h-18 w-18 pointer-events-auto touch-none select-none [-webkit-touch-callout:none]"
					{...handlers}
				/>
				{/* The hang-up, on the body's top corner away from the case (which
				    hangs off the left edge, its count on its own outer corner), so
				    the two never meet; the corner's mirror carries it to the other
				    side with the case. One tap ends the call. */}
				{live && (
					<Button
						type="button"
						variant="end"
						size="badge"
						aria-label={t("shell.lumen.hangUp")}
						title={t("shell.lumen.hangUp")}
						onClick={endVoice}
						className="pointer-events-auto absolute -right-1.5 -top-1.5 z-10 border-2 border-background"
					>
						<IconEnd size={14} />
					</Button>
				)}
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

