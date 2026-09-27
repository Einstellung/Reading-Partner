// Outline tab: the book's table of contents, navigable by page, with the book's
// supplements under a rule below it (docs/67 「辅助资料」). The outline is
// available even on scanned documents with no text layer, so gate only on
// `pending` / an empty list — never on fulltext.status.
//
// Always the book's chapters, even while a supplement is on screen: clicking one
// is how the reader gets back to the book, at the page they picked.
//
// Two sizes: the desktop sidebar's, and the phone's outline sheet (a thumb list,
// larger type, no supplements).

import { outlineRows, ruleAt, type OutlineRow } from "./outline-rows";
import type { SupplementRef } from "../../../../platform/app/supplements";
import type { OutlineItem } from "../../../../fulltext/types";

interface OutlineViewProps {
	// The book's own outline, not the document on screen's.
	outline: readonly OutlineItem[];
	pending: boolean;
	size?: OutlineSize;
	bookTitle: string;
	supplements: readonly SupplementRef[];
	docId: string | null;
	bookId: string | null;
	displaySource(sourceUrl: string | undefined): string;
	onNavigatePage(page: number): void;
	onOpenBook(): void;
	onOpenSupplement(hash: string): void;
}

type OutlineSize = "sidebar" | "sheet";

const SIZES: Record<
	OutlineSize,
	{ list: string; empty: string; emptyText: string; row: string; indent: number; title: string; page: string }
> = {
	sidebar: {
		list: "h-full overflow-y-auto py-1",
		empty: "px-3 py-3 text-[13px] text-faint-foreground",
		emptyText: "This document has no outline.",
		// h-auto with generous padding on a coarse pointer keeps it a 44px target
		// without forcing the height on a mouse.
		row: "flex w-full items-baseline gap-2 border-0 bg-transparent py-1.5 pr-3 text-left cursor-pointer can-hover:hover:bg-accent coarse:py-3",
		indent: 12,
		title: "min-w-0 flex-1 truncate text-[13px] text-foreground",
		page: "shrink-0 [font-variant-numeric:tabular-nums] text-[11px] text-faint-foreground",
	},
	sheet: {
		list: "overflow-y-auto pb-safe-4",
		empty: "px-4 py-6 text-[14px] text-faint-foreground",
		emptyText: "This book has no table of contents.",
		row: "flex w-full items-baseline gap-2 border-0 bg-transparent py-3 pr-4 text-left text-[15px] coarse:min-h-[44px] can-hover:hover:bg-muted",
		indent: 16,
		title: "min-w-0 flex-1 truncate",
		page: "flex-none text-[12px] text-faint-foreground",
	},
};
const ROW_CURRENT = "bg-accent";

export default function OutlineView({
	outline,
	pending,
	size = "sidebar",
	bookTitle,
	supplements,
	docId,
	bookId,
	displaySource,
	onNavigatePage,
	onOpenBook,
	onOpenSupplement,
}: OutlineViewProps) {
	const rows = outlineRows({
		bookOutline: outline,
		bookTitle,
		supplements,
		docId,
		bookId,
		displaySource,
	});
	const s = SIZES[size];
	if (pending && rows.length === 0) {
		return <div className={s.empty}>Reading the outline…</div>;
	}
	if (rows.length === 0) {
		return <div className={s.empty}>{s.emptyText}</div>;
	}
	const rule = ruleAt(rows);
	return (
		<div className={s.list}>
			{rows.map((row, i) => (
				<div key={rowKey(row, i)} className={i === rule ? "mt-1 border-t border-border pt-1" : undefined}>
					{row.kind === "chapter" ? (
						<button
							type="button"
							className={s.row}
							style={{ paddingLeft: s.indent + row.level * 14 }}
							onClick={() => onNavigatePage(row.page)}
						>
							<span className={s.title}>{row.title}</span>
							<span className={s.page}>{row.page}</span>
						</button>
					) : row.kind === "book" ? (
						<button
							type="button"
							className={`${s.row} pl-3 ${row.current ? ROW_CURRENT : ""}`}
							onClick={onOpenBook}
						>
							<span className={s.title}>{row.title}</span>
						</button>
					) : (
						<button
							type="button"
							className={`${s.row} pl-3 ${row.current ? ROW_CURRENT : ""}`}
							onClick={() => onOpenSupplement(row.hash)}
						>
							<span className={s.title}>{row.title}</span>
							{row.source && (
								<span className="shrink-0 text-[11px] text-faint-foreground">{row.source}</span>
							)}
						</button>
					)}
				</div>
			))}
		</div>
	);
}

function rowKey(row: OutlineRow, i: number): string {
	return row.kind === "supplement" ? `s-${row.hash}` : `${row.kind}-${i}`;
}
