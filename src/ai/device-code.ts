// Everything about the OpenAI (ChatGPT) device-code login flow that carries no
// network: the states the UI renders, and the RFC 8628 poll loop. The HTTP calls
// and the credential store live in openai-oauth.ts, which injects `poll` here.

// What the device-code endpoint hands back for the user to act on.
export interface DeviceCodeInfo {
	userCode: string;
	verificationUri: string;
	intervalSeconds?: number;
	expiresInSeconds?: number;
}

export type DeviceCodeState =
	// Requesting the user code from auth.openai.com.
	| { status: "starting" }
	// User code issued: show it, plus the verification URL to open, and when it
	// expires. We are now polling for authorization.
	| { status: "awaiting"; userCode: string; verificationUri: string; expiresAt: number | null }
	// Authorized and credentials stored.
	| { status: "success" }
	// User cancelled (or the poll loop reported the flow as cancelled).
	| { status: "cancelled" }
	// Flow failed. `canPaste` marks the "device code not enabled for this account"
	// case, where the UI should offer the paste-the-URL fallback instead.
	| { status: "error"; message: string; canPaste: boolean };

// Map the issued device code to the awaiting state. `now` is injectable so the
// computed absolute expiry is deterministic in tests.
export function awaitingState(info: DeviceCodeInfo, now: number = Date.now()): DeviceCodeState {
	return {
		status: "awaiting",
		userCode: info.userCode,
		verificationUri: info.verificationUri,
		expiresAt:
			typeof info.expiresInSeconds === "number" ? now + info.expiresInSeconds * 1000 : null,
	};
}

// Classify a thrown error (or an abort) into a terminal state. The flow throws
// "Login cancelled" on abort and a "device code login is not enabled" message
// when the account/workspace has the flow switched off; that second case is the
// one where the paste fallback still works, so it gets canPaste.
export function classifyDeviceCodeError(err: unknown, aborted: boolean): DeviceCodeState {
	const message = err instanceof Error ? err.message : String(err);
	if (aborted || /cancel/i.test(message)) return { status: "cancelled" };
	const canPaste = /not enabled|device code|device auth/i.test(message);
	return {
		status: "error",
		message: canPaste
			? "Device sign-in is not enabled for this account. Paste the sign-in URL instead."
			: message,
		canPaste,
	};
}

// Wording matters: classifyDeviceCodeError reads these back off the thrown error.
const DEVICE_CODE_CANCELLED = "Login cancelled";
const DEVICE_CODE_TIMED_OUT = "Device flow timed out";

// One poll of the authorization endpoint: still waiting, told to back off,
// finished, or dead.
export type DeviceCodePoll<T> =
	| { status: "pending" }
	| { status: "slow_down"; intervalSeconds?: number }
	| { status: "failed"; message: string }
	| { status: "complete"; value: T };

export interface PollDeviceCodeOptions<T> {
	// Server-advised seconds between polls. RFC 8628 section 3.2: 5 when absent.
	intervalSeconds?: number;
	expiresInSeconds: number;
	poll(): Promise<DeviceCodePoll<T>>;
	signal?: AbortSignal;
	// Injected clock and delay so the loop is testable without real time.
	now?(): number;
	sleep?(ms: number): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MIN_POLL_INTERVAL_MS = 1000;
// RFC 8628 section 3.5: a slow_down means back off by another 5 seconds.
const SLOW_DOWN_INCREMENT_MS = 5000;

// A delay that gives up the moment the user cancels, so an abort during the gap
// between polls is not held for a further interval.
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error(DEVICE_CODE_CANCELLED));
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error(DEVICE_CODE_CANCELLED));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Poll `poll` until it completes, fails, or the code expires. Backs off on
 * slow_down, preferring a server-supplied interval over the client's own count
 * (a drifting clock would otherwise poll early forever). Throws on cancel,
 * timeout, or a failed poll — {@link classifyDeviceCodeError} turns those into
 * terminal states.
 */
export async function pollDeviceCode<T>(options: PollDeviceCodeOptions<T>): Promise<T> {
	const now = options.now ?? (() => Date.now());
	const sleep = options.sleep ?? ((ms: number) => abortableSleep(ms, options.signal));
	const deadline = now() + options.expiresInSeconds * 1000;
	let intervalMs = Math.max(
		MIN_POLL_INTERVAL_MS,
		Math.floor((options.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000),
	);

	while (now() < deadline) {
		if (options.signal?.aborted) throw new Error(DEVICE_CODE_CANCELLED);

		const result = await options.poll();
		if (result.status === "complete") return result.value;
		if (result.status === "failed") throw new Error(result.message);
		if (result.status === "slow_down") {
			intervalMs =
				result.intervalSeconds && result.intervalSeconds > 0
					? Math.max(MIN_POLL_INTERVAL_MS, Math.floor(result.intervalSeconds * 1000))
					: intervalMs + SLOW_DOWN_INCREMENT_MS;
		}

		const remaining = deadline - now();
		if (remaining <= 0) break;
		await sleep(Math.min(intervalMs, remaining));
	}

	throw new Error(DEVICE_CODE_TIMED_OUT);
}
