// Shared chat pieces for the call UI (CallBubble, CallView). Tailwind-only.
//
// The `lg` size sets its type and the space around it off `--chat-scale`, read
// as a variable with a default so nothing here imports the zoom; `sm` is the
// corner bubble and does not zoom. The scaled values are unitless or an
// expression: a rem line height or gap is measured against the root font size
// and would sit still while the type grew.

import {
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type RefObject,
} from 'react';
import { HIT_44 } from '../base/buttons';
import { Button } from '../ui/button';
import { IconCheck, IconCopy, IconKeyboard, IconMic, IconSend, IconStop } from '../base/icons';
import { Markdown } from '../markdown/Markdown';
import { MicButton } from './MicButton';
import { HoldToTalk } from './HoldToTalk';
import { useFlickerProbe } from '../common/useFlickerProbe';
import { scrollMemory } from '../common/scroll-memory';
import { stickToBottom } from '../common/stick-to-bottom';
import type { PendingImage, ThreadMessage } from './types';
import type { CompressedImage } from '../../../ai/image-utils';
import type { ToolStatus } from '../../../ai/tool-status';
import {
	createStrokeGate,
	locateChatMarks,
	mayMarkReply,
	type ChatMarkDraw,
} from '../../../reading/chat-marks';
import type { Annotation, MarkPen } from '../../../platform/app/reader-contract';
import {
	boxesHold,
	indexRendered,
	markFill,
	offsetOf,
	paintBoxes,
	rangeOfSpan,
	toBoxes,
	type MarkBox,
	type RenderedText,
} from './chat-mark-dom';
import {
	beginPenDrag,
	chatTouchAction,
	createGestureLatch,
	dragOffset,
	drawFromSpan,
	movePenDrag,
	penDragSpan,
	routeChatPointer,
	type PenDrag,
} from './chat-pen-drag';
import { messageToParts, type CardActionHandler, type CardSurface } from './chatParts';
import { useCardRegistry } from './cardRegistryContext';
import type { CleanupModel } from '../../../ai/voice';
import type { ProviderId } from '../../../ai/providers';
import { loadSettings, toReasoning, type DictationLocale } from '../../../platform/app/settings';
import { hasNativeRecorder, hasOnDeviceDictation } from '../../../platform/app/platform';

// Optional enrichment for the composer's built-in voice input. The mic is on by
// default; this only adds context. `glossary` seeds the STT cleanup pass with
// the current surface's proper names (book title + outline, article title) so
// mis-transcriptions of those terms get corrected. The cleanup model is derived
// from settings inside the composer, not passed here.
export interface ComposerVoice {
	glossary?: string;
}

// Resolve the `voice` prop against one host capability. The control is enabled
// unless a caller explicitly opts out with `voice={false}`, or the host cannot
// do it — on a phone the capture commands are not compiled in, so a mic there is
// a button whose only outcome is an error (see hasNativeRecorder).
//
// The composer asks this once for the recorder and once for on-device dictation.
// The two are exclusive in practice — a host either records for an STT round
// trip or dictates on device — but they are asked separately, so a host that
// grew both would show both rather than silently pick one.
export function resolveComposerVoice(
	voice: ComposerVoice | false | undefined,
	hostCan: boolean,
): { glossary: string } | null {
	if (voice === false || !hostCan) return null;
	return { glossary: voice?.glossary ?? '' };
}

// Which language the phone listens for, from settings (docs/15). Undefined until
// settings load; a hold that begins in that window falls back to the device's
// own preferred language for that one hold rather than blocking the press.
function useDictationLocale(): DictationLocale | undefined {
	const [locale, setLocale] = useState<DictationLocale | undefined>(undefined);
	useEffect(() => {
		let alive = true;
		loadSettings()
			.then((s) => {
				if (alive) setLocale(s.dictationLocale);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	return locale;
}

// The cleanup model the composer's voice input runs on, derived from settings so
// any composer has working voice input without the caller wiring it. Null until
// settings load, and null when no default provider/model is configured (the mic
// then skips the polish pass and keeps the raw transcript).
function useDefaultCleanupModel(): CleanupModel | null {
	const [model, setModel] = useState<CleanupModel | null>(null);
	useEffect(() => {
		let alive = true;
		loadSettings()
			.then((s) => {
				if (!alive) return;
				setModel(
					s.defaultProviderId && s.defaultModelId
						? {
								providerId: s.defaultProviderId as ProviderId,
								modelId: s.defaultModelId,
								reasoning: toReasoning(s.chatThinking),
							}
						: null,
				);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	return model;
}

// The async clipboard API is unreliable in WebKitGTK (pitfall 16), so a failure
// falls back to the legacy execCommand path on an offscreen textarea.
async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.top = '-1000px';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
		ta.remove();
		return ok;
	}
}

// Copy the reply's Markdown source. Hidden until the row is hovered or the
// button itself is focused; confirms for a moment, then returns.
function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | null>(null);
	useEffect(() => () => window.clearTimeout(timer.current ?? undefined), []);

	async function copy() {
		if (!(await copyText(text))) return;
		setCopied(true);
		window.clearTimeout(timer.current ?? undefined);
		timer.current = window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size={null}
			aria-label={copied ? 'Copied' : 'Copy'}
			onClick={copy}
			className="w-fit gap-1 rounded-md px-1.5 py-1 text-[12px] leading-none text-neutral-400 can-hover:opacity-0 transition-opacity can-hover:hover:text-neutral-600 focus-visible:opacity-100 group-hover:opacity-100 coarse:px-2.5 coarse:py-2"
		>
			{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
			{copied && 'Copied'}
		</Button>
	);
}

// --- the two pens on a reply (docs/09) -------------------------------------

// What a conversation needs to carry marks: the pen the top bar has selected,
// the book's marks so the ones on these replies can be drawn back, and the two
// things a reader does with them. Absent = this chat is not the book's, so no
// pen acts on it and nothing is drawn.
export interface ChatMarkHost {
	// The conversation these rows belong to — half of a mark's anchor
	// (platform/app/reader-contract.ts: ChatAnchor).
	threadId: string;
	// Resolved for this surface: null for the pointer and the navigation lock,
	// and null for the AI pen anywhere a third level would be opened.
	pen: MarkPen | null;
	color: string;
	// Every mark of the open book. A row picks its own out of it.
	marks: readonly Annotation[];
	// The reader's "draw with your finger" setting, the same one the page is
	// routed by (platform/app/device.ts). Absent is off, its default: a finger
	// then scrolls the lesson and marks nothing, and the stylus and the mouse
	// still draw.
	fingerDraw?: boolean;
	onDraw(draw: ChatMarkDraw): void;
	// A press on a mark, with where it landed in viewport coordinates.
	onOpen(annotation: Annotation, at: { x: number; y: number }): void;
}

// One gesture at a time, one document: the pen that takes a stroke and the layer
// that answers a press are two components and the same finger, so the gate they
// agree through is module scope rather than a prop threaded between them.
const strokes = createStrokeGate();

// And for the same reason, the latch that keeps one gesture to one stroke: the
// pen that takes a drag directly and the pen that reads a selection off the
// pointerup are two effects in two components, and the finger is one
// (chat-pen-drag.ts: GestureLatch).
const gesture = createGestureLatch();

// In context rather than a prop on every row: a mark drawn on one reply must
// not re-render the Markdown of all the others, and a row is memoized on its
// message (MessageBubble). Only the layer inside a row subscribes.
const ChatMarksContext = createContext<ChatMarkHost | null>(null);

// One mark as it is drawn: the pieces it paints as, the line boxes it is
// pressed on (a 2px rule is not a target — the words above it are), and the
// entry both came from.
interface PaintedMark {
	annotation: Annotation;
	pen: MarkPen;
	color: string;
	paint: MarkBox[];
	hit: MarkBox[];
}

// Every mark on one reply, measured against the reply as it stands now. One
// whose words are no longer there is not drawn and not an error: the entry
// stays in the file, it just has nothing to sit on (reading/chat-marks.ts).
function measureMarks(body: HTMLElement, host: ChatMarkHost, messageTs: number): PaintedMark[] {
	const index = indexRendered(body);
	if (index.text === '') return [];
	const origin = body.getBoundingClientRect();
	const out: PaintedMark[] = [];
	for (const found of locateChatMarks(index.text, host.marks, host.threadId, messageTs)) {
		const range = rangeOfSpan(index, found.span, body.ownerDocument);
		if (!range) continue;
		const hit = toBoxes(Array.from(range.getClientRects()), origin);
		if (hit.length === 0) continue;
		const color = typeof found.annotation.color === 'string' && found.annotation.color
			? found.annotation.color
			: host.color;
		out.push({
			annotation: found.annotation,
			pen: found.anchor.pen,
			color,
			paint: paintBoxes(hit, found.anchor.pen),
			hit,
		});
	}
	return out;
}

// Where a screen point falls in a reply's rendering, or null when it falls
// outside it.
//
// `caretRangeFromPoint` is WebKit's and Blink's, `caretPositionFromPoint` the
// standard name for the same thing; which of the two a given WKWebView answers
// to depends on its version, so both are asked and neither is assumed.
function caretOffsetAt(
	index: RenderedText,
	doc: Document,
	x: number,
	y: number,
): number | null {
	const legacy = (
		doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
	).caretRangeFromPoint;
	if (typeof legacy === 'function') {
		const range = legacy.call(doc, x, y);
		return range ? offsetOf(index, range.startContainer, range.startOffset) : null;
	}
	const standard = (
		doc as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number,
			) => { offsetNode: Node; offset: number } | null;
		}
	).caretPositionFromPoint;
	if (typeof standard === 'function') {
		const at = standard.call(doc, x, y);
		return at ? offsetOf(index, at.offsetNode, at.offset) : null;
	}
	return null;
}

// The marks on one reply, painted under its words, and the press that opens
// one. The layer wraps the reply's body so the two always read the same
// rendering — the words a mark is anchored against are the words this element
// holds — and so the overlay it paints is a sibling of what it observes rather
// than a child of it, which would have painting feed itself.
function ChatMarkLayer({
	messageTs,
	markable,
	children,
}: {
	messageTs: number;
	markable: boolean;
	children: React.ReactNode;
}) {
	const host = useContext(ChatMarksContext);
	const body = useRef<HTMLDivElement>(null);
	const [marks, setMarks] = useState<PaintedMark[]>([]);
	// Read by the press handler, which is bound once and must not see a stale
	// closure over the measurements.
	const latest = useRef<PaintedMark[]>(marks);
	latest.current = marks;
	const live = markable && !!host;
	const pen = host?.pen ?? null;
	const fingerDraw = host?.fingerDraw ?? false;
	// The stroke while it is still being made. On the page the ink appears under
	// the stylus; here the mark used to appear only once the finger came off. It
	// is painted in the pen that is making it, and swapped for the real mark on
	// the pointerup that saves it.
	const [pending, setPending] = useState<MarkBox[]>([]);
	const pendingFill = host && pen ? markFill(host.color, pen) : undefined;

	useLayoutEffect(() => {
		const el = body.current;
		if (!live || !el || !host) {
			setMarks((prev) => (prev.length === 0 ? prev : []));
			return;
		}
		const measure = () => setMarks(measureMarks(el, host, messageTs));
		measure();
		// The reply reflows when the window or the chat zoom changes, and its
		// contents change under React more than once: the Markdown renderer is a
		// lazy chunk that swaps in after the first paint, and KaTeX and the
		// highlighter rewrite what it produced.
		const observers: { disconnect(): void }[] = [];
		if (typeof ResizeObserver === 'function') {
			const ro = new ResizeObserver(measure);
			ro.observe(el);
			observers.push(ro);
		}
		if (typeof MutationObserver === 'function') {
			const mo = new MutationObserver(measure);
			mo.observe(el, { childList: true, subtree: true, characterData: true });
			observers.push(mo);
		}
		return () => {
			for (const o of observers) o.disconnect();
		};
	}, [live, host, messageTs]);

	useEffect(() => {
		const el = body.current;
		if (!live || !el || !host) return;
		const onClick = (e: MouseEvent) => {
			// The press that ended a drag belongs to the selection it made — or, when
			// a pen took that drag as a stroke, to the stroke, which has dropped the
			// selection by now and so cannot be recognised by it. One on a citation
			// chip belongs to the chip.
			if (strokes.closesAStroke()) return;
			const sel = el.ownerDocument.getSelection();
			if (sel && !sel.isCollapsed) return;
			if ((e.target as Element | null)?.closest?.('a')) return;
			const origin = el.getBoundingClientRect();
			const on = latest.current.find((m) =>
				boxesHold(m.hit, e.clientX - origin.left, e.clientY - origin.top),
			);
			if (!on) return;
			e.preventDefault();
			host.onOpen(on.annotation, { x: e.clientX, y: e.clientY });
		};
		el.addEventListener('click', onClick);
		return () => el.removeEventListener('click', onClick);
	}, [live, host]);

	// The stroke taken straight off the drag, the way the page takes one
	// (reading/engine/gesture/attach-touch.ts). The pointer is routed by the
	// reader's own table — stylus and mouse mark, the finger moves the lesson
	// unless the setting says otherwise — and the words are read out of the same
	// walk that draws marks back, so a drag never has to become a selection
	// first. Which is what the finger had to do before: on iPadOS a native
	// selection only begins after a long press, so marking a reply meant pressing
	// and waiting where marking a page meant drawing.
	useEffect(() => {
		const el = body.current;
		if (!live || !el || !host || !pen) return;
		const doc = el.ownerDocument;
		// Held for the life of one gesture. The rendering is indexed once at
		// pointerdown: a settled reply does not change under the drag, and every
		// offset the drag holds is an offset into this one reply.
		let drag: PenDrag | null = null;
		let index: RenderedText | null = null;

		// What stops the page from scrolling out under the ink. touch-action is on
		// the box below, but it cannot name a stylus — on iPadOS a Pencil drag is
		// a pan like any other — so the drag also prevents every touchmove while
		// it lasts. Non-passive, and only while a drag is live: the two engines
		// disagree about which move claims the scroll and agree that preventing
		// them all works (docs/pitfall/71, /117).
		const onTouchMove = (e: TouchEvent) => {
			if (drag && e.cancelable) e.preventDefault();
		};

		const paint = () => {
			const span = drag ? penDragSpan(drag) : null;
			if (!drag || !index || !span) {
				setPending((prev) => (prev.length === 0 ? prev : []));
				return;
			}
			const range = rangeOfSpan(index, span, doc);
			if (!range) return;
			const origin = el.getBoundingClientRect();
			setPending(paintBoxes(toBoxes(Array.from(range.getClientRects()), origin), pen));
		};

		const onDown = (e: PointerEvent) => {
			if (drag || e.button !== 0) return;
			if (routeChatPointer(pen, e.pointerType, fingerDraw) !== 'draw') return;
			// A press on a link or a citation chip belongs to that control, and a
			// press on a mark already drawn opens it (the click handler above).
			// Taking the gesture would prevent the click all three of them need.
			const target = e.target as Element | null;
			if (target?.closest?.('a, button')) return;
			const origin = el.getBoundingClientRect();
			const on = latest.current.some((m) =>
				boxesHold(m.hit, e.clientX - origin.left, e.clientY - origin.top),
			);
			if (on) return;
			const walked = indexRendered(el);
			const at = caretOffsetAt(walked, doc, e.clientX, e.clientY);
			if (at === null) return;
			index = walked;
			drag = beginPenDrag(messageTs, e.pointerId, at);
			// The native selection this press would otherwise start, and the mouse
			// events compatible with it, both gone: the stroke is the gesture now,
			// and the click that would close it would land on words that by then
			// carry a mark.
			e.preventDefault();
			// So the rest of the gesture is this element's even where the reader
			// drags outside it — which is most strokes, since a mark that ends at
			// the last word ends past it.
			el.setPointerCapture(e.pointerId);
			doc.addEventListener('touchmove', onTouchMove, { passive: false });
			gesture.take();
		};

		const onMove = (e: PointerEvent) => {
			if (!drag || !index || e.pointerId !== drag.pointerId) return;
			const box = el.getBoundingClientRect();
			const caret = caretOffsetAt(index, doc, e.clientX, e.clientY);
			const next = movePenDrag(drag, dragOffset(caret, e.clientY, box, index.text.length));
			if (next === drag) return;
			drag = next;
			paint();
		};

		const finish = (e: PointerEvent, commit: boolean) => {
			if (!drag || e.pointerId !== drag.pointerId) return;
			const held = drag;
			const walked = index;
			drag = null;
			index = null;
			doc.removeEventListener('touchmove', onTouchMove);
			setPending((prev) => (prev.length === 0 ? prev : []));
			if (!commit || !walked) return;
			const span = penDragSpan(held);
			const draw = span ? drawFromSpan(walked, span, held.messageTs, pen) : null;
			if (!draw) return;
			host.onDraw(draw);
			// The click that closes this drag lands on words that now carry a mark
			// (reading/chat-marks.ts: StrokeGate). A pointerdown that was prevented
			// often sends none at all, and the gate is cleared by the next gesture
			// either way.
			strokes.drew();
		};
		const onUp = (e: PointerEvent) => finish(e, true);
		const onCancel = (e: PointerEvent) => finish(e, false);

		el.addEventListener('pointerdown', onDown);
		doc.addEventListener('pointermove', onMove);
		doc.addEventListener('pointerup', onUp);
		doc.addEventListener('pointercancel', onCancel);
		return () => {
			el.removeEventListener('pointerdown', onDown);
			doc.removeEventListener('pointermove', onMove);
			doc.removeEventListener('pointerup', onUp);
			doc.removeEventListener('pointercancel', onCancel);
			doc.removeEventListener('touchmove', onTouchMove);
		};
	}, [live, host, pen, fingerDraw, messageTs]);

	return (
		<>
			{marks.length > 0 && (
				<div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
					{marks.map((m) =>
						m.paint.map((b, i) => (
							<span
								key={`${m.annotation.id}:${i}`}
								data-chat-mark={m.annotation.id}
								className="absolute rounded-[1px]"
								style={{
									left: b.left,
									top: b.top,
									width: b.width,
									height: b.height,
									backgroundColor: markFill(m.color, m.pen),
								}}
							/>
						)),
					)}
				</div>
			)}
			{pending.length > 0 && (
				<div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
					{pending.map((b, i) => (
						<span
							key={i}
							className="absolute rounded-[1px]"
							style={{
								left: b.left,
								top: b.top,
								width: b.width,
								height: b.height,
								backgroundColor: pendingFill,
							}}
						/>
					))}
				</div>
			)}
			{/* touch-action only where a finger is meant to draw: a reply has to
			    stay scrollable under a finger in every other configuration, and a
			    blanket `none` would strand the reader in a lesson they cannot
			    scroll. The stylus is not covered by it and does not rely on it
			    (chat-pen-drag.ts: chatTouchAction). */}
			<div
				ref={body}
				data-reply-body=""
				style={live ? { touchAction: chatTouchAction(pen, fingerDraw) } : undefined}
			>
				{children}
			</div>
		</>
	);
}

// The stroke a pen leaves on a reply, taken when the finger comes off.
//
// Not on selectionchange: a drag changes the selection continuously and a mark
// is one thing, made once. Pointer-up is also when a long press has finished
// producing its selection and when a double click has made its word.
//
// The words and the copy of them are read out of the same walk that draws marks
// back (chat-mark-dom.ts), never off Selection.toString(), which puts a newline
// between block elements and so describes a string no rendering holds.
//
// The selection is dropped afterwards: the words are marked now, and leaving
// them blue leaves WebKit's callout bar sitting over them (docs/pitfall/49).
// Which is why the stroke also has to say it happened: the click the browser
// sends next lands on words that now carry a mark, with nothing in the selection
// left to tell it from a press on one (reading/chat-marks.ts: StrokeGate).
function usePenStrokes(list: RefObject<HTMLElement>, host: ChatMarkHost | null): void {
	const pen = host?.pen ?? null;
	useEffect(() => {
		if (!host || !pen) return;
		const doc = list.current?.ownerDocument ?? document;
		const commit = () => {
			// The direct path already took this gesture and, if it was worth one,
			// already made its stroke. One gesture is one stroke: whatever the
			// browser is left holding as a selection is not a second one.
			if (gesture.taken()) return;
			const sel = doc.getSelection();
			if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
			const range = sel.getRangeAt(0);
			const node = range.commonAncestorContainer;
			const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
			// Outside a settled reply, spanning two of them, or overshooting into
			// the app's own words about the turn: the common ancestor is then the
			// row or the list, and neither carries the marker.
			const row = el?.closest('[data-reply-ts]') ?? null;
			if (!row || !list.current?.contains(row)) return;
			const index = indexRendered(row.querySelector('[data-reply-body]'));
			const start = offsetOf(index, range.startContainer, range.startOffset);
			const end = offsetOf(index, range.endContainer, range.endOffset);
			if (start === null || end === null) return;
			// The same offsets-to-stroke step the direct path takes, so the two
			// gestures cannot describe the same words differently.
			const draw = drawFromSpan(index, { start, end }, Number(row.getAttribute('data-reply-ts')), pen);
			if (!draw) return;
			host.onDraw(draw);
			strokes.drew();
			sel.removeAllRanges();
		};
		doc.addEventListener('pointerup', commit);
		return () => doc.removeEventListener('pointerup', commit);
	}, [host, pen, list]);
	// A gesture begins whether or not a pen is in hand — which is why this is not
	// in the effect above, whose deps carry the pen and the host, and whose host
	// is a new object every time a mark is saved. A stroke that never produced a
	// click (a finger on a touch screen usually does not) or produced one
	// nowhere near a reply (it came up over the composer) leaves the gate armed;
	// if the reader then puts the pen back, nothing here would be listening, and
	// their next press on an existing mark is spent on a stroke they finished
	// minutes ago. The ref is stable, so this binds once per surface and the
	// unmount clears whatever the last stroke left owed.
	useEffect(() => {
		const doc = list.current?.ownerDocument ?? document;
		const begin = () => {
			strokes.began();
			gesture.begin();
		};
		// Capture, so this runs before the reply's own pointerdown handler: that
		// one is where the direct path takes a gesture, and a new gesture clearing
		// the latch has to happen in front of it rather than after.
		doc.addEventListener('pointerdown', begin, true);
		return () => {
			doc.removeEventListener('pointerdown', begin, true);
			strokes.began();
			gesture.begin();
		};
	}, [list]);
}

// Attached images, right-aligned above a user message. Constrained height so a
// tall screenshot doesn't blow out the column; no lightbox in v1 (docs:
// original-size, bounded).
function MessageImages({ images }: { images: CompressedImage[] }) {
	return (
		<div className="flex flex-wrap justify-end gap-1.5">
			{images.map((img, i) => (
				<img
					key={i}
					src={`data:${img.mediaType};base64,${img.data}`}
					alt="attachment"
					className="max-h-52 max-w-full rounded-xl object-contain"
				/>
			))}
		</div>
	);
}

// The "thinking" state before the first streamed token arrives: three quiet
// pulsing dots where the reply will appear.
function TypingDots() {
	return (
		<div className="flex items-center gap-1 py-1 text-neutral-400" aria-label="Thinking">
			<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
			<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
			<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
		</div>
	);
}

// Tool-call trace above a streaming AI reply (M6): a running tool is a subdued
// line ending in an ellipsis; a failed one takes --destructive, the app's one red.
function ToolTrace({ tools, size }: { tools: ToolStatus[]; size: 'sm' | 'lg' }) {
	// An arbitrary font size brings no line height of its own, where text-sm did.
	const text = size === 'lg' ? 'text-[calc(0.875rem*var(--chat-scale,1))] leading-[1.43]' : 'text-xs';
	return (
		<div className="flex flex-col gap-0.5">
			{tools.map((t, i) =>
				t.state === 'error' ? (
					<div key={i} className={'text-destructive ' + text}>
						{t.label} — failed
					</div>
				) : (
					<div key={i} className={'text-neutral-400 ' + text}>
						{t.label}…
					</div>
				),
			)}
		</div>
	);
}

// The line under a reply that names what the turn left out to fit the context
// window. Deliberately not a toast and not an error color: nothing failed, the
// answer above is real, and this only says what it was formed from. One line,
// low contrast, sitting where a footnote would.
function BudgetNotice({ text, size }: { text: string; size: 'sm' | 'lg' }) {
	return (
		<div
			className={
				'text-neutral-400 ' +
				(size === 'lg'
					? 'text-[calc(13px*var(--chat-scale,1))] leading-[1.85]'
					: 'text-[11px] leading-relaxed')
			}
		>
			{text}
		</div>
	);
}

// Render a single card part through the registry the host provided
// (cardRegistryContext), dispatching its actions to the host's onCardAction with
// the card's stable id. The registry lookup is by kind, so the payload cast is
// safe (a card kind's component always accepts its own payload); the union
// widening is what the cast erases.
function CardPartView({
	part,
	surface,
	onCardAction,
}: {
	part: Extract<ReturnType<typeof messageToParts>[number], { type: 'card' }>;
	surface: CardSurface;
	onCardAction?: CardActionHandler;
}) {
	const registry = useCardRegistry();
	const Comp = registry?.[part.card.kind] as
		| React.FC<{
				payload: typeof part.card;
				state?: Record<string, unknown>;
				surface: CardSurface;
				dispatch: (action: Parameters<CardActionHandler>[1]) => void;
		  }>
		| undefined;
	// No provider above this chat means no cards were wired into it at all.
	if (!Comp) return null;
	return (
		<Comp
			payload={part.card}
			state={part.state}
			surface={surface}
			dispatch={(action) => onCardAction?.(part.id, action)}
		/>
	);
}

// One message row, ChatGPT-style: the AI reply is plain body text set right on
// the background (no bubble), carried by the Markdown typography; the user's
// message is a compact light pill, right-aligned, with any images above it. The
// row reads only its parts (messageToParts maps the legacy fields); role /
// images / streaming / failed stay message-level flags. Memoized on the message
// object, so while the AI reply streams (a new object each delta) only that row
// re-parses its Markdown.
const MessageBubble = memo(function MessageBubble({
	message,
	size,
	surface,
	onCardAction,
}: {
	message: ThreadMessage;
	size: 'sm' | 'lg';
	surface: CardSurface;
	onCardAction?: CardActionHandler;
}) {
	const { role, images, streaming, failed, notice } = message;
	const lg = size === 'lg';
	// Dev-only diagnostic for the streaming gray-line glitch; no-op in prod and
	// when this row isn't a streaming AI reply. Ref is attached to the prose row.
	const rowRef = useRef<HTMLDivElement>(null);
	useFlickerProbe(rowRef, role, streaming);

	if (role === 'user') {
		// The bubble fill comes from the enclosing surface (--chat-bubble-bg): this
		// row also renders in the corner bubble and in TalkView, both on white.
		const hasImages = !!images && images.length > 0;
		return (
			<div className="flex flex-col items-end gap-1.5">
				{hasImages && <MessageImages images={images!} />}
				{message.text && (
					<div
						className={
							'box-border max-w-[75%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--chat-bubble-bg,var(--color-muted-soft))] text-neutral-900 ' +
							(lg
								? 'px-4 py-2.5 text-[calc(1rem*var(--chat-scale,1))] leading-[1.75]'
								: 'px-3 py-1.5 text-[13px] leading-relaxed')
						}
					>
						{message.text}
					</div>
				)}
			</div>
		);
	}

	const parts = messageToParts(message);
	const cardParts = parts.filter((p): p is Extract<typeof p, { type: 'card' }> => p.type === 'card');
	const toolPart = parts.find((p): p is Extract<typeof p, { type: 'tool-trace' }> => p.type === 'tool-trace');
	const textPart = parts.find((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text' && !!p.text);

	// A card row (add-source flow) stands alone in the flow — no prose or trace.
	//
	// An aside receipt is the exception: it is a footnote on the message above it
	// rather than a turn of its own, so its row pulls back over the list's gap
	// and keeps a few pixels of it. The pull is per list spacing (lg / sm) and is
	// applied to no other kind of card.
	if (cardParts.length > 0) {
		const footnote = cardParts.every((p) => p.card.kind === 'aside');
		return (
			<div
				className={
					footnote
						? lg
							? 'mt-[calc(0.625rem_-_1.5rem*var(--chat-scale,1))] flex flex-col'
							: '-mt-1.5 flex flex-col'
						: 'my-1 flex flex-col gap-2'
				}
			>
				{cardParts.map((p) => (
					<CardPartView key={p.id} part={p} surface={surface} onCardAction={onCardAction} />
				))}
			</div>
		);
	}

	// AI: a turn that failed to reach the model is the app's words standing in for
	// the reply, drawn as a failure. A row carrying a notice is not that, even
	// with nothing written — it falls through to the notice-only row below.
	// refusalRow clears `failed`, so no refusal arrives here with both set; the
	// `!notice` half stays for any other path that ever marks a row and then adds
	// a sentence about the turn, and because a row is cheap to hand-build and
	// render, this is checked by a test rather than argued about.
	if (failed && !notice) {
		return (
			<div
				className={
					'text-destructive ' +
					(lg
						? 'text-[calc(15px*var(--chat-scale,1))] leading-[1.87]'
						: 'text-[13px] leading-relaxed')
				}
			>
				{message.text}
			</div>
		);
	}
	const trace = toolPart ? <ToolTrace tools={toolPart.tools} size={size} /> : null;
	// While a tool runs with no reply text yet, the trace stands in for the dots.
	if (streaming && !textPart) {
		return trace ?? <TypingDots />;
	}
	// A turn that stopped before writing anything (turn-rows.ts): the notice is
	// the whole row. Not red and with no Copy — nothing failed and there are no
	// model words to take.
	if (!textPart) {
		if (!notice) return trace;
		return (
			<div className="flex flex-col gap-2">
				{trace}
				<BudgetNotice text={notice} size={size} />
			</div>
		);
	}
	return (
		<div ref={rowRef} className="group flex flex-col gap-2">
			{trace}
			{/* data-reply-ts is the marker a pen stroke resolves against — the
			    predicate (mayMarkReply), written where it can be read back off the
			    DOM. On the prose element and not on the row: the row also holds the
			    tool trace kept for a failed call and the budget notice, which are
			    the app's words about the turn, and a selection that started in the
			    reply and overshot into one of them has its common ancestor on the
			    row. Marked there it would be accepted, and the app's sentence about
			    the turn would end up marked as if the model had written it.

			    `isolate` so the mark layer's negative z-index lands behind these
			    words and not behind the surface they are drawn on. */}
			<div
				data-reply-ts={mayMarkReply(message) ? message.ts : undefined}
				className={
					'relative isolate text-neutral-800 ' +
					(lg ? 'text-[calc(1rem*var(--chat-scale,1))]' : 'text-[13px]')
				}
			>
				<ChatMarkLayer messageTs={message.ts} markable={mayMarkReply(message)}>
					<Markdown text={textPart.text} />
				</ChatMarkLayer>
			</div>
			{/* After the answer, before the copy affordance: the notice belongs to the
			    reply, but Copy takes the model's words only. */}
			{!streaming && notice && <BudgetNotice text={notice} size={size} />}
			{!streaming && <CopyButton text={textPart.text} />}
		</div>
	);
});

export function MessageList({
	messages,
	size = 'sm',
	className = '',
	surface = 'call',
	onCardAction,
	stickKey,
	marks,
}: {
	messages: ThreadMessage[];
	size?: 'sm' | 'lg';
	className?: string;
	// The surface passed to any card component. Defaults to the call window; the
	// reading bubble passes 'bubble'.
	surface?: CardSurface;
	// The card action dispatcher. Absent on chats with no cards (the reader).
	onCardAction?: CardActionHandler;
	// Identifies the conversation on display. Changing it pins the list back to
	// the bottom, so switching threads starts at the newest message rather than
	// wherever the previous one had been scrolled to. A keyed list is also
	// remembered (common/scroll-memory.ts): leaving it and coming back lands where
	// the reader was rather than at the newest.
	stickKey?: string | number;
	// The two pens on these replies (docs/09). Absent on every chat that is not
	// the open book's — the info chat, the talk — where a reply is not the book
	// continued and nothing is drawn on it.
	marks?: ChatMarkHost | null;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const list = listRef.current;
		return list ? stickToBottom(list, scrollMemory(stickKey)) : undefined;
	}, [stickKey]);

	const host = marks ?? null;
	usePenStrokes(listRef, host);

	return (
		<ChatMarksContext.Provider value={host}>
			<div
				ref={listRef}
				className={
					'flex flex-col ' +
					(size === 'lg' ? 'gap-[calc(1.5rem*var(--chat-scale,1))] ' : 'gap-3 ') +
					'overflow-y-auto ' +
					className
				}
			>
				{/* Keyed by position, not by ts: a reader's message and the reply to it
				    are written in the same millisecond often enough that the reducer
				    already has to disambiguate them by role (reading/call-state.ts), so
				    ts is not unique and a duplicate key corrupts silently. What position
				    costs is that a row added or dropped above another re-keys it, and
				    both of those happen at the end of the list — a card goes in before
				    the row a turn is writing, and a turn starting drops the rows that
				    hold no answer, which is the last turn's failure. A settled reply
				    further up keeps its key, its memoized component and its DOM, so a
				    Range into it survives. */}
				{messages.map((m, i) => (
					<MessageBubble
						key={i}
						message={m}
						size={size}
						surface={surface}
						onCardAction={onCardAction}
					/>
				))}
			</div>
		</ChatMarksContext.Provider>
	);
}

// Staged images inside the composer: a placeholder card with a spinner while the
// paste compresses, then the preview. Black round ✕ at the top-right removes one;
// the badge stays 20px and HIT_44 carries the touch target, so it does not cover
// the thumbnail it sits on. Already absolute, so no `relative`.
function StagingCards({ images, onRemove, size }: { images: PendingImage[]; onRemove?: (id: string) => void; size: number }) {
	return (
		<div className="flex flex-wrap gap-2">
			{images.map((img) => (
				<div key={img.id} className="relative shrink-0" style={{ width: size, height: size }}>
					{img.status === 'loading' ? (
						<div className="flex h-full w-full items-center justify-center rounded-lg bg-black/[0.06]">
							<span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500" />
						</div>
					) : (
						<img
							src={`data:${img.mediaType};base64,${img.data}`}
							alt="attachment"
							className="h-full w-full rounded-lg object-cover"
						/>
					)}
					<button
						type="button"
						aria-label="Remove image"
						onClick={() => onRemove?.(img.id)}
						className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] leading-none text-white shadow ${HIT_44}`}
					>
						✕
					</button>
				</div>
			))}
		</div>
	);
}

// Presentational composer. Paste is handled globally by the host (a single
// document-level listener), so this only renders the staged images (inside the
// input container) + an optional hint, and reports text sends.
export function Composer({
	onSend,
	placeholder,
	pill = false,
	pendingImages = [],
	onRemoveImage,
	hint,
	streaming = false,
	onStop,
	voice,
}: {
	onSend(text: string): void;
	placeholder: string;
	pill?: boolean;
	pendingImages?: PendingImage[];
	onRemoveImage?(id: string): void;
	hint?: string;
	streaming?: boolean;
	onStop?(): void;
	// Voice input is on by default. Pass an enrichment object to add a glossary,
	// or `voice={false}` to explicitly opt a surface out of the mic.
	voice?: ComposerVoice | false;
}) {
	const [value, setValue] = useState('');
	const [voiceHint, setVoiceHint] = useState<string | null>(null);
	const taRef = useRef<HTMLTextAreaElement>(null);
	const resolvedVoice = resolveComposerVoice(voice, hasNativeRecorder());
	const dictation = resolveComposerVoice(voice, hasOnDeviceDictation());
	// Which half of the composer is showing on a host that dictates. Keyboard
	// first: the mode is a place the user goes, not one they land in.
	const [voiceMode, setVoiceMode] = useState(false);
	const cleanupModel = useDefaultCleanupModel();
	const dictationLocale = useDictationLocale();

	// Drop a cleaned voice transcript into the composer for review (never
	// auto-sent), appended after any text the user already typed.
	function insertVoiceText(text: string) {
		setValue((v) => (v.trim() ? v.replace(/\s+$/, '') + ' ' + text : text));
		requestAnimationFrame(() => taRef.current?.focus());
	}

	// A hold released over Edit: the same drop, plus the keyboard back, because
	// asking to edit is asking for the thing you edit with.
	function editVoiceText(text: string) {
		setVoiceMode(false);
		insertVoiceText(text);
	}

	// Auto-grow: collapse to one row, then take the content height up to the cap
	// (past it the textarea scrolls). The cap is a CSS max-height and is measured
	// rather than held here — it follows the chat zoom, which this component is
	// not allowed to know about.
	const grow = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = 'auto';
		const cap = Number.parseFloat(getComputedStyle(el).maxHeight);
		el.style.height = `${Number.isFinite(cap) ? Math.min(el.scrollHeight, cap) : el.scrollHeight}px`;
	}, []);
	useLayoutEffect(grow, [value, grow]);

	// A zoom changes the cap without re-rendering this component (the scope's
	// children are the same elements), so the column's new width is the signal.
	// Width only: the height this sets is the observed box, and reacting to it
	// would be a loop.
	const lastWidth = useRef(0);
	useEffect(() => {
		const el = taRef.current;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width ?? 0;
			if (width === lastWidth.current) return;
			lastWidth.current = width;
			grow();
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [grow]);

	const hasImages = pendingImages.length > 0;
	const hasLoading = pendingImages.some((p) => p.status === 'loading');
	const hasReady = pendingImages.some((p) => p.status === 'ready');
	const canSend = (!!value.trim() || hasReady) && !hasLoading;

	function send() {
		if (!canSend) return;
		onSend(value.trim());
		setValue('');
	}
	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		// An Enter that commits an IME composition must not send (keyCode 229 is
		// the pre-standard signal some engines still use).
		if (e.nativeEvent.isComposing || e.keyCode === 229) return;
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	const cardSize = pill ? 96 : 72;
	const container = pill
		? 'box-border rounded-3xl border border-black/10 bg-background px-2 py-2 shadow-sm'
		: 'box-border rounded-xl border border-black/10 bg-background p-2 focus-within:border-primary';
	// box-border: the auto-grow sets height from scrollHeight, which includes the
	// padding. Hidden scrollbar: an appearing gutter would reflow the text mid-typing.
	// 16px floor: WKWebView zooms the whole page in when a field smaller than that
	// takes focus, and the reader needs pinch-zoom left on. The big composer keeps
	// the floor inside its own size instead of as a coarse-pointer override — that
	// override would outrank the scaled size and pin the field at 16px on a tablet.
	const field =
		'box-border min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent outline-none placeholder:text-neutral-400 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
		(pill
			? 'max-h-[calc(10rem*var(--chat-scale,1))] py-1.5 text-[max(16px,calc(1rem*var(--chat-scale,1)))] leading-[1.5] text-neutral-800'
			: 'max-h-[100px] px-1 py-1 text-[13px] leading-5 coarse:text-[16px] coarse:leading-6 text-neutral-800');
	const stopBtn = 'flex shrink-0 items-center justify-center rounded-full bg-neutral-800 text-white';

	return (
		<div className="flex flex-col gap-2">
			<div className={container}>
				{hasImages && (
					<div className="mb-2 px-1">
						<StagingCards images={pendingImages} onRemove={onRemoveImage} size={cardSize} />
					</div>
				)}
				<div className={pill && !dictation ? 'flex items-end gap-2 pl-3' : 'flex items-end gap-2'}>
					{dictation && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={voiceMode ? 'Switch to keyboard' : 'Switch to voice'}
							onClick={() => setVoiceMode((on) => !on)}
							className="shrink-0 rounded-full text-neutral-400"
						>
							{voiceMode ? <IconKeyboard size={18} /> : <IconMic size={17} />}
						</Button>
					)}
					{dictation && voiceMode ? (
						<HoldToTalk
							onSend={onSend}
							onInsert={editVoiceText}
							onHint={setVoiceHint}
							glossary={dictation.glossary}
							locale={dictationLocale}
							disabled={streaming}
						/>
					) : (
						<textarea
							ref={taRef}
							rows={1}
							className={field}
							placeholder={placeholder}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							onKeyDown={onKeyDown}
						/>
					)}
					{resolvedVoice && !streaming && (
						<MicButton
							onInsert={insertVoiceText}
							glossary={resolvedVoice.glossary}
							cleanupModel={cleanupModel}
							onHint={setVoiceHint}
							size={pill ? 'lg' : 'sm'}
						/>
					)}
					{pill &&
						!(voiceMode && !streaming) &&
						(streaming ? (
							<button type="button" aria-label="Stop" onClick={onStop} className={`${stopBtn} h-9 w-9 coarse:h-11 coarse:w-11`}>
								<IconStop size={16} />
							</button>
						) : (
							<button
								type="button"
								aria-label="Send"
								onClick={send}
								disabled={!canSend}
								className="flex h-9 w-9 coarse:h-11 coarse:w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
							>
								<IconSend size={17} />
							</button>
						))}
					{!pill && streaming && (
						<button type="button" aria-label="Stop" onClick={onStop} className={`${stopBtn} mb-0.5 h-6 w-6 coarse:h-11 coarse:w-11`}>
							<IconStop size={12} />
						</button>
					)}
				</div>
			</div>
			{hint && <div className="px-1 text-[12px] leading-snug text-amber-600">{hint}</div>}
			{voiceHint && <div className="px-1 text-[12px] leading-snug text-amber-600">{voiceHint}</div>}
		</div>
	);
}
