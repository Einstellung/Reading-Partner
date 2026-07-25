// The device-code login orchestration: which states it emits, in which order.
// parseManualInput lives in platform/app/oauth and is covered in
// tests/ai/openai-oauth.test.ts. Run: bun test.

import { expect, test } from "bun:test";
import { openaiLoginDeviceCode } from "./openai-oauth";
import type { DeviceCodeState } from "./device-code";

test("openaiLoginDeviceCode: starting -> awaiting -> error when login rejects", async () => {
	const states: DeviceCodeState[] = [];
	await openaiLoginDeviceCode({
		onState: (s) => states.push(s),
		login: async ({ onDeviceCode }) => {
			onDeviceCode({
				userCode: "AB-12",
				verificationUri: "https://auth.openai.com/codex/device",
				expiresInSeconds: 900,
			});
			throw new Error("HTTP 500: boom");
		},
	});
	expect(states.map((s) => s.status)).toEqual(["starting", "awaiting", "error"]);
	const awaiting = states[1];
	expect(awaiting.status === "awaiting" && awaiting.userCode).toBe("AB-12");
	const terminal = states[2];
	expect(terminal.status === "error" && terminal.canPaste).toBe(false);
});

test("openaiLoginDeviceCode: an aborted signal ends in cancelled", async () => {
	const controller = new AbortController();
	const states: DeviceCodeState[] = [];
	await openaiLoginDeviceCode({
		signal: controller.signal,
		onState: (s) => states.push(s),
		login: async ({ signal }) => {
			controller.abort();
			throw new Error(signal?.aborted ? "Login cancelled" : "unexpected");
		},
	});
	expect(states.map((s) => s.status)).toEqual(["starting", "cancelled"]);
});

test("openaiLoginDeviceCode: a 'not enabled' rejection surfaces the paste fallback", async () => {
	const states: DeviceCodeState[] = [];
	await openaiLoginDeviceCode({
		onState: (s) => states.push(s),
		login: async () => {
			throw new Error("OpenAI Codex device code login is not enabled for this server.");
		},
	});
	const terminal = states[states.length - 1];
	expect(terminal.status).toBe("error");
	expect(terminal.status === "error" && terminal.canPaste).toBe(true);
});
