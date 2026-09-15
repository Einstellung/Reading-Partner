// Outline tab: the book's table of contents, navigable by page, with the book's
// supplements under a rule below it (docs/67 「辅助资料」). The outline is
// available even on scanned documents with no text layer, so gate only on
// `pending` / an empty list — never on fulltext.status.
//
// Always the book's chapters, even while a supplement is on screen: clicking one
// is how the reader gets back to the book, at the page they picked.

import { outlineRows, ruleAt, type OutlineRow } from "./outline-rows";
import type { SupplementRef } from "../../../platform/app/supplements";
import type { Fulltext } from "../../../fulltext/types";

interface OutlineViewProps {
	// The book's own text, not the document on screen's.
	fulltext: Fulltext | null;
	pending: boolean;
	bookTitle: string;
	supplements: readonly SupplementRef[];
	docId: string | null;
	bookId: string | null;
	displaySource(sourceUrl: string | undefined): string;
	onNavigatePage(page: number): void;
	onOpenBook(): void;
	onOpenSupplement(hash: string): void;
}

const EMPTY_TEXT = "px-3 py-3 text-[13px] text-faint-foreground";
// One row. h-auto with generous padding on a coarse pointer keeps it a 44px
// target without forcing the height on a mouse.
const ROW =
	"flex w-full items-baseline gap-2 border-0 bg-transparent py-1.5 pr-3 text-left cursor-pointer can-hover:hover:bg-accent coarse:py-3";
const ROW_CURRENT = "bg-accent";

export default function OutlineView({
	fulltext,
	pending,
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
		bookFulltext: fulltext,
		bookTitle,
		supplements,
		docId,
		bookId,
		displaySource,
	});
	if (pending && rows.length === 0) {
		return <div className={EMPTY_TEXT}>Reading the outline…</div>;
	}
	if (rows.length === 0) {
		return <div className={EMPTY_TEXT}>This document has no outline.</div>;
	}
	const rule = ruleAt(rows);
	return (
		<div className="h-full overflow-y-auto py-1">
			{rows.map((row, i) => (
				<div key={rowKey(row, i)} className={i === rule ? "mt-1 border-t border-border pt-1" : undefined}>
					{row.kind === "chapter" ? (
						<button
							type="button"
							className={ROW}
							style={{ paddingLeft: 12 + row.level * 14 }}
							onClick={() => onNavigatePage(row.page)}
						>
							<span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{row.title}</span>
							<span className="shrink-0 [font-variant-numeric:tabular-nums] text-[11px] text-faint-foreground">
								{row.page}
							</span>
						</button>
					) : row.kind === "book" ? (
						<button
							type="button"
							className={`${ROW} pl-3 ${row.current ? ROW_CURRENT : ""}`}
							onClick={onOpenBook}
						>
							<span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{row.title}</span>
						</button>
					) : (
						<button
							type="button"
							className={`${ROW} pl-3 ${row.current ? ROW_CURRENT : ""}`}
							onClick={() => onOpenSupplement(row.hash)}
						>
							<span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{row.title}</span>
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
