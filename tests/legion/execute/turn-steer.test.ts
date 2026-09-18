// Steering a turn that is already running (src/legion/execute/turn.ts, docs/72).
// Driven by a scripted fake stream, so the round boundary the queue drains at is
// a real one and nothing is mocked out. Run: bun test.

import { expect, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	type Api,
	type Context,
	type Message,
	type Model,
} from "@earendil-works/pi-ai";
import {
	runHarnessTurn,
	STEER_ENDED,
	type SteerPort,
	type StreamFn,
} from "../../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import { memoryAppData } from "../../support/memory-appdata";
import { turnEvents, type Turn } from "../../support/scripted-turn";

const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;

function scriptStream(
	turns: Turn[],
	hook?: (round: number) => void,
): { fn: StreamFn; contexts: Context[] } {
	let round = 0;
	const contexts: Context[] = [];
	const fn: StreamFn = (_model, context) => {
		const i = round++;
		contexts.push(context);
		hook?.(i);
		const stream = createAssistantMessageEventStream();
		const events = turnEvents(turns[i] ?? { error: "no scripted turn" });
		(async () => {
			for (const ev of events) {
				await Promise.resolve();
				stream.push(ev);
			}
			stream.end();
		})();
		return stream;
	};
	return { fn, contexts };
}

function userTexts(context: Context): string[] {
	return (context.messages as Message[])
		.filter((m) => m.role === "user")
		.map((m) =>
			typeof m.content === "string"
				? m.content
				: (m.content as { type: string; text?: string }[])
						.filter((c) => c.type === "text")
						.map((c) => c.text ?? "")
						.join(""),
		);
}

const PROMPT: Message[] = [{ role: "user", content: "why this?", timestamp: 1 }];

test("a line steered mid-turn reaches the model at the next round boundary", async () => {
	// Steered while the first round's request is already in flight, which is
	// when the reader can do it: the answer is on screen, so the turn is past
	// its own opening boundary and the queue is drained at the next one.
	let port: SteerPort | undefined;
	const steered: string[] = [];
	const injected: string[] = [];
	let id: string | undefined;
	let done: string | undefined;
	const { fn, contexts } = scriptStream([{ text: "because" }, { text: "and the other one" }], (round) => {
		if (round !== 0) return;
		void port!("and the other one?").then((outcome) => {
			if (outcome.ok) {
				id = outcome.id;
				steered.push(outcome.id);
			}
		});
	});

	await runHarnessTurn({
		stream: fn,
		model: MODEL,
		messages: PROMPT,
		tools: [],
		maxRounds: 4,
		fileSystem: createSessionFileSystem(memoryAppData()),
		onDelta: () => {},
		onToolStart: () => {},
		onToolEnd: () => {},
		onSteerable: (steer: SteerPort) => {
			port = steer;
		},
		onSteered: (ids) => injected.push(...ids),
		onDone: (text) => {
			done = text;
		},
		onError: () => {},
	});

	// The first round never saw it; the second did, and the id the caller was
	// given is the one reported back.
	expect(userTexts(contexts[0])).toEqual(["why this?"]);
	expect(userTexts(contexts[1])).toEqual(["why this?", "and the other one?"]);
	expect(steered).toHaveLength(1);
	expect(injected).toEqual([id!]);
	expect(done).toBe("and the other one");
});

test("steering a turn that has ended is refused, not swallowed", async () => {
	const { fn } = scriptStream([{ text: "because" }]);
	let port: SteerPort | undefined;

	await runHarnessTurn({
		stream: fn,
		model: MODEL,
		messages: PROMPT,
		tools: [],
		maxRounds: 4,
		fileSystem: createSessionFileSystem(memoryAppData()),
		onDelta: () => {},
		onToolStart: () => {},
		onToolEnd: () => {},
		onSteerable: (steer: SteerPort) => {
			port = steer;
		},
		onDone: () => {},
		onError: () => {},
	});

	const outcome = await port!("too late");
	expect(outcome).toEqual({ ok: false, reason: "ended", message: STEER_ENDED });
});

test("a line the abort got to first is never reported injected", async () => {
	const controller = new AbortController();
	const injected: string[] = [];
	let queued: string | undefined;
	let port: SteerPort | undefined;
	const { fn } = scriptStream([{ text: "because" }, { text: "never sent" }], (round) => {
		if (round !== 0) return;
		void port!("and the other one?").then((outcome) => {
			if (outcome.ok) queued = outcome.id;
			controller.abort();
		});
	});

	await runHarnessTurn({
		stream: fn,
		model: MODEL,
		messages: PROMPT,
		tools: [],
		signal: controller.signal,
		maxRounds: 4,
		fileSystem: createSessionFileSystem(memoryAppData()),
		onDelta: () => {},
		onToolStart: () => {},
		onToolEnd: () => {},
		onSteerable: (steer: SteerPort) => {
			port = steer;
		},
		onSteered: (ids) => injected.push(...ids),
		onDone: () => {},
		onError: () => {},
	});

	expect(queued).toBeString();
	// The caller still holds the sentence: what it queued is what it has to
	// open the next turn with (reading/steering.ts keeps the difference).
	expect(injected).toEqual([]);
});
