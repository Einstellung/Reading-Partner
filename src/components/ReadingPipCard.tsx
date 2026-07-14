// ReadingPipCard: the picture-in-picture reading card shown in the top-right
// during a call's main-screen state (docs/03). Shows where you are in the
// document; click swaps reading back to full screen. Tailwind-only.

interface ReadingPipCardProps {
	fileName: string;
	pageLabel: string | null;
	excerpt: string | null;
	onClick(): void;
}

export default function ReadingPipCard({ fileName, pageLabel, excerpt, onClick }: ReadingPipCardProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			title="Back to reading"
			className="group box-border flex h-[120px] w-60 flex-col gap-1.5 rounded-xl border border-black/10 bg-white p-3 text-left shadow-[0_6px_24px_rgba(0,0,0,0.16)] hover:border-black/20 hover:shadow-[0_10px_32px_rgba(0,0,0,0.22)]"
		>
			<div className="flex items-baseline justify-between gap-2">
				<span className="truncate text-[13px] font-medium text-neutral-800">{fileName}</span>
				{pageLabel && <span className="shrink-0 text-[11px] text-neutral-400">p. {pageLabel}</span>}
			</div>
			{excerpt && (
				<span className="line-clamp-3 text-[12px] italic leading-snug text-neutral-500">
					“{excerpt}”
				</span>
			)}
			<span className="mt-auto text-[11px] text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100">
				Back to reading
			</span>
		</button>
	);
}
