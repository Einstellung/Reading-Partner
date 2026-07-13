// CallView: the main-screen call state (docs/03) — the conversation takes over
// the whole window, ChatGPT-style: a centered reading column and a big bottom
// composer. The parent overlays it on the reader and adds the reading pip card
// in the top-right, so this leaves that corner clear (close sits top-left).
// Tailwind-only.

import { IconClose } from './icons';
import { Composer, MessageList } from './chat';
import type { ChatImage, ThreadMessage } from './types';

interface CallViewProps {
	messages: ThreadMessage[];
	onSend(text: string): void;
	onHangUp(): void;
	pendingImages?: ChatImage[];
	onRemoveImage?(index: number): void;
	hint?: string;
}

export default function CallView({
	messages,
	onSend,
	onHangUp,
	pendingImages,
	onRemoveImage,
	hint,
}: CallViewProps) {
	const empty = messages.length === 0;
	const imageProps = { pendingImages, onRemoveImage, hint };

	return (
		<div className="relative flex h-full w-full flex-col bg-white dark:bg-neutral-900">
			<button
				type="button"
				title="Hang up"
				aria-label="Hang up"
				onClick={onHangUp}
				className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
			>
				<IconClose size={18} />
			</button>

			{empty ? (
				<div className="flex flex-1 flex-col items-center justify-center px-4">
					<h1 className="mb-8 text-center text-2xl font-medium text-neutral-700 dark:text-neutral-200">
						Ask about this passage
					</h1>
					<div className="w-full max-w-3xl">
						<Composer onSend={onSend} placeholder="Ask about this passage…" pill {...imageProps} />
					</div>
				</div>
			) : (
				<>
					<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-16">
						<MessageList messages={messages} size="lg" className="mx-auto max-w-3xl pb-6" />
					</div>
					<div className="px-4 pb-6">
						<div className="mx-auto w-full max-w-3xl">
							<Composer onSend={onSend} placeholder="Reply…" pill {...imageProps} />
						</div>
					</div>
				</>
			)}
		</div>
	);
}
