// TraceList: the right-hand trace column — every mark the reader left on the
// document, in document order. A read-only list with an AI thread shortcut and a
// swipe-to-delete on each row. Controlled; styled with Tailwind utilities.
//
// Deleting from here is the only way to get rid of an AI-pen mark: tapping one
// on the page opens its conversation, not the annotation editor, so the editor's
// Delete never comes within reach of it.
//
// The gesture itself is decided in swipe-action.ts, unit tested and DOM-free;
// this file binds pointer events, runs the commands that come back, and paints
// the offset. Reaching the Delete costs two separate acts, and neither of them
// is the swipe: uncover it, then press it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconArea, IconHighlight, IconSparkle, IconTrash, IconUnderline } from '../base/icons';
import { Button } from '../ui/button';
import type { Annotation } from './types';
import {
	SWIPE_ACTION_WIDTH,
	actionVisible,
	initSwipeState,
	rowClickAction,
	stepSwipe,
	trackedOpen,
	type SwipeInput,
	type SwipeState,
} from './swipe-action';

interface TraceListProps {
	annotations: Annotation[];
	selectedId?: string | null;
	onSelect(id: string): void;
	onDelete(id: string): void;
	onOpenThread?(id: string): void;
}

// The sliding content needs an opaque background of its own: the delete drawer
// sits behind it, and a translucent hover tint would show it through.
const ITEM = 'relative flex cursor-pointer items-start gap-2 py-2 pl-3 pr-2 touch-pan-y';
const ITEM_REST = 'bg-background can-hover:hover:bg-accent';
const ITEM_SELECTED =
	"bg-secondary can-hover:hover:bg-secondary-hover before:content-[''] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary";

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

interface TraceRowProps {
	annotation: Annotation;
	selected: boolean;
	// Whether this is the list's one open row. The list holds it, so opening a
	// second row shuts the first.
	open: boolean;
	onOpenChange(id: string, open: boolean): void;
	onSelect(id: string): void;
	onDelete(id: string): void;
	onOpenThread?(id: string): void;
}

function TraceRow({ annotation, selected, open, onOpenChange, onSelect, onDelete, onOpenThread }: TraceRowProps) {
	const a = annotation;
	const contentRef = useRef<HTMLDivElement>(null);
	const swipeRef = useRef<SwipeState>(initSwipeState());
	const [swipe, setSwipe] = useState<SwipeState>(swipeRef.current);
	// A click is the tail of the drag that just ended, not a tap on the row.
	const draggedRef = useRef(false);

	const dispatch = useCallback(
		(input: SwipeInput, e?: React.PointerEvent) => {
			const out = stepSwipe(swipeRef.current, input);
			swipeRef.current = out.state;
			const el = contentRef.current;
			for (const c of out.commands) {
				switch (c.type) {
					case 'capture':
						el?.setPointerCapture(c.id);
						break;
					case 'releaseCapture':
						if (el?.hasPointerCapture(c.id)) el.releasePointerCapture(c.id);
						break;
					case 'preventDefault':
						e?.preventDefault();
						break;
					case 'suppressClick':
						draggedRef.current = true;
						break;
					case 'openChanged':
						onOpenChange(a.id, c.open);
						break;
				}
			}
			setSwipe(out.state);
		},
		[a.id, onOpenChange],
	);

	// The list shutting this row: another one opened, or a selection was made.
	useEffect(() => {
		if (!open && trackedOpen(swipeRef.current)) dispatch({ type: 'close' });
	}, [open, dispatch]);

	const text = typeof a.text === 'string' ? a.text : '';
	const comment = typeof a.comment === 'string' ? a.comment : '';
	const pageLabel = typeof a.pageLabel === 'string' ? a.pageLabel : '';
	const hasThread = typeof a.aiThreadId === 'string' && a.aiThreadId !== '';
	const dragging = swipe.phase === 'dragging';

	return (
		<div
			role="option"
			aria-selected={selected}
			className="group relative overflow-hidden border-b border-black/10"
		>
			{/* The action the row slides off: only mounted once it is uncovered, so
			    a shut row has nothing under it to press by accident. Its width is
			    the row's travel, which swipe-action.ts owns. */}
			{actionVisible(swipe) && (
				<button
					type="button"
					className="absolute inset-y-0 right-0 flex cursor-pointer items-center justify-center border-0 bg-destructive text-[13px] font-medium text-destructive-foreground can-hover:hover:bg-destructive-hover active:bg-destructive-hover"
					style={{ width: SWIPE_ACTION_WIDTH }}
					title="Confirm delete"
					onClick={(e) => {
						e.stopPropagation();
						onDelete(a.id);
					}}
				>
					Delete
				</button>
			)}

			<div
				ref={contentRef}
				className={
					ITEM +
					' ' +
					(selected ? ITEM_SELECTED : ITEM_REST) +
					(dragging ? ' transition-none' : ' transition-transform duration-200 ease-out')
				}
				style={{ transform: `translateX(${swipe.offset}px)` }}
				onPointerDown={(e) => dispatch({ type: 'pointerdown', id: e.pointerId, x: e.clientX, y: e.clientY }, e)}
				onPointerMove={(e) => dispatch({ type: 'pointermove', id: e.pointerId, x: e.clientX, y: e.clientY }, e)}
				onPointerUp={(e) => dispatch({ type: 'pointerup', id: e.pointerId }, e)}
				onPointerCancel={(e) => dispatch({ type: 'pointercancel', id: e.pointerId }, e)}
				onClick={() => {
					const action = rowClickAction(trackedOpen(swipeRef.current), draggedRef.current);
					draggedRef.current = false;
					if (action === 'close') dispatch({ type: 'close' });
					else if (action === 'select') onSelect(a.id);
				}}
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
							<Button
								type="button"
								variant="ghost"
								size={null}
								className="rounded p-0.5 text-primary can-hover:hover:bg-primary/10 coarse:h-11 coarse:w-11"
								title="Open AI thread"
								aria-label="Open AI thread"
								onClick={(e) => {
									e.stopPropagation();
									onOpenThread?.(a.id);
								}}
							>
								<IconSparkle size={14} />
							</Button>
						)}
					</div>
				</div>

				{/* The mouse's way in. Dragging a list row sideways is not something a
				    desktop reader would think to try, so a hover-capable pointer gets
				    the same reveal on a click here; it uncovers the Delete rather than
				    deleting, so both devices pay the same two acts. */}
				<Button
					type="button"
					variant="ghost"
					size={null}
					className="hidden h-6 w-6 flex-none rounded p-0 text-neutral-400 opacity-0 transition-opacity can-hover:flex group-hover:opacity-100 focus-visible:opacity-100 can-hover:hover:bg-destructive/10 can-hover:hover:text-destructive"
					title="Delete mark"
					aria-label="Delete mark"
					aria-expanded={actionVisible(swipe)}
					onClick={(e) => {
						e.stopPropagation();
						dispatch({ type: 'open' });
					}}
				>
					<IconTrash size={14} />
				</Button>
			</div>
		</div>
	);
}

export default function TraceList({ annotations, selectedId, onSelect, onDelete, onOpenThread }: TraceListProps) {
	// The one row standing open. Opening another shuts it, so there is never more
	// than one Delete on screen.
	const [openId, setOpenId] = useState<string | null>(null);

	// A row only ever reports its own state, so a row shutting itself because
	// another one opened must not clear the new one.
	const onOpenChange = useCallback((id: string, open: boolean) => {
		setOpenId((cur) => (open ? id : cur === id ? null : cur));
	}, []);

	const handleSelect = useCallback(
		(id: string) => {
			setOpenId(null);
			onSelect(id);
		},
		[onSelect],
	);

	const handleDelete = useCallback(
		(id: string) => {
			setOpenId(null);
			onDelete(id);
		},
		[onDelete],
	);

	// sortIndex is the document-order key; lexicographic order is document order.
	const items = [...annotations].sort((a, b) => {
		const sa = a.sortIndex ?? '';
		const sb = b.sortIndex ?? '';
		return sa < sb ? -1 : sa > sb ? 1 : 0;
	});

	return (
		<div className="h-full overflow-y-auto bg-white text-[13px] text-neutral-800 select-none" role="listbox" aria-label="Traces">
			{items.map((a) => (
				<TraceRow
					key={a.id}
					annotation={a}
					selected={a.id === selectedId}
					open={a.id === openId}
					onOpenChange={onOpenChange}
					onSelect={handleSelect}
					onDelete={handleDelete}
					onOpenThread={onOpenThread}
				/>
			))}
		</div>
	);
}
