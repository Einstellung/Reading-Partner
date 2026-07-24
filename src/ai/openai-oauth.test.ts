import { expect, test } from "bun:test";
import { openaiLoginDeviceCode, parseManualInput } from "./openai-oauth";
import type { DeviceCodeState } from "./device-code";

test("parseManualInput: full redirect URL yields code and state", () => {
	expect(parseManualInput("http://localhost:1455/auth/callback?code=abc123&state=xyz")).toEqual({
		code: "abc123",
		state: "xyz",
	});
});

test("parseManualInput: bare code", () => {
	expect(parseManualInput("  abc123  ")).toEqual({ code: "abc123" });
});

test("parseManualInput: code#state shorthand", () => {
	expect(parseManualInput("abc123#xyz")).toEqual({ code: "abc123", state: "xyz" });
});

test("parseManualInput: query-fragment form code=...&state=...", () => {
	expect(parseManualInput("code=abc123&state=xyz")).toEqual({ code: "abc123", state: "xyz" });
});

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
