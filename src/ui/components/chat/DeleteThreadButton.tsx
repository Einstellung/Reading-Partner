// A two-step inline delete control for a chat header (docs/03). Deleting a
// conversation is destructive, so it arms on the first click (a trash icon turns
// into a red "Confirm delete") and only fires on the second. Clicking away
// disarms it — the armed button auto-focuses so a blur cancels the intent. No
// modal, matching the app's lightweight inline confirmations. Tailwind-only.

import { useEffect, useRef, useState } from 'react';
import { IconTrash } from '../common/icons';

interface DeleteThreadButtonProps {
	onDelete(): void;
}

export default function DeleteThreadButton({ onDelete }: DeleteThreadButtonProps) {
	const [armed, setArmed] = useState(false);
	const confirmRef = useRef<HTMLButtonElement>(null);

	// Move focus onto the confirm button so clicking anywhere else blurs it and
	// cancels — no timer, no outside-click listener of our own.
	useEffect(() => {
		if (armed) confirmRef.current?.focus();
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
			onBlur={() => setArmed(false)}
			className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium leading-none text-white hover:bg-red-700 coarse:px-3 coarse:py-2.5"
		>
			Confirm delete
		</button>
	);
}
