// AnnotationPopup: editor shown when an existing annotation is clicked —
// recolor, edit comment, delete. Pure and controlled; styled with Tailwind
// utilities. The parent supplies the anchor in viewport coordinates.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconClose, IconColorSwatch, IconTrash } from '../common/icons';
import { placePanel, pointAnchor } from '../common/panel-position';
import { useViewportSize } from '../common/useViewportSize';
import type { Annotation, ColorEntry } from '../common/types';

interface AnnotationPopupProps {
	annotation: Annotation;
	anchor: { x: number; y: number };
	colors: ColorEntry[];
	onChange(id: string, patch: { color?: string; comment?: string }): void;
	onDelete(id: string): void;
	onClose(): void;
}

const GAP = 10;
const MARGIN = 8;
const COMMENT_DEBOUNCE = 400;

// The 9-colour palette is too dense for a full 44px per swatch; a 36px coarse
// target is the practical compromise (the popup widens and the row wraps to
// keep the swatches reachable on touch).
const ICON_BTN =
	'flex h-6 w-6 coarse:h-9 coarse:w-9 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 can-hover:hover:bg-black/5 active:bg-black/5';

export default function AnnotationPopup({ annotation, anchor, colors, onChange, onDelete, onClose }: AnnotationPopupProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const [draft, setDraft] = useState(annotation.comment ?? '');
	// The usable viewport. The comment box is the point of this popup, so the
	// height has to be the visual viewport's: the keyboard that opens when the box
	// is tapped would otherwise cover the popup it was opened from.
	const viewport = useViewportSize();

	// Keep the draft in sync if a different annotation is shown in the same popup.
	useEffect(() => {
		setDraft(annotation.comment ?? '');
	}, [annotation.id]);

	// Position near the anchor, flipping above when it would overflow the bottom
	// and clamping to the viewport. Re-run when the keyboard opens or the device
	// rotates, both of which change the viewport under a popup already placed.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		setPos(
			placePanel({
				anchor: pointAnchor(anchor.x, anchor.y),
				panel: { width, height },
				viewport,
				gap: GAP,
				margin: MARGIN,
			}),
		);
	}, [anchor.x, anchor.y, annotation.id, viewport]);

	// A press outside closes the popup. pointerdown, not mousedown, and capture:
	// docs/pitfall/67-webkit-tap-does-not-focus-a-button.md.
	useEffect(() => {
		function onDown(e: PointerEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		}
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	}, [onClose]);

	// Debounced comment commit; flushed on blur.
	const timer = useRef<number | undefined>(undefined);
	const committed = useRef(annotation.comment ?? '');
	function scheduleCommit(value: string) {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => commit(value), COMMENT_DEBOUNCE);
	}
	function commit(value: string) {
		window.clearTimeout(timer.current);
		if (value !== committed.current) {
			committed.current = value;
			onChange(annotation.id, { comment: value });
		}
	}
	useEffect(() => () => window.clearTimeout(timer.current), []);

	return (
		<div
			ref={ref}
			className="fixed z-[1000] flex w-60 coarse:w-72 flex-col gap-2 rounded-lg border border-black/10 bg-white p-2.5 text-neutral-800 shadow-xl select-none"
			style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : { visibility: 'hidden' }}
			role="dialog"
			aria-label="Annotation"
		>
			<div className="flex flex-wrap items-center gap-0.5">
				{colors.map((c) => (
					<button
						key={c.color}
						type="button"
						className={ICON_BTN + (annotation.color === c.color ? ' ring-2 ring-inset ring-sky-600' : '')}
						title={c.name}
						aria-label={c.name}
						aria-pressed={annotation.color === c.color}
						onClick={() => onChange(annotation.id, { color: c.color })}
					>
						<IconColorSwatch color={c.color} size={18} />
					</button>
				))}
				<button
					type="button"
					className={`${ICON_BTN} ml-auto text-neutral-500`}
					title="Close"
					aria-label="Close"
					onClick={onClose}
				>
					<IconClose size={14} />
				</button>
			</div>

			<textarea
				className="max-h-40 min-h-[60px] w-full resize-y rounded-md border border-black/15 bg-white px-2 py-1.5 text-[13px] coarse:text-base text-neutral-800 select-text focus:border-sky-600 focus:outline-none"
				placeholder="Add a comment"
				value={draft}
				onChange={(e) => {
					setDraft(e.target.value);
					scheduleCommit(e.target.value);
				}}
				onBlur={() => commit(draft)}
			/>

			<div className="flex items-center justify-end">
				<button
					type="button"
					className="inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1 text-xs text-red-700 can-hover:hover:bg-red-700/10 active:bg-red-700/10 coarse:px-3 coarse:py-2.5"
					title="Delete"
					onClick={() => onDelete(annotation.id)}
				>
					<IconTrash size={15} />
					<span>Delete</span>
				</button>
			</div>
		</div>
	);
}
