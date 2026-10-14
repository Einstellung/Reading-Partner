// The keep-awake wrapper (src/platform/app/keep-awake.ts) against a fake host.
// The lock itself is the operating system's (src-tauri/src/keep_awake.rs) and
// was checked there with `systemd-inhibit --list`. Run: bun test.

import { expect, test } from "bun:test";
import { keepAwake } from "../../../src/platform/app/keep-awake";

function fake(acquired: unknown, fail = false) {
	const calls: { cmd: string; args: Record<string, unknown> }[] = [];
	const call = async <T>(cmd: string, args: Record<string, unknown>): Promise<T> => {
		calls.push({ cmd, args });
		if (fail) throw new Error("command keep_awake_acquire not found");
		return (cmd === "keep_awake_acquire" ? acquired : true) as T;
	};
	return { call, calls };
}

test("a held lock is released once, however often release is called", async () => {
	const { call, calls } = fake({ held: true, id: 3, detail: null });
	const lock = await keepAwake("topic search", call);
	expect(lock.held).toBe(true);
	await lock.release();
	await lock.release();
	expect(calls).toEqual([
		{ cmd: "keep_awake_acquire", args: { reason: "topic search" } },
		{ cmd: "keep_awake_release", args: { id: 3 } },
	]);
});

test("a refusal says why and releases nothing", async () => {
	const { call, calls } = fake({ held: false, id: null, detail: "logind refused the inhibitor" });
	const lock = await keepAwake("topic search", call);
	expect(lock).toMatchObject({ held: false, detail: "logind refused the inhibitor" });
	await lock.release();
	expect(calls.map((c) => c.cmd)).toEqual(["keep_awake_acquire"]);
});

test("no host behind it is not held, and does not throw", async () => {
	const { call } = fake(null, true);
	const lock = await keepAwake("topic search", call);
	expect(lock.held).toBe(false);
	expect(lock.detail).toContain("not found");
	await lock.release();
});
