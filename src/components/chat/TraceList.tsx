// TraceList: the right-hand trace column — every mark the reader left on the
// document, in document order. A read-only list with a star toggle and an AI
// thread shortcut. Pure and controlled; styled with Tailwind utilities.

import { IconArea, IconHighlight, IconSparkle, IconStar, IconUnderline } from '../common/icons';
import type { Annotation } from '../common/types';

interface TraceListProps {
	annotations: Annotation[];
	selectedId?: string | null;
	onSelect(id: string): void;
	onToggleStar(id: string, starred: boolean): void;
	onOpenThread?(id: string): void;
}

const ITEM =
	'group relative flex cursor-pointer items-start gap-2 border-b border-black/10 py-2 pl-3 pr-2 hover:bg-black/5';
const ITEM_SELECTED =
	"bg-sky-50 before:content-[''] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sky-600";
const ICON_BTN =
	'flex cursor-pointer items-center justify-center border-0 bg-transparent p-0.5 rounded';

function TypeMark({ annotation }: { annotation: Annotation }) {
	// Region-select is retired; legacy image annotations still render on the page
	// (engine draws them) and list here with a placeholder icon, not a thumbnail.
	if (annotation.type === 'image') {
		return <span className="flex" style={{ color: annotation.color }}><IconArea size={18} /></span>;
	}
	const Icon = annotation.type === 'underline' ? IconUnderline : IconHighlight;
	return (
		<span className="flex" style={{ color: annotation.color }}>
			<Icon size={18} />
		</span>
	);
}

export default function TraceList({ annotations, selectedId, onSelect, onToggleStar, onOpenThread }: TraceListProps) {
	// sortIndex is the document-order key; lexicographic order is document order.
	const items = [...annotations].sort((a, b) => {
		const sa = a.sortIndex ?? '';
		const sb = b.sortIndex ?? '';
		return sa < sb ? -1 : sa > sb ? 1 : 0;
	});

	return (
		<div className="h-full overflow-y-auto bg-white text-[13px] text-neutral-800 select-none" role="listbox" aria-label="Traces">
			{items.map((a) => {
				const starred = a.starred === true;
				const selected = a.id === selectedId;
				const text = typeof a.text === 'string' ? a.text : '';
				const comment = typeof a.comment === 'string' ? a.comment : '';
				const pageLabel = typeof a.pageLabel === 'string' ? a.pageLabel : '';
				const hasThread = typeof a.aiThreadId === 'string' && a.aiThreadId !== '';
				return (
					<div
						key={a.id}
						role="option"
						aria-selected={selected}
						className={ITEM + (selected ? ' ' + ITEM_SELECTED : '')}
						onClick={() => onSelect(a.id)}
					>
						<div className="flex w-5 flex-none items-center justify-center pt-0.5">
							<TypeMark annotation={a} />
						</div>

						<div className="flex min-w-0 flex-1 flex-col gap-1">
							{text && <div className="line-clamp-2 leading-snug">{text}</div>}
							{comment && <div className="line-clamp-2 text-xs leading-snug text-neutral-500">{comment}</div>}
							<div className="flex items-center gap-1.5">
								{pageLabel && <span className="text-[11px] text-neutral-400">Page {pageLabel}</span>}
								{hasThread && (
									<button
										type="button"
										className={`${ICON_BTN} text-violet-500 hover:bg-violet-500/10`}
										title="Open AI thread"
										aria-label="Open AI thread"
										onClick={(e) => {
											e.stopPropagation();
											onOpenThread?.(a.id);
										}}
									>
										<IconSparkle size={14} />
									</button>
								)}
							</div>
						</div>

						<button
							type="button"
							className={
								'flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 transition-opacity hover:bg-black/5 focus-visible:opacity-100' +
								(starred
									? ' text-amber-500 opacity-100'
									: ' text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-amber-500')
							}
							title={starred ? 'Unstar' : 'Star'}
							aria-label={starred ? 'Unstar' : 'Star'}
							aria-pressed={starred}
							onClick={(e) => {
								e.stopPropagation();
								onToggleStar(a.id, !starred);
							}}
						>
							<IconStar filled={starred} size={16} />
						</button>
					</div>
				);
			})}
		</div>
	);
}
