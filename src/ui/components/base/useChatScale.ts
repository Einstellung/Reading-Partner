// The one chat scale the app has, held outside React so every window showing a
// conversation reads the same number: one value with a subscriber set cannot
// disagree with itself.

import { useSyncExternalStore } from 'react';
import { loadDeviceSettings, patchDeviceSettings } from '../../../platform/app/device';
import { CHAT_SCALE_DEFAULT, clampChatScale } from './chat-scale';

// A pinch is dozens of events a second, and none of them is worth a write.
const WRITE_DELAY_MS = 400;

let scale = CHAT_SCALE_DEFAULT;
let hydrated = false;
// Whether the user has set a value this session. The stored one is read
// asynchronously, and a choice made while that read was in flight is the later
// of the two answers.
let chosen = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

// The live value for code that is not a component: a wheel handler reads it per
// event and must not close over a render's copy.
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

// Hydrates on the first subscriber, so no shell has to load the scale at startup.
export function subscribeChatScale(listener: () => void): () => void {
	hydrate();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useChatScale(): number {
	return useSyncExternalStore(subscribeChatScale, currentChatScale);
}

// A value the user chose, written even when memory already held it: memory
// starts at the default and the stored value may still be on its way, so a reset
// that skipped the write would be back at the old size on the next launch.
export function setChatScale(next: number): void {
	const value = clampChatScale(next);
	chosen = true;
	if (value !== scale) {
		scale = value;
		emit();
	}
	if (writeTimer !== null) clearTimeout(writeTimer);
	writeTimer = setTimeout(() => {
		writeTimer = null;
		// A patch: the settings screen owns other fields of the same file.
		patchDeviceSettings({ chatScale: scale }).catch(() => {});
	}, WRITE_DELAY_MS);
}

// Tests only: all of this is module state and outlives a single case.
export function resetChatScale(): void {
	if (writeTimer !== null) clearTimeout(writeTimer);
	writeTimer = null;
	scale = CHAT_SCALE_DEFAULT;
	hydrated = false;
	chosen = false;
	listeners.clear();
}
