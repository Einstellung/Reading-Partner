// CallView: the main-screen call state (docs/03) — the conversation takes over
// the whole window, ChatGPT-style: a centered reading column and a big bottom
// composer. The parent overlays it on the reader and adds the reading pip card
// in the top-right, so this leaves that corner clear (close sits top-left).
// Tailwind-only.
//
// The conversation is a ChatScaleScope and its column width follows the zoom;
// the hang-up button and the chapter-focus line stay outside it.

import type { ReactNode } from 'react';
import type { ReadingIntent } from '../../../reading/intents';
import ChatScaleScope from '../base/ChatScaleScope';
import { useComposerSlot } from './composer-slot';
import { IconClose } from '../base/icons';
import ChapterFocusBar, { type ChapterFocusBarProps } from './ChapterFocusBar';
import { Composer } from './Composer';
import type { ComposerVoice } from './composer-voice';
import { MessageList } from './MessageList';
import type { ChatMarkHost } from './ChatMarkLayer';
import IntentChips from './IntentChips';
import DeleteThreadButton from './DeleteThreadButton';
import { useKeyboardInset, useShellKeyboard } from '../common/useKeyboardInset';
import type { PendingImage, ThreadMessage } from './types';
import type { CardActionHandler } from './chatParts';
import { Button } from '../ui/button';

interface CallViewProps {
	messages: ThreadMessage[];
	onSend(text: string): void;
	onHangUp(): void;
	// Delete this conversation (and, for a mark-anchored thread, its mark). Absent
	// = no delete control.
	onDelete?(): void;
	pendingImages?: PendingImage[];
	onRemoveImage?(id: string): void;
	// The element the composer sits in, for whatever has to keep out of its way
	// on the bottom edge — Lumen's corner (ui/components/lumen/corner-placement).
	// Both states report it: the empty conversation's composer is in the middle
	// of the screen, and the rule reads that off the box it measures.
	// Absent = whatever the shell hung over this screen (composer-slot.ts), which
	// is how the phone reaches every conversation it draws without a prop.
	composerRef?: (el: HTMLElement | null) => void;
	hint?: string;
	streaming?: boolean;
	onStop?(): void;
	// The chapter this conversation is focused on (docs/09), stated at the top of
	// the window. Null, or an absent chapter, = no focus and no line.
	chapterFocus?: ChapterFocusBarProps | null;
	// The empty-state heading and composer placeholder. Default to the passage
	// wording; the book-level thread (docs/03: the blackboard button) passes the
	// book's title and the ask that opens a lesson. A node rather than a string,
	// because an aside opens on the words it was pulled out of and shows them
	// (phone/PhoneLesson.tsx).
	emptyTitle?: ReactNode;
	placeholder?: string;
	// What an empty conversation offers under the composer (reading/intents.ts).
	// Absent on a surface that has no opening intents — info's chat is one, and
	// so is the book-level thread, where the reader types (docs/09).
	intents?: readonly ReadingIntent[];
	// One line under the composer saying why the book cannot be answered from yet
	// (reading/intents.ts bookTextNotice).
	// Absent = there is nothing to explain.
	emptyNote?: string | null;
	voice?: ComposerVoice | false;
	// Dispatches a card's actions (add-source flow). Absent = a chat with no cards.
	onCardAction?: CardActionHandler;
	// The two pens on these replies (docs/09). Passed on the open book's
	// conversations and nowhere else — a reply is the book continued, and the
	// info chat's is not.
	marks?: ChatMarkHost | null;
	// This conversation is itself an aside: the way back to the one it came off.
	// Absent = it is not one; a present `aside` with no `onBack` is one whose
	// parent is gone, and that one keeps the hang-up so the view still has a door.
	aside?: { onBack?(): void };
	// Whether this call takes the chat zoom. The phone reaches this view too, and
	// has neither of the gestures that drive it.
	scalable?: boolean;
	// Identifies the conversation for the transcript's scroll memory. Absent =
	// the list is not remembered and opens at the newest message.
	stickKey?: string;
	// A bar of the host's own across the top, in place of the floating controls
	// in the corner. The phone's lesson passes one (docs/70): the screen is the
	// conversation, so its top bar has to be the conversation's — a corner
	// hang-up under a bar would be a second, quieter way out of a screen that
	// already has a back. Absent = the corner controls, unchanged.
	header?: ReactNode;
	// A strip directly above the composer, in both the empty state and the full
	// one: the lesson's two standing chips. Absent = nothing there.
	footer?: ReactNode;
}

// The scope's box without the zoom, so the tree is the same shape either way.
function PlainScope({ children, className = '' }: { children: ReactNode; className?: string }) {
	return <div className={className}>{children}</div>;
}

export default function CallView({
	messages,
	onSend,
	onHangUp,
	onDelete,
	pendingImages,
	onRemoveImage,
	composerRef,
	hint,
	streaming,
	onStop,
	chapterFocus,
	emptyTitle = 'Ask about this passage',
	placeholder = 'Ask about this passage…',
	intents,
	emptyNote,
	voice,
	onCardAction,
	marks,
	aside,
	scalable = true,
	stickKey,
	header,
	footer,
}: CallViewProps) {
	const empty = messages.length === 0;
	// The shell's claim on the bottom edge, where this view was not handed one.
	const slot = useComposerSlot();
	const composerSlot = composerRef ?? slot;
	// The two states put the composer in two places — the middle of an empty
	// screen, the bottom edge of a full one — and whoever keeps out of its way is
	// told where it is by a callback ref. Keyed, because the two boxes are both a
	// <div> in the same slot of the same parent: React would reuse the one node,
	// leave the stable ref alone and never say it had moved, and a ResizeObserver
	// does not fire on a box that only changed position. So the first reply moved
	// the composer to the bottom edge and Lumen went on standing on it.
	const composerKey = empty ? "composer-centred" : "composer-edge";
	const Scope = scalable ? ChatScaleScope : PlainScope;
	// Held in a variable because two of the three headers below use it.
	const hangUp = (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			title="Hang up"
			aria-label="Hang up"
			onClick={onHangUp}
			className="h-9 w-9 rounded-full text-neutral-500"
		>
			<IconClose size={18} />
		</Button>
	);
	const composerProps = { pendingImages, onRemoveImage, hint, streaming, onStop, voice };
	// Reserve space for the soft keyboard so the bottom composer stays above it
	// (iPad). box-sizing:border-box shrinks the flex column by this padding, so the
	// message list gives up the room and the composer rises. 0 on desktop, and
	// off in a shell that moves itself above the keyboard (the phone's).
	const shellKeyboard = useShellKeyboard();
	const keyboardInset = useKeyboardInset(shellKeyboard === null);

	return (
		<div
			className="relative flex h-full w-full flex-col bg-chat-surface [--chat-bubble-bg:var(--chat-bubble)] [--chat-code-bg:var(--chat-code)]"
			style={{ paddingBottom: keyboardInset || undefined }}
		>
			{header}

			{/* The corner controls, for a call that was not given a bar of its own. */}
			{!header && (
			<div className="absolute left-4 top-4 z-10 flex items-center gap-1">
				{/* An aside's one control is the way back to the lesson it came out
				    of. What it was opened on is not quoted beside it: a reader can
				    mark a long stretch of a reply, and the reply is one press away
				    anyway. One whose parent is gone has no way back, so it keeps the
				    hang-up — the second door out of the view, the lit top-bar
				    blackboard being the other (reading/call-state.ts
				    mayOpenBookThread). */}
				{aside ? (
					aside.onBack ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={aside.onBack}
							className="h-9 whitespace-nowrap rounded-full px-3 text-neutral-500"
						>
							‹ Back to the lesson
						</Button>
					) : (
						hangUp
					)
				) : (
					<>
						{hangUp}
						{onDelete && <DeleteThreadButton onDelete={onDelete} />}
					</>
				)}
			</div>
			)}

			{/* An aside never carries a chapter focus of its own — it reads its
			    parent's — so this slot is the non-aside's alone. */}
			{!aside && chapterFocus && <ChapterFocusBar {...chapterFocus} />}

			{empty ? (
				<Scope className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
					<h1 className="mb-8 max-w-[calc(48rem*var(--chat-scale,1))] text-center text-[calc(1.5rem*var(--chat-scale,1))] font-medium text-neutral-700">
						{emptyTitle}
					</h1>
					<div
						key={composerKey}
						className="w-full max-w-[calc(48rem*var(--chat-scale,1))]"
						ref={composerSlot}
					>
						{footer}
						<Composer onSend={onSend} placeholder={placeholder} pill {...composerProps} />
						{intents && intents.length > 0 && (
							<IntentChips intents={intents} onPick={onSend} className="mt-3 justify-center" />
						)}
						{emptyNote && (
							<p className="m-0 mt-3 text-center text-xs text-neutral-400">{emptyNote}</p>
						)}
					</div>
				</Scope>
			) : (
				<Scope className="flex min-h-0 flex-1 flex-col">
					{/* pt-36 clears the reading card in the top-right corner (120px tall,
					    top-3), not just the hang-up button — below that the first message
					    renders under the card. A call with a bar of its own has neither,
					    and reserving that band under a bar would open the transcript a
					    third of a phone screen down. */}
					<div className={`min-h-0 flex-1 overflow-y-auto px-4 ${header ? 'pt-4' : 'pt-36'}`}>
						<MessageList
							messages={messages}
							size="lg"
							className="mx-auto max-w-[calc(48rem*var(--chat-scale,1))] pb-6"
							onCardAction={onCardAction}
							marks={marks}
							stickKey={stickKey}
						/>
					</div>
					{/* On the keyboard the composer sits just above it: the room under it
					    at rest is for the thumb and the home indicator, which the
					    keyboard covers. */}
					<div key={composerKey} className={`px-4 ${shellKeyboard ? 'pb-2' : 'pb-6'}`} ref={composerSlot}>
						<div className="mx-auto w-full max-w-[calc(48rem*var(--chat-scale,1))]">
							{footer}
							<Composer onSend={onSend} placeholder="Reply…" pill {...composerProps} />
						</div>
					</div>
				</Scope>
			)}
		</div>
	);
}
