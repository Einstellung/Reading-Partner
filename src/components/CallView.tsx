// CallView: the main-screen call state (docs/03) — the conversation takes over
// the whole window, ChatGPT-style: a centered reading column and a big bottom
// composer. The parent overlays it on the reader and adds the reading pip card
// in the top-right, so this leaves that corner clear (close sits top-left).
// Tailwind-only.

import { IconClose } from './icons';
import { Composer, MessageList, type ComposerVoice } from './chat';
import type { PendingImage, ThreadMessage } from './types';
import type { InfoCard } from '../info/cards';

interface CallViewProps {
	messages: ThreadMessage[];
	onSend(text: string): void;
	onHangUp(): void;
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
	// The empty-state heading and composer placeholder. Default to the passage
	// wording; the book-level thread (docs/03: top-bar AI button) passes the book
	// title and "Ask about this book…".
	emptyTitle?: string;
	placeholder?: string;
	voice?: ComposerVoice | false;
	// Renders an inline info card (add-source flow) in the message list.
	renderCard?: (card: InfoCard) => React.ReactNode;
}

export default function CallView({
	messages,
	onSend,
	onHangUp,
	pendingImages,
	onRemoveImage,
	hint,
	streaming,
	onStop,
	classroomOn = false,
	onToggleClassroom,
	classroomStatus,
	emptyTitle = 'Ask about this passage',
	placeholder = 'Ask about this passage…',
	voice,
	renderCard,
}: CallViewProps) {
	const empty = messages.length === 0;
	const composerProps = { pendingImages, onRemoveImage, hint, streaming, onStop, voice };

	return (
		<div className="relative flex h-full w-full flex-col bg-white">
			<button
				type="button"
				title="Hang up"
				aria-label="Hang up"
				onClick={onHangUp}
				className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5"
			>
				<IconClose size={18} />
			</button>

			{onToggleClassroom && (
				<div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2">
					<button
						type="button"
						aria-pressed={classroomOn}
						onClick={onToggleClassroom}
						className={
							'rounded-full border px-3 py-1.5 text-sm leading-none cursor-pointer ' +
							(classroomOn
								? 'border-[#c9c2e8] bg-[#efecfb] text-[#4a3a9e] hover:bg-[#e7e3f7]'
								: 'border-[#dcdcdc] bg-white text-neutral-600 hover:bg-[#f0f0f0]')
						}
					>
						Classroom
					</button>
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
					<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-16">
						<MessageList messages={messages} size="lg" className="mx-auto max-w-3xl pb-6" renderCard={renderCard} />
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
