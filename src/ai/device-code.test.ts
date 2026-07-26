import { expect, test } from "bun:test";
import {
	awaitingState,
	classifyDeviceCodeError,
	pollDeviceCode,
	type DeviceCodePoll,
} from "./device-code";

// Drive the loop on a fake clock: `sleep` advances it instead of waiting, so a
// 15-minute deadline and 5-second intervals cost nothing.
function fakeClock() {
	let t = 0;
	const slept: number[] = [];
	return {
		slept,
		now: () => t,
		sleep: async (ms: number) => {
			slept.push(ms);
			t += ms;
		},
	};
}

function scripted<T>(results: DeviceCodePoll<T>[]): () => Promise<DeviceCodePoll<T>> {
	let i = 0;
	return async () => results[Math.min(i++, results.length - 1)]!;
}

test("awaitingState computes absolute expiry from expiresInSeconds against injected now", () => {
	const s = awaitingState(
		{ userCode: "ABCD-1234", verificationUri: "https://auth.openai.com/codex/device", expiresInSeconds: 900 },
		1_000,
	);
	expect(s).toEqual({
		status: "awaiting",
		userCode: "ABCD-1234",
		verificationUri: "https://auth.openai.com/codex/device",
		expiresAt: 1_000 + 900_000,
	});
});

test("awaitingState expiresAt is null when the server omits expiresInSeconds", () => {
	const s = awaitingState({ userCode: "X", verificationUri: "https://y" }, 0);
	expect(s.status === "awaiting" && s.expiresAt).toBe(null);
});

test("classifyDeviceCodeError: aborted flag wins regardless of message", () => {
	expect(classifyDeviceCodeError(new Error("anything"), true)).toEqual({ status: "cancelled" });
});

test("classifyDeviceCodeError: pi-ai 'Login cancelled' maps to cancelled", () => {
	expect(classifyDeviceCodeError(new Error("Login cancelled"), false)).toEqual({ status: "cancelled" });
});

test("classifyDeviceCodeError: 'not enabled' error offers the paste fallback", () => {
	const s = classifyDeviceCodeError(
		new Error("OpenAI Codex device code login is not enabled for this server."),
		false,
	);
	expect(s.status === "error" && s.canPaste).toBe(true);
	expect(s.status === "error" && /paste/i.test(s.message)).toBe(true);
});

test("classifyDeviceCodeError: generic failure surfaces its message and does not offer paste", () => {
	expect(classifyDeviceCodeError(new Error("HTTP 500: boom"), false)).toEqual({
		status: "error",
		message: "HTTP 500: boom",
		canPaste: false,
	});
});

test("classifyDeviceCodeError: non-Error values are stringified", () => {
	const s = classifyDeviceCodeError("plain string failure", false);
	expect(s.status === "error" && s.message).toBe("plain string failure");
});

test("pollDeviceCode polls at the server's interval until it completes", async () => {
	const clock = fakeClock();
	const value = await pollDeviceCode({
		intervalSeconds: 3,
		expiresInSeconds: 900,
		poll: scripted([{ status: "pending" }, { status: "pending" }, { status: "complete", value: "ok" }]),
		...clock,
	});
	expect(value).toBe("ok");
	expect(clock.slept).toEqual([3000, 3000]);
});

test("pollDeviceCode floors the interval at a second and defaults it to five", async () => {
	const fast = fakeClock();
	await pollDeviceCode({
		intervalSeconds: 0,
		expiresInSeconds: 900,
		poll: scripted([{ status: "pending" }, { status: "complete", value: 1 }]),
		...fast,
	});
	expect(fast.slept).toEqual([1000]);

	const unset = fakeClock();
	await pollDeviceCode({
		expiresInSeconds: 900,
		poll: scripted([{ status: "pending" }, { status: "complete", value: 1 }]),
		...unset,
	});
	expect(unset.slept).toEqual([5000]);
});

test("pollDeviceCode backs off five more seconds per slow_down", async () => {
	const clock = fakeClock();
	await pollDeviceCode({
		intervalSeconds: 2,
		expiresInSeconds: 900,
		poll: scripted([
			{ status: "slow_down" },
			{ status: "slow_down" },
			{ status: "complete", value: 1 },
		]),
		...clock,
	});
	expect(clock.slept).toEqual([7000, 12000]);
});

test("pollDeviceCode prefers a server-supplied slow_down interval over its own count", async () => {
	const clock = fakeClock();
	await pollDeviceCode({
		intervalSeconds: 2,
		expiresInSeconds: 900,
		poll: scripted([{ status: "slow_down", intervalSeconds: 30 }, { status: "complete", value: 1 }]),
		...clock,
	});
	expect(clock.slept).toEqual([30000]);
});

test("pollDeviceCode times out once the code expires, never sleeping past it", async () => {
	const clock = fakeClock();
	await expect(
		pollDeviceCode({
			intervalSeconds: 4,
			expiresInSeconds: 10,
			poll: scripted([{ status: "pending" }]),
			...clock,
		}),
	).rejects.toThrow("Device flow timed out");
	expect(clock.slept).toEqual([4000, 4000, 2000]);
});

test("pollDeviceCode turns a failed poll into its reported message", async () => {
	await expect(
		pollDeviceCode({
			expiresInSeconds: 900,
			poll: scripted([{ status: "failed", message: "device auth failed (HTTP 500)" }]),
			...fakeClock(),
		}),
	).rejects.toThrow("device auth failed (HTTP 500)");
});

test("pollDeviceCode stops on an aborted signal before polling again", async () => {
	const controller = new AbortController();
	let polls = 0;
	await expect(
		pollDeviceCode({
			expiresInSeconds: 900,
			signal: controller.signal,
			poll: async () => {
				polls++;
				controller.abort();
				return { status: "pending" };
			},
			...fakeClock(),
		}),
	).rejects.toThrow("Login cancelled");
	expect(polls).toBe(1);
});
