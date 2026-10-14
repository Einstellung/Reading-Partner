// The browse-session wrapper (src/workshop/extract/webview-browse.ts) against a
// fake host: which command each call becomes, with which arguments, and what a
// refused open looks like. The page itself is Rust's (browse.rs) and does not
// run here. Run: bun test.

import { expect, test } from "bun:test";
import { openBrowse, type BrowseHost } from "../../../src/workshop/extract/webview-browse";

function fakeHost(answers: Record<string, unknown>, available = true) {
	const calls: { cmd: string; args: Record<string, unknown> }[] = [];
	const host: BrowseHost = {
		available: () => available,
		invoke: async <T>(cmd: string, args: Record<string, unknown>) => {
			calls.push({ cmd, args });
			return answers[cmd] as T;
		},
	};
	return { host, calls };
}

test("no browser here is an answer, not a call", async () => {
	const { host, calls } = fakeHost({}, false);
	const opened = await openBrowse({}, host);
	expect(opened.status).toBe("unsupported");
	expect(calls).toEqual([]);
});

test("a second session is refused with the host's reason", async () => {
	const { host } = fakeHost({ browse_open: { status: "busy", session: null, detail: "browse session 3 is open" } });
	const opened = await openBrowse({}, host);
	expect(opened).toEqual({ status: "busy", detail: "browse session 3 is open" });
});

test("every call names the session it was opened with", async () => {
	const load = { status: "ok", url: "https://x.com/search?q=a", title: "", loaded: false, value: 7, error: null, elapsedMs: 900, detail: null };
	const { host, calls } = fakeHost({
		browse_open: { status: "ok", session: 4, detail: null },
		browse_navigate: load,
		browse_back: load,
		browse_eval: { status: "ok", url: null, title: null, value: 1, error: null, elapsedMs: 1, detail: null },
		browse_scroll: { status: "ok", before: 0, after: 600, height: 4000, viewport: 900, detail: null },
		browse_close: true,
	});
	const opened = await openBrowse({ idleTimeoutMs: 90_000, viewport: { width: 1440, height: 2400 } }, host);
	expect(opened.status).toBe("ok");
	if (opened.status !== "ok") return;
	const page = opened.session;
	expect(page.id).toBe(4);

	expect((await page.navigate("https://x.com/search?q=a", { until: "1" })).value).toBe(7);
	await page.back();
	await page.evaluate("document.title", { timeoutMs: 2000 });
	expect((await page.scrollBy(600)).after).toBe(600);
	expect(await page.close()).toBe(true);

	expect(calls).toEqual([
		{ cmd: "browse_open", args: { idleTimeoutMs: 90_000, viewport: [1440, 2400] } },
		{ cmd: "browse_navigate", args: { session: 4, url: "https://x.com/search?q=a", until: "1", timeoutMs: null } },
		{ cmd: "browse_back", args: { session: 4, until: null, timeoutMs: null } },
		{ cmd: "browse_eval", args: { session: 4, script: "document.title", timeoutMs: 2000 } },
		{ cmd: "browse_scroll", args: { session: 4, dy: 600 } },
		{ cmd: "browse_close", args: { session: 4 } },
	]);
});

test("a scroll that is not a distance never reaches the host", async () => {
	const { host, calls } = fakeHost({ browse_open: { status: "ok", session: 1, detail: null } });
	const opened = await openBrowse({}, host);
	if (opened.status !== "ok") throw new Error("not opened");
	await expect(opened.session.scrollBy(Number.NaN)).rejects.toThrow("not a scroll distance");
	expect(calls.map((c) => c.cmd)).toEqual(["browse_open"]);
});
