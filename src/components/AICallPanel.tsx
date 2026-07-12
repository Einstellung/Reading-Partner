// AICallPanel: the desktop form of the main-screen call state (docs/03) — a
// docked right column. Position card on top (click to jump back to the source),
// conversation below, composer at the bottom. Tailwind-only.

import { IconClose } from './icons';
import { Composer, MessageList } from './chat';
import type { ThreadMessage } from './types';

interface AICallPanelProps {
	position: { fileName: string; pageLabel: string | null; excerpt: string | null } | null;
	messages: ThreadMessage[];
	onSend(text: string): void;
	onHangUp(): void;
	onPositionClick(): void;
}

export default function AICallPanel({ position, messages, onSend, onHangUp, onPositionClick }: AICallPanelProps) {
	return (
		<div className="flex h-full w-[340px] flex-col border-l border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
			<div className="flex items-center justify-between px-3 py-2">
				<span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Reading with AI</span>
				<button
					type="button"
					title="Hang up"
					aria-label="Hang up"
					onClick={onHangUp}
					className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
				>
					<IconClose size={15} />
				</button>
			</div>

			{position && (
				<button
					type="button"
					onClick={onPositionClick}
					className="mx-3 mb-2 box-border flex flex-col gap-1 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-left hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
				>
					<div className="flex items-baseline justify-between gap-2">
						<span className="truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
							{position.fileName}
						</span>
						{position.pageLabel && (
							<span className="shrink-0 text-[11px] text-neutral-400">p. {position.pageLabel}</span>
						)}
					</div>
					{position.excerpt && (
						<span className="line-clamp-2 text-[12px] italic leading-snug text-neutral-500 dark:text-neutral-400">
							“{position.excerpt}”
						</span>
					)}
				</button>
			)}

			<MessageList messages={messages} className="min-h-0 flex-1 px-3 py-1" />

			<div className="p-3">
				<Composer onSend={onSend} placeholder="Ask anything about this…" />
			</div>
		</div>
	);
}
