// ChatPipCard: the picture-in-picture chat card shown in the top-right while
// reading is full-screen and a call is still live (docs/03). Click swaps the
// conversation back to full screen; the small ✕ hangs up. Tailwind-only.

import { IconClose, IconSparkle } from '../common/icons';

interface ChatPipCardProps {
	lastMessage: string | null;
	onClick(): void;
	onHangUp(): void;
}

export default function ChatPipCard({ lastMessage, onClick, onHangUp }: ChatPipCardProps) {
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			title="Back to conversation"
			className="group box-border flex w-60 items-start gap-2 rounded-xl border border-black/10 bg-white p-3 shadow-[0_6px_24px_rgba(0,0,0,0.16)] hover:border-black/20 hover:shadow-[0_10px_32px_rgba(0,0,0,0.22)]"
		>
			<span className="mt-0.5 shrink-0 text-[#7c5cff]">
				<IconSparkle size={16} />
			</span>
			<span className="line-clamp-2 flex-1 text-[12px] leading-snug text-neutral-600">
				{lastMessage ?? 'AI call ongoing'}
			</span>
			<button
				type="button"
				aria-label="Hang up"
				title="Hang up"
				onClick={(e) => {
					e.stopPropagation();
					onHangUp();
				}}
				className="-mr-1 -mt-1 flex h-5 w-5 coarse:h-9 coarse:w-9 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-black/5 hover:text-neutral-600"
			>
				<IconClose size={11} />
			</button>
		</div>
	);
}
