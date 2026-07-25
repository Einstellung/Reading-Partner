// Toast stack for failure messages that used to live forever in the header
// status string. Bottom-center, above the reader (z-0) but below the call
// overlays (z-40/z-50) so a full-window call is never covered by a toast about
// something that happened before it opened.

import { useCallback, useState } from 'react';
import { IconClose } from './icons';

export type ToastKind = 'warn' | 'error';

export interface ToastItem {
	id: string;
	kind: ToastKind;
	message: string;
}

const DISMISS_MS = 5000;

// App owns the list via this hook; Toast below only renders it.
export function useToasts() {
	const [toasts, setToasts] = useState<ToastItem[]>([]);

	const dismiss = useCallback((id: string) => {
		setToasts((cur) => cur.filter((t) => t.id !== id));
	}, []);

	const push = useCallback(
		(kind: ToastKind, message: string) => {
			const id = crypto.randomUUID();
			setToasts((cur) => [...cur, { id, kind, message }]);
			window.setTimeout(() => dismiss(id), DISMISS_MS);
		},
		[dismiss],
	);

	return { toasts, push, dismiss };
}

const KIND_CLASS: Record<ToastKind, string> = {
	warn: 'border-amber-300 bg-amber-50 text-amber-800',
	error: 'border-red-300 bg-red-50 text-red-800',
};

export default function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss(id: string): void }) {
	if (toasts.length === 0) return null;
	return (
		<div className="pointer-events-none fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
			{toasts.map((t) => (
				<div
					key={t.id}
					role="alert"
					className={`pointer-events-auto flex max-w-[420px] items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-md ${KIND_CLASS[t.kind]}`}
				>
					<span className="flex-1">{t.message}</span>
					<button
						type="button"
						aria-label="Dismiss"
						onClick={() => onDismiss(t.id)}
						className="flex shrink-0 items-center justify-center opacity-60 hover:opacity-100 coarse:h-9 coarse:w-9"
					>
						<IconClose size={12} />
					</button>
				</div>
			))}
		</div>
	);
}
