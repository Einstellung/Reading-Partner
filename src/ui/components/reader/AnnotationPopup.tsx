// AnnotationPopup: editor shown when an existing annotation is clicked —
// recolor, edit comment, delete. Pure and controlled; styled with Tailwind
// utilities. The parent supplies the anchor in viewport coordinates.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconClose, IconColorSwatch, IconTrash } from '../common/icons';
import { overlayLayerOpen } from '../common/overlay-layer';
import { placePanel, pointAnchor } from '../common/panel-position';
import { useViewportSize } from '../common/useViewportSize';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';
import { OVERLAY_Z, useOverlaySafePadding } from '../ui/overlay';
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
const COMMENT_DEBOUNCE = 400;

// The 9-colour palette is too dense for a full 44px per swatch; a 36px coarse
// target is the practical compromise (the popup widens and the row wraps to
// keep the swatches reachable on touch). Geometry only: the fill and the hover
// come from the ghost variant.
const ICON_BTN = 'h-6 w-6 coarse:h-9 coarse:w-9 rounded active:bg-accent';

export default function AnnotationPopup({ annotation, anchor, colors, onChange, onDelete, onClose }: AnnotationPopupProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const [draft, setDraft] = useState(annotation.comment ?? '');
	// The usable viewport. The comment box is the point of this popup, so the
	// height has to be the visual viewport's: the keyboard that opens when the box
	// is tapped would otherwise cover the popup it was opened from.
	const viewport = useViewportSize();
	// The margin to the viewport edge, per edge: the popup is `fixed`, so the
	// shell's safe-area padding misses it (docs/pitfall/74). No inset means the
	// plain 8px gutter, so this is inert on desktop.
	const margin = useOverlaySafePadding();

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
				margin,
			}),
		);
	}, [anchor.x, anchor.y, annotation.id, viewport, margin]);

	// A press outside closes the popup. pointerdown, not mousedown, and capture:
	// docs/pitfall/67-webkit-tap-does-not-focus-a-button.md. A press while an
	// overlay layer is up belongs to that layer, which is portalled under <body>
	// and so is never inside this ref (common/overlay-layer).
	useEffect(() => {
		function onDown(e: PointerEvent) {
			if (overlayLayerOpen()) return;
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
			className={cn(
				'fixed flex w-60 coarse:w-72 flex-col gap-2 rounded-lg border border-black/10 bg-white p-2.5 text-neutral-800 shadow-xl select-none',
				OVERLAY_Z.floating,
			)}
			style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : { visibility: 'hidden' }}
			role="dialog"
			aria-label="Annotation"
		>
			<div className="flex flex-wrap items-center gap-0.5">
				{colors.map((c) => (
					<Button
						key={c.color}
						type="button"
						variant="ghost"
						size={null}
						className={ICON_BTN + (annotation.color === c.color ? ' ring-2 ring-inset ring-primary' : '')}
						title={c.name}
						aria-label={c.name}
						aria-pressed={annotation.color === c.color}
						onClick={() => onChange(annotation.id, { color: c.color })}
					>
						<IconColorSwatch color={c.color} size={18} />
					</Button>
				))}
				<Button
					type="button"
					variant="ghost"
					size={null}
					className={`${ICON_BTN} ml-auto text-neutral-500`}
					title="Close"
					aria-label="Close"
					onClick={onClose}
				>
					<IconClose size={14} />
				</Button>
			</div>

			<textarea
				className="max-h-40 min-h-[60px] w-full resize-y rounded-md border border-black/15 bg-white px-2 py-1.5 text-[13px] coarse:text-base text-neutral-800 select-text focus:border-primary focus:outline-none"
				placeholder="Add a comment"
				value={draft}
				onChange={(e) => {
					setDraft(e.target.value);
					scheduleCommit(e.target.value);
				}}
				onBlur={() => commit(draft)}
			/>

			<div className="flex items-center justify-end">
				<Button
					type="button"
					variant="ghost"
					size={null}
					className="gap-1 rounded-md px-2 py-1 text-xs text-destructive can-hover:hover:bg-destructive/10 active:bg-destructive/10 coarse:px-3 coarse:py-2.5"
					title="Delete"
					onClick={() => onDelete(annotation.id)}
				>
					<IconTrash size={15} />
					<span>Delete</span>
				</Button>
			</div>
		</div>
	);
}
