import { expect, test } from "bun:test";
import { awaitingState, classifyDeviceCodeError } from "./device-code";

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
