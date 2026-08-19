// CallView: the main-screen call state (docs/03) — the conversation takes over
// the whole window, ChatGPT-style: a centered reading column and a big bottom
// composer. The parent overlays it on the reader and adds the reading pip card
// in the top-right, so this leaves that corner clear (close sits top-left).
// Tailwind-only.
//
// The conversation is a ChatScaleScope and its column width follows the zoom;
// the hang-up button and the chapter-focus line stay outside it.

import type { ReactNode } from 'react';
import type { AsideAnchor } from '../../../platform/app/threads';
import type { ReadingIntent } from '../../../reading/intents';
import ChatScaleScope from '../base/ChatScaleScope';
import { IconClose } from '../base/icons';
import ChapterFocusBar, { type ChapterFocusBarProps } from './ChapterFocusBar';
import { Composer, MessageList, type ComposerVoice } from './chat';
import IntentChips from './IntentChips';
import DeleteThreadButton from './DeleteThreadButton';
import { useKeyboardInset } from '../common/useKeyboardInset';
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
	hint?: string;
	streaming?: boolean;
	onStop?(): void;
	// The chapter this conversation is focused on (docs/09), stated at the top of
	// the window. Null, or an absent chapter, = no focus and no line.
	chapterFocus?: ChapterFocusBarProps | null;
	// The empty-state heading and composer placeholder. Default to the passage
	// wording; the book-level thread (docs/03: top-bar AI button) passes the book
	// title and "Ask about this book…".
	emptyTitle?: string;
	placeholder?: string;
	// What an empty conversation offers under the composer (reading/intents.ts).
	// Absent on a surface that has no opening intents — info's chat is one.
	intents?: readonly ReadingIntent[];
	// One line under the chips saying why the list is shorter than it will be —
	// the book is still being read through (reading/intents.ts bookTextNotice).
	// Absent = there is nothing to explain.
	emptyNote?: string | null;
	voice?: ComposerVoice | false;
	// Dispatches a card's actions (add-source flow). Absent = a chat with no cards.
	onCardAction?: CardActionHandler;
	// Open a side conversation on a span of one of these replies (docs/03).
	// Passed only on the book-level conversation; absent everywhere else, which is
	// what keeps an aside one level deep.
	onOpenAside?(anchor: AsideAnchor): void;
	// This conversation is itself an aside: what it was opened on, and the way
	// back to the one it came off. Absent = it is not one; a present `aside` with
	// no `onBack` is one whose parent is gone, which still says what it is about.
	aside?: { span: string; onBack?(): void };
	// Whether this call takes the chat zoom. The phone reaches this view too, and
	// has neither of the gestures that drive it.
	scalable?: boolean;
}

// The top line of an aside: the way back, and the sentence it was opened on so
// the reader can see which one they stepped away from. It takes the slot the
// chapter-focus line uses — an aside never carries a chapter focus of its own
// (it reads its parent's), so the two never want it at once.
function AsideBar({ span, onBack }: { span: string; onBack?(): void }) {
	return (
		<div className="absolute left-1/2 top-4 z-10 flex max-w-[70%] -translate-x-1/2 items-center gap-2">
			{onBack && (
				<Button
					type="button"
					variant="ghost"
					size={null}
					onClick={onBack}
					className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs text-neutral-500 coarse:py-2.5"
				>
					‹ Back to the lesson
				</Button>
			)}
			<span className="truncate text-xs italic text-neutral-400">“{span}”</span>
		</div>
	);
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
	onOpenAside,
	aside,
	scalable = true,
}: CallViewProps) {
	const empty = messages.length === 0;
	const Scope = scalable ? ChatScaleScope : PlainScope;
	const composerProps = { pendingImages, onRemoveImage, hint, streaming, onStop, voice };
	// Reserve space for the soft keyboard so the bottom composer stays above it
	// (iPad). box-sizing:border-box shrinks the flex column by this padding, so the
	// message list gives up the room and the composer rises. 0 on desktop.
	const keyboardInset = useKeyboardInset();

	return (
		<div
			className="relative flex h-full w-full flex-col bg-chat-surface [--chat-bubble-bg:var(--chat-bubble)] [--chat-code-bg:var(--chat-code)]"
			style={{ paddingBottom: keyboardInset || undefined }}
		>
			<div className="absolute left-4 top-4 z-10 flex items-center gap-1">
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
				{onDelete && <DeleteThreadButton onDelete={onDelete} />}
			</div>

			{aside ? <AsideBar {...aside} /> : chapterFocus && <ChapterFocusBar {...chapterFocus} />}

			{empty ? (
				<Scope className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
					<h1 className="mb-8 max-w-[calc(48rem*var(--chat-scale,1))] text-center text-[calc(1.5rem*var(--chat-scale,1))] font-medium text-neutral-700">
						{emptyTitle}
					</h1>
					<div className="w-full max-w-[calc(48rem*var(--chat-scale,1))]">
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
					    renders under the card. */}
					<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-36">
						<MessageList
							messages={messages}
							size="lg"
							className="mx-auto max-w-[calc(48rem*var(--chat-scale,1))] pb-6"
							onCardAction={onCardAction}
							onOpenAside={onOpenAside}
						/>
					</div>
					<div className="px-4 pb-6">
						<div className="mx-auto w-full max-w-[calc(48rem*var(--chat-scale,1))]">
							<Composer onSend={onSend} placeholder="Reply…" pill {...composerProps} />
						</div>
					</div>
				</Scope>
			)}
		</div>
	);
}
