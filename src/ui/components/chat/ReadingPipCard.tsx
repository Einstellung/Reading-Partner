// ReadingPipCard: the picture-in-picture position card shown in the top-right
// during a call's main-screen state (docs/03). It shows the content the call is
// about, shrunk to a card; click swaps that content back to full screen. Used by
// both the reader call (book title + page + marked passage) and the info call
// (article title + source + one-liner) — the caller supplies the badge and body
// as nodes so each keeps its own look. Tailwind-only.

import type { ReactNode } from 'react';

interface ReadingPipCardProps {
	title: string;
	// Top-right label beside the title (reader: "p. 87"; info: a source tag).
	badge?: ReactNode;
	// The line(s) under the title (reader: the marked passage; info: the reason).
	body?: ReactNode;
	// Hover hint at the card's foot; defaults to the reader wording.
	hoverLabel?: string;
	onClick(): void;
}

export default function ReadingPipCard({ title, badge, body, hoverLabel = 'Back to reading', onClick }: ReadingPipCardProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={hoverLabel}
			className="group box-border flex h-[120px] w-60 flex-col gap-1.5 rounded-xl border border-black/10 bg-white p-3 text-left shadow-[0_6px_24px_rgba(0,0,0,0.16)] hover:border-black/20 hover:shadow-[0_10px_32px_rgba(0,0,0,0.22)]"
		>
			<div className="flex items-baseline justify-between gap-2">
				<span className="truncate text-[13px] font-medium text-neutral-800">{title}</span>
				{badge}
			</div>
			{body}
			<span className="mt-auto text-[11px] text-neutral-400 can-hover:opacity-0 transition-opacity group-hover:opacity-100">
				{hoverLabel}
			</span>
		</button>
	);
}
