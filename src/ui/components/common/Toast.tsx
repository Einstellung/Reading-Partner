// Toast stack for failure messages that used to live forever in the header
// status string. Bottom-center, above the reader (z-0) but below the call
// overlays (z-40/z-50) so a full-window call is never covered by a toast about
// something that happened before it opened.
//
// The list is the app's (this hook), the box and the countdown are Radix's
// (ui/toast.tsx). Both call sites (App, PhoneApp) render one of these.

import { useCallback, useState } from 'react';
import { IconClose } from './icons';
import { addToast, DISMISS_MS, removeToast, type ToastItem, type ToastKind } from './toast-list';
import { Toast as ToastBox, ToastClose, ToastDescription, ToastProvider, ToastViewport } from '../ui/toast';

export type { ToastItem, ToastKind };

// App owns the list via this hook; Toast below only renders it.
export function useToasts() {
	const [toasts, setToasts] = useState<ToastItem[]>([]);

	const dismiss = useCallback((id: string) => {
		setToasts((cur) => removeToast(cur, id));
	}, []);

	// No timer here: the countdown belongs to the toast that is showing, so it can
	// be paused while it is under the pointer and resumed after.
	const push = useCallback((kind: ToastKind, message: string) => {
		setToasts((cur) => addToast(cur, { id: crypto.randomUUID(), kind, message }));
	}, []);

	return { toasts, push, dismiss };
}

export default function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss(id: string): void }) {
	return (
		<ToastProvider duration={DISMISS_MS} swipeDirection="right">
			<ToastViewport>
				{toasts.map((t) => (
					<ToastBox
						key={t.id}
						kind={t.kind}
						// Controlled: the countdown, a swipe and the close button all
						// arrive here as the same close, and the list is the one state.
						open
						onOpenChange={(open) => {
							if (!open) onDismiss(t.id);
						}}
					>
						<ToastDescription>{t.message}</ToastDescription>
						<ToastClose aria-label="Dismiss">
							<IconClose size={12} />
						</ToastClose>
					</ToastBox>
				))}
			</ToastViewport>
		</ToastProvider>
	);
}
