// Keep the machine from sleeping on idle for the length of a long unattended
// run (docs/info/88: the collector's nightly reading), from this side
// (src-tauri/src/keep_awake.rs).
//
// Linux takes a logind `sleep:idle` inhibitor, macOS an IOKit
// PreventUserIdleSystemSleep assertion. Closing the lid or choosing Sleep still
// sleeps the machine. The lock goes when it is released or when the app exits,
// whichever comes first.
//
// Never throws: a run that could not keep the machine awake still runs, and the
// answer says why it is not held. Where there is no such host (a phone, Windows,
// a plain browser) the lock is simply not held.

import { invoke } from "@tauri-apps/api/core";

export interface KeepAwakeLock {
	/** Whether the machine is being kept awake on this caller's behalf. */
	held: boolean;
	/** Why it is not held, when it is not. */
	detail: string | null;
	/** Give the lock back. Safe to call more than once. */
	release(): Promise<void>;
}

type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

interface Acquired {
	held: boolean;
	id: number | null;
	detail: string | null;
}

/**
 * Hold off idle sleep until `release()`. `reason` is what the system's own
 * tools show for the lock (`systemd-inhibit --list`, `pmset -g assertions`).
 */
export async function keepAwake(reason: string, call: Invoke = invoke): Promise<KeepAwakeLock> {
	let got: Acquired;
	try {
		got = await call<Acquired>("keep_awake_acquire", { reason });
	} catch (err) {
		return { held: false, detail: err instanceof Error ? err.message : String(err), release: async () => {} };
	}
	const id = got.held ? got.id : null;
	let released = id === null;
	return {
		held: id !== null,
		detail: got.detail,
		async release() {
			if (released) return;
			released = true;
			try {
				await call<boolean>("keep_awake_release", { id });
			} catch {
				// The app going away releases it anyway.
			}
		},
	};
}
