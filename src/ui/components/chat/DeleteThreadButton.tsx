// A two-step inline delete control for a chat header (docs/03). Deleting a
// conversation is destructive, so it arms on the first click (a trash icon turns
// into a red "Confirm delete") and only fires on the second. A press anywhere
// else disarms it, as does Escape. No modal, matching the app's lightweight
// inline confirmations. Tailwind-only.
//
// Dismissal cannot hang off the armed button's own blur: WebKit does not focus a
// button when it is tapped, so the confirming tap blurred it first and the
// delete never ran — docs/pitfall/67-webkit-tap-does-not-focus-a-button.md.

import { useEffect, useRef, useState } from 'react';
import { IconTrash } from '../common/icons';

interface DeleteThreadButtonProps {
	onDelete(): void;
}

export default function DeleteThreadButton({ onDelete }: DeleteThreadButtonProps) {
	const [armed, setArmed] = useState(false);
	const confirmRef = useRef<HTMLButtonElement>(null);

	// Move focus onto the confirm button so a keyboard can finish what it started.
	useEffect(() => {
		if (armed) confirmRef.current?.focus();
	}, [armed]);

	// A press that lands outside cancels the intent. Capture phase, so a control
	// that stops propagation still disarms; the press that armed the button is
	// already over by the time this listener exists, since arming runs off click.
	useEffect(() => {
		if (!armed) return;
		function onPointerDown(e: PointerEvent) {
			if (!confirmRef.current?.contains(e.target as Node)) setArmed(false);
		}
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') setArmed(false);
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [armed]);

	if (!armed) {
		return (
			<button
				type="button"
				title="Delete conversation"
				aria-label="Delete conversation"
				onClick={() => setArmed(true)}
				className="flex h-6 w-6 coarse:h-11 coarse:w-11 items-center justify-center rounded-md text-neutral-400 hover:bg-red-700/10 hover:text-red-700"
			>
				<IconTrash size={15} />
			</button>
		);
	}

	return (
		<button
			ref={confirmRef}
			type="button"
			title="Confirm delete"
			aria-label="Confirm delete"
			onClick={onDelete}
			className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium leading-none text-white hover:bg-red-700 coarse:px-3 coarse:py-2.5"
		>
			Confirm delete
		</button>
	);
}
