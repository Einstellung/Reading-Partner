// TraceList: the right-hand trace column — every mark the reader left on the
// document, in document order. Adapted from zotero/reader's annotations sidebar
// (src/common/components/sidebar/annotations-view.js + _preview.scss), reduced to
// a read-only list with a star toggle. Pure and controlled.

import { IconArea, IconHighlight, IconSparkle, IconStar, IconUnderline } from './icons';
import type { Annotation } from './types';
import './TraceList.css';

interface TraceListProps {
	annotations: Annotation[];
	selectedId?: string | null;
	onSelect(id: string): void;
	onToggleStar(id: string, starred: boolean): void;
	onOpenThread?(id: string): void;
}

function TypeMark({ annotation }: { annotation: Annotation }) {
	// Region-select is retired; legacy image annotations still render on the page
	// (engine draws them) and list here with a placeholder icon, not a thumbnail.
	if (annotation.type === 'image') {
		return <span className="trace-icon" style={{ color: annotation.color }}><IconArea size={18} /></span>;
	}
	const Icon = annotation.type === 'underline' ? IconUnderline : IconHighlight;
	return (
		<span className="trace-icon" style={{ color: annotation.color }}>
			<Icon size={18} />
		</span>
	);
}

export default function TraceList({ annotations, selectedId, onSelect, onToggleStar, onOpenThread }: TraceListProps) {
	// sortIndex is the engine's document-order key; lexicographic order is document order.
	const items = [...annotations].sort((a, b) => {
		const sa = a.sortIndex ?? '';
		const sb = b.sortIndex ?? '';
		return sa < sb ? -1 : sa > sb ? 1 : 0;
	});

	return (
		<div className="trace-list" role="listbox" aria-label="Traces">
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
						className={'trace-item' + (selected ? ' selected' : '') + (starred ? ' starred' : '')}
						onClick={() => onSelect(a.id)}
					>
						<div className="trace-mark">
							<TypeMark annotation={a} />
						</div>

						<div className="trace-body">
							{text && <div className="trace-text">{text}</div>}
							{comment && <div className="trace-comment">{comment}</div>}
							<div className="trace-meta">
								{pageLabel && <span className="trace-page">Page {pageLabel}</span>}
								{hasThread && (
									<button
										type="button"
										className="trace-thread"
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
							className="trace-star"
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
