// Outline tab: the PDF's table of contents (pdf.js getOutline()), navigable by
// page. The outline is available even on scanned documents with no text layer,
// so gate only on `pending` / an empty outline — never on fulltext.status.

import type { Fulltext } from "../fulltext/types";

interface OutlineViewProps {
	fulltext: Fulltext | null;
	pending: boolean;
	onNavigatePage(page: number): void;
}

const EMPTY_TEXT = "px-3 py-3 text-[13px] text-[#777]";

export default function OutlineView({ fulltext, pending, onNavigatePage }: OutlineViewProps) {
	if (pending) {
		return <div className={EMPTY_TEXT}>Reading the outline…</div>;
	}
	const outline = fulltext?.outline ?? [];
	if (outline.length === 0) {
		return <div className={EMPTY_TEXT}>This document has no outline.</div>;
	}
	return (
		<div className="h-full overflow-y-auto py-1">
			{outline.map((item, i) => (
				<button
					key={i}
					type="button"
					className="flex w-full items-baseline gap-2 border-0 bg-transparent py-1.5 pr-3 text-left cursor-pointer hover:bg-black/5"
					style={{ paddingLeft: 12 + item.level * 14 }}
					onClick={() => onNavigatePage(item.page)}
				>
					<span className="min-w-0 flex-1 truncate text-[13px] text-[#1b1b1b]">{item.title}</span>
					<span className="shrink-0 [font-variant-numeric:tabular-nums] text-[11px] text-[#999]">{item.page}</span>
				</button>
			))}
		</div>
	);
}
