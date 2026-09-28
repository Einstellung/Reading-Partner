// AnnotationPopup: editor shown when an existing annotation is clicked — edit
// comment, delete. A mark keeps the color it was drawn in; nothing here changes
// it. Pure and controlled; styled with Tailwind utilities. The parent supplies
// the anchor in viewport coordinates.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n';
import { IconClose, IconTrash } from '../base/icons';
import { placePanel, pointAnchor } from '../common/panel-position';
import { useViewportSize } from '../common/useViewportSize';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';
import { OVERLAY_Z, useCloseOnOutsidePress, useOverlaySafePadding } from '../ui/overlay';
import type { Annotation } from './types';

interface AnnotationPopupProps {
	annotation: Annotation;
	anchor: { x: number; y: number };
	onChange(id: string, patch: { comment: string }): void;
	onDelete(id: string): void;
	onClose(): void;
}

const GAP = 10;
const COMMENT_DEBOUNCE = 400;

export default function AnnotationPopup({ annotation, anchor, onChange, onDelete, onClose }: AnnotationPopupProps) {
	const t = useT();
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

	useCloseOnOutsidePress(ref, onClose);

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
				'fixed flex w-60 coarse:w-72 flex-col gap-2 rounded-lg border border-black/10 bg-popover p-2.5 text-neutral-800 shadow-xl select-none',
				OVERLAY_Z.floating,
			)}
			style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : { visibility: 'hidden' }}
			role="dialog"
			aria-label={t("reader.popup.title")}
		>
			<div className="flex items-center justify-end">
				<Button
					type="button"
					variant="ghost"
					size={null}
					className="h-6 w-6 coarse:h-9 coarse:w-9 rounded active:bg-accent text-neutral-500"
					title={t("reader.popup.close")}
					aria-label={t("reader.popup.close")}
					onClick={onClose}
				>
					<IconClose size={14} />
				</Button>
			</div>

			<textarea
				className="max-h-40 min-h-[60px] w-full resize-y rounded-md border border-black/15 bg-background px-2 py-1.5 text-[13px] coarse:text-base text-neutral-800 select-text focus:border-accent-line focus:outline-none"
				placeholder={t("reader.popup.commentPlaceholder")}
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
					title={t("reader.popup.delete")}
					onClick={() => onDelete(annotation.id)}
				>
					<IconTrash size={15} />
					<span>{t("reader.popup.delete")}</span>
				</Button>
			</div>
		</div>
	);
}
