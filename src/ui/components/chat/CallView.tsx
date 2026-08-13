// CallView: the main-screen call state (docs/03) — the conversation takes over
// the whole window, ChatGPT-style: a centered reading column and a big bottom
// composer. The parent overlays it on the reader and adds the reading pip card
// in the top-right, so this leaves that corner clear (close sits top-left).
// Tailwind-only.

import { IconClose } from '../base/icons';
import { Composer, MessageList, type ComposerVoice } from './chat';
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
	// Classroom mode (docs/09): the toggle lives at the top of the chat window.
	// Absent handler = no button (e.g. no book open).
	classroomOn?: boolean;
	onToggleClassroom?(): void;
	// One-line prep status shown beside the toggle while classroom is on.
	classroomStatus?: string | null;
	// Rehearsal mode (docs/31), the third posture, beside the classroom toggle.
	// The two are mutually exclusive; the host owns that, not this row.
	rehearsalOn?: boolean;
	onToggleRehearsal?(): void;
	// The empty-state heading and composer placeholder. Default to the passage
	// wording; the book-level thread (docs/03: top-bar AI button) passes the book
	// title and "Ask about this book…".
	emptyTitle?: string;
	placeholder?: string;
	voice?: ComposerVoice | false;
	// Dispatches a card's actions (add-source flow). Absent = a chat with no cards.
	onCardAction?: CardActionHandler;
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
	classroomOn = false,
	onToggleClassroom,
	classroomStatus,
	rehearsalOn = false,
	onToggleRehearsal,
	emptyTitle = 'Ask about this passage',
	placeholder = 'Ask about this passage…',
	voice,
	onCardAction,
}: CallViewProps) {
	const empty = messages.length === 0;
	const composerProps = { pendingImages, onRemoveImage, hint, streaming, onStop, voice };
	// Reserve space for the soft keyboard so the bottom composer stays above it
	// (iPad). box-sizing:border-box shrinks the flex column by this padding, so the
	// message list gives up the room and the composer rises. 0 on desktop.
	const keyboardInset = useKeyboardInset();

	return (
		<div
			className="relative flex h-full w-full flex-col bg-white"
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

			{(onToggleClassroom || onToggleRehearsal) && (
				<div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2">
					{onToggleClassroom && (
						<Button
							type="button"
							variant={classroomOn ? 'secondary' : 'outline'}
							aria-pressed={classroomOn}
							onClick={onToggleClassroom}
							className={
								'rounded-full coarse:py-2.5 ' + (classroomOn ? '' : 'text-neutral-600')
							}
						>
							Classroom
						</Button>
					)}
					{onToggleRehearsal && (
						<Button
							type="button"
							variant={rehearsalOn ? 'secondary' : 'outline'}
							aria-pressed={rehearsalOn}
							onClick={onToggleRehearsal}
							className={
								'rounded-full coarse:py-2.5 ' + (rehearsalOn ? '' : 'text-neutral-600')
							}
						>
							Rehearsal
						</Button>
					)}
					{classroomOn && classroomStatus && (
						<span className="text-xs text-neutral-400">{classroomStatus}</span>
					)}
				</div>
			)}

			{empty ? (
				<div className="flex flex-1 flex-col items-center justify-center px-4">
					<h1 className="mb-8 max-w-3xl text-center text-2xl font-medium text-neutral-700">
						{emptyTitle}
					</h1>
					<div className="w-full max-w-3xl">
						<Composer onSend={onSend} placeholder={placeholder} pill {...composerProps} />
					</div>
				</div>
			) : (
				<>
					{/* pt-36 clears the reading card in the top-right corner (120px tall,
					    top-3), not just the hang-up button — below that the first message
					    renders under the card. */}
					<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-36">
						<MessageList messages={messages} size="lg" className="mx-auto max-w-3xl pb-6" onCardAction={onCardAction} />
					</div>
					<div className="px-4 pb-6">
						<div className="mx-auto w-full max-w-3xl">
							<Composer onSend={onSend} placeholder="Reply…" pill {...composerProps} />
						</div>
					</div>
				</>
			)}
		</div>
	);
}
