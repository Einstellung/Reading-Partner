// The message list for the call UI (CallBubble, CallView). Tailwind-only.
//
// The `lg` size sets its type and the space around it off `--chat-scale`, read
// as a variable with a default so nothing here imports the zoom; `sm` is the
// corner bubble and does not zoom. The scaled values are unitless or an
// expression: a rem line height or gap is measured against the root font size
// and would sit still while the type grew.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { IconCheck, IconCopy } from '../base/icons';
import { Markdown } from '../markdown/Markdown';
import { useFlickerProbe } from '../common/useFlickerProbe';
import { scrollMemory } from '../common/scroll-memory';
import { stickToBottom } from '../common/stick-to-bottom';
import { copyText } from '../common/clipboard';
import type { ThreadMessage } from './types';
import type { CompressedImage } from '../../../ai/image-utils';
import { visibleTrace, type ToolStatus } from '../../../ai/tool-status';
import { QUEUED_NOTE, type TurnPhase } from '../../../ai/turn-rows';
import { phaseLabel } from './phase-line';
import { mayMarkReply } from '../../../reading/chat-marks';
import { ChatMarkLayer, ChatMarksContext, usePenStrokes, type ChatMarkHost } from './ChatMarkLayer';
import { messageToParts, type CardActionHandler, type CardSurface } from './chatParts';
import { DispatchPart } from './DispatchPart';
import { ReceiptPart } from './ReceiptPart';
import { DeliveredRunsContext, deliveredRunIds, type DeliveredRuns } from './deliveredRuns';
import { useCardRegistry } from './cardRegistryContext';

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

// An arbitrary font size brings no line height of its own, where text-sm did.
function traceText(size: 'sm' | 'lg') {
	return size === 'lg' ? 'text-[calc(0.875rem*var(--chat-scale,1))] leading-[1.43]' : 'text-xs';
}

// What a turn is doing before it has written anything, as one subdued line where
// the reply will appear — the same line a running tool draws, because extended
// thinking is the same wait with nothing to show for it. The thinking itself is
// never rendered. Nothing is drawn once the reply is arriving, and nothing while
// a tool runs: ToolTrace is already saying it.
function PhaseLine({ phase, size }: { phase?: TurnPhase; size: 'sm' | 'lg' }) {
	const label = phaseLabel(phase);
	if (!label) return null;
	return (
		<div className={'text-neutral-400 ' + traceText(size)} aria-label={label}>
			{label}…
		</div>
	);
}

// Tool-call trace under what a streaming AI reply has written so far (M6): a
// running tool is a subdued line ending in an ellipsis; a failed one takes
// --destructive, the app's one red. The reply resumes under it in the next round
// (docs/pitfall/291), and a successful call's line is gone by then.
function ToolTrace({ tools, size }: { tools: ToolStatus[]; size: 'sm' | 'lg' }) {
	const text = traceText(size);
	// The calls that finished collapse into one grey line under the answer, in the
	// order they ran; a running call keeps its own line with the ellipsis, and a
	// failure keeps its own line in red with the sentence the tool threw. Quiet
	// calls are not here at all (ai/tool-status.ts) unless they failed.
	const shown = visibleTrace(tools);
	const done = shown.filter((t) => t.state === 'done');
	return (
		<div className="flex flex-col gap-0.5">
			{shown.map((t, i) =>
				t.state === 'error' ? (
					<div key={i} className={'text-destructive ' + text}>
						{t.label} — {t.error || 'failed'}
					</div>
				) : t.state === 'running' ? (
					<div key={i} className={'text-neutral-400 ' + text}>
						{t.label}…
					</div>
				) : null,
			)}
			{done.length > 0 && (
				<div className={'text-neutral-400 ' + text}>{done.map((t) => t.label).join(' · ')}</div>
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
		// row also renders in the corner bubble and in RetellView, both on white.
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
				{message.queued && (
					<div className="px-1 text-[11px] leading-none text-neutral-400">{QUEUED_NOTE}</div>
				)}
			</div>
		);
	}

	const parts = messageToParts(message);
	const cardParts = parts.filter((p): p is Extract<typeof p, { type: 'card' }> => p.type === 'card');
	const toolPart = parts.find((p): p is Extract<typeof p, { type: 'tool-trace' }> => p.type === 'tool-trace');
	const textPart = parts.find((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text' && !!p.text);
	const ticketParts = parts.filter(
		(p): p is Extract<typeof p, { type: 'receipt' } | { type: 'dispatch' }> =>
			p.type === 'receipt' || p.type === 'dispatch',
	);

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
	// A trace of nothing but quiet calls draws nothing at all — and must not draw
	// an empty box in place of the status line the row would otherwise show.
	const trace =
		toolPart && visibleTrace(toolPart.tools).length ? (
			<ToolTrace tools={toolPart.tools} size={size} />
		) : null;
	// What this round wrote down and what it sent off, between the words and the
	// trace: the records of the turn, in the order the calls finished.
	const tickets = ticketParts.length ? (
		<div className="flex flex-col gap-1.5">
			{ticketParts.map((p, i) =>
				p.type === 'dispatch' ? (
					<DispatchPart key={i} runId={p.runId} receipt={p.receipt} size={size} />
				) : (
					<ReceiptPart
						key={i}
						receipt={p.receipt}
						size={size}
						{...(p.receipt.link?.kind === 'book'
							? {
									onOpen: () =>
										onCardAction?.(`receipt-${message.ts}-${i}`, {
											kind: 'navigate',
											to: 'book',
											arg: (p.receipt.link as { kind: 'book'; id: string }).id,
										}),
								}
							: {})}
					/>
				),
			)}
		</div>
	) : null;
	// While a tool runs with no reply text yet, the trace is the status line.
	if (streaming && !textPart) {
		if (tickets) {
			return (
				<div className="flex flex-col gap-2">
					{tickets}
					{trace}
				</div>
			);
		}
		return trace ?? <PhaseLine phase={message.phase} size={size} />;
	}
	// A turn that stopped before writing anything (turn-rows.ts): the notice is
	// the whole row. Not red and with no Copy — nothing failed and there are no
	// model words to take.
	if (!textPart) {
		if (!notice) {
			if (!tickets) return trace;
			return (
				<div className="flex flex-col gap-2">
					{tickets}
					{trace}
				</div>
			);
		}
		return (
			<div className="flex flex-col gap-2">
				{tickets}
				{trace}
				<BudgetNotice text={notice} size={size} />
			</div>
		);
	}
	return (
		<div
			ref={rowRef}
			className="group flex flex-col gap-2"
			// Which handed-off run this row answers, where it answers one: it is how
			// the dispatch ticket further up finds the reply to scroll to.
			data-origin-run={message.origin?.runId}
		>
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
			{tickets}
			{/* Under the words, not above them: what the round wrote before calling a
			    tool stays where the reader read it, and the next round continues
			    below this line (docs/pitfall/291). */}
			{trace}
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
	// the open book's — the info chat, the retell — where a reply is not the book
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

	// Which handed-off runs this thread already holds the answer to, and the way
	// down to one. Only this component knows both: a ticket is drawn from the row
	// that sent the work off, and the reply is somewhere else in the list.
	const answered = useMemo(() => deliveredRunIds(messages), [messages]);
	const delivered = useMemo<DeliveredRuns>(
		() => ({
			has: (runId) => answered.has(runId),
			scrollTo(runId) {
				const row = listRef.current?.querySelector(
					`[data-origin-run="${CSS.escape(runId)}"]`,
				);
				row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			},
		}),
		[answered],
	);

	return (
		<DeliveredRunsContext.Provider value={delivered}>
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
		</DeliveredRunsContext.Provider>
	);
}
