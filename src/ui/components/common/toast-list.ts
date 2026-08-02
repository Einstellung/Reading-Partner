// The toast list, apart from React. Radix owns the timer (ui/toast.tsx passes
// DISMISS_MS as the Root's duration and calls back when it elapses), so all that
// is left here is the list and the identity of the entries in it.

export type ToastKind = "warn" | "error";

export interface ToastItem {
	id: string;
	kind: ToastKind;
	message: string;
}

// Unchanged from the hand-written toast. Radix pauses this countdown while the
// pointer is over the stack and while the window is not focused.
export const DISMISS_MS = 5000;

export function addToast(list: ToastItem[], toast: ToastItem): ToastItem[] {
	return [...list, toast];
}

// By id, not by position: the countdown that fires belongs to one entry, and
// entries above it may already be gone.
export function removeToast(list: ToastItem[], id: string): ToastItem[] {
	return list.filter((t) => t.id !== id);
}
