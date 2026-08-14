// The one chat scale the app has, held outside React so every window showing a
// conversation reads the same number. There is nothing to keep in step: a single
// value with a subscriber set cannot disagree with itself, which is the whole of
// "the windows stay in sync".
//
// It hydrates itself the first time a component subscribes, so no shell has to
// load it at startup, and writes back debounced — a pinch produces dozens of
// events a second and the file is not worth touching per event.

import { useSyncExternalStore } from 'react';
import { loadDeviceSettings, patchDeviceSettings } from '../../../platform/app/device';
import { CHAT_SCALE_DEFAULT, clampChatScale } from './chat-scale';

const WRITE_DELAY_MS = 400;

let scale = CHAT_SCALE_DEFAULT;
let hydrated = false;
// Whether the user has already chosen a value this session. The stored one is
// read asynchronously, and a wheel that arrives before that read lands is the
// later answer of the two.
let chosen = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

// The live value for code that is not a component — a wheel handler reads it per
// event and must not close over a stale render's copy.
export function currentChatScale(): number {
	return scale;
}

function emit(): void {
	for (const listener of listeners) listener();
}

function hydrate(): void {
	if (hydrated) return;
	hydrated = true;
	loadDeviceSettings()
		.then((device) => {
			const stored = clampChatScale(device.chatScale);
			if (chosen || stored === scale) return;
			scale = stored;
			emit();
		})
		.catch(() => {});
}

function subscribe(listener: () => void): () => void {
	hydrate();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useChatScale(): number {
	return useSyncExternalStore(subscribe, currentChatScale);
}

export function setChatScale(next: number): void {
	const value = clampChatScale(next);
	chosen = true;
	if (value === scale) return;
	scale = value;
	emit();
	if (writeTimer !== null) clearTimeout(writeTimer);
	writeTimer = setTimeout(() => {
		writeTimer = null;
		// A patch, not a whole-object save: the settings screen owns other fields
		// of the same file and holds its own copy of them.
		patchDeviceSettings({ chatScale: scale }).catch(() => {});
	}, WRITE_DELAY_MS);
}
