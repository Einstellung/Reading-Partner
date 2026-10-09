// What a transcript's render changed, as its scroll position cares
// (src/ui/components/chat/list-change.ts). The one that matters most: a list
// whose history is still arriving is opening, not receiving news, or a chat that
// loads its rows after mounting would stop following the settling and open
// mid-history.

import { expect, test } from "bun:test";
import { listChange, snapshotOf } from "../../../../src/ui/components/chat/list-change";
import type { ThreadMessage } from "../../../../src/ui/components/chat/types";

let clock = 100;
const user = (text: string): ThreadMessage => ({ role: "user", text, ts: clock++ }) as ThreadMessage;
const ai = (text: string): ThreadMessage => ({ role: "ai", text, ts: 2 }) as ThreadMessage;

test("the first render and a history arriving into an empty list are not news", () => {
	const rows = [user("a"), ai("b")];
	expect(listChange(null, "k", rows)).toEqual({ kind: "none" });
	expect(listChange(snapshotOf("k", []), "k", rows)).toEqual({ kind: "none" });
});

test("another conversation on display is not news", () => {
	const before = [user("a"), ai("b")];
	expect(listChange(snapshotOf("k", before), "other", [user("c")])).toEqual({ kind: "none" });
});

test("a render with the same rows is not news", () => {
	const rows = [user("a"), ai("b")];
	expect(listChange(snapshotOf("k", rows), "k", [...rows])).toEqual({ kind: "none" });
});

test("a reply streaming into the last row is a change", () => {
	const rows = [user("a"), ai("b")];
	expect(listChange(snapshotOf("k", rows), "k", [rows[0], ai("bc")])).toEqual({ kind: "changed" });
});

test("a row the model added is a change", () => {
	const rows = [user("a"), ai("b")];
	expect(listChange(snapshotOf("k", rows), "k", [...rows, ai("card")])).toEqual({ kind: "changed" });
});

test("a send that also drops the last turn's failure is still a send", () => {
	const rows = [user("a"), ai("failed")];
	const next = [rows[0], { ...user("c"), ts: 5 }, ai("")];
	expect(listChange(snapshotOf("k", rows), "k", next)).toEqual({ kind: "sent", index: 1 });
});

test("a queued message patched when its turn starts is not another send", () => {
	const queued = { ...user("q"), ts: 7, queued: true } as ThreadMessage;
	const rows = [user("a"), ai("b"), queued];
	const next = [rows[0], rows[1], { ...queued, queued: false } as ThreadMessage, ai("")];
	expect(listChange(snapshotOf("k", rows), "k", next)).toEqual({ kind: "changed" });
});

test("the reader's message is found among the rows a send added", () => {
	const rows = [user("a"), ai("b")];
	expect(listChange(snapshotOf("k", rows), "k", [...rows, user("c")])).toEqual({ kind: "sent", index: 2 });
	expect(listChange(snapshotOf("k", rows), "k", [...rows, user("c"), ai("")])).toEqual({ kind: "sent", index: 2 });
});
