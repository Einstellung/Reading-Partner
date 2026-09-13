// Where the send path reports what a call spent (src/memory/usage/model-calls).
//
// Both chokepoints report here — the plain stream (providers.ts) and the tool
// loop (agent.ts), the latter once per round, because a round is a call. There
// is no third: every model request in the app leaves through one of the two.
//
// Fire-and-forget, like the cache telemetry beside it: instrumentation must
// never break the call it observes, and a log write that fails is a log line
// lost, not a turn lost.

import { logModelCall } from "../memory/usage/live";
import type { ModelCallContext, ModelCallInput, ModelCallUsage } from "../memory/usage/model-calls";

export type { ModelCallAbout, ModelCallContext, ModelCaller } from "../memory/usage/model-calls";

export type ModelCallSink = (calls: readonly ModelCallInput[]) => Promise<void>;

// The app's sink, bound to the device's log file.
let sink: ModelCallSink = logModelCall;

// How a test reads the line the send path wrote without a filesystem under it.
// Returns the undo, which the test must run: the binding is module-level, so a
// sink left installed answers for every test after it.
export function setModelCallSink(next: ModelCallSink): () => void {
	const previous = sink;
	sink = next;
	return () => {
		sink = previous;
	};
}

export interface ModelCallReport extends ModelCallContext {
	provider: string;
	model: string;
	// Absent when the call produced no message at all — it never reached a
	// provider, or died before the first event. The line is still written, with
	// zeros, because the call still happened.
	usage?: ModelCallUsage;
	ok: boolean;
}

export function recordModelCall(report: ModelCallReport): void {
	const { usage, ...rest } = report;
	void sink([
		{
			...rest,
			input: usage?.input ?? 0,
			output: usage?.output ?? 0,
			...(usage?.cacheRead ? { cacheRead: usage.cacheRead } : {}),
			...(usage?.cacheWrite ? { cacheWrite: usage.cacheWrite } : {}),
		},
	]).catch(() => {});
}
