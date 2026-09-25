// The two pens on a reply (docs/09): the layer that paints a reply's marks and
// takes a stroke off a drag, and the hook that takes one off a selection.
//
// The stroke gate and the gesture latch below are module state shared by both,
// so there is exactly one of each per document; they must stay in this module.

import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type RefObject,
} from 'react';
import { createStrokeGate, type ChatMarkDraw } from '../../../reading/chat-marks';
import type { Annotation, MarkPen } from '../../../platform/app/reader-contract';
import {
	boxesHold,
	caretOffsetAt,
	indexRendered,
	markFill,
	measureMarks,
	offsetOf,
	paintBoxes,
	rangeOfSpan,
	toBoxes,
	type MarkBox,
	type PaintedMark,
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
export const ChatMarksContext = createContext<ChatMarkHost | null>(null);

// The marks on one reply, painted under its words, and the press that opens
// one. The layer wraps the reply's body so the two always read the same
// rendering — the words a mark is anchored against are the words this element
// holds — and so the overlay it paints is a sibling of what it observes rather
// than a child of it, which would have painting feed itself.
export function ChatMarkLayer({
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
export function usePenStrokes(list: RefObject<HTMLElement>, host: ChatMarkHost | null): void {
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
