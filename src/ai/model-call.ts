// The default-model lookup and the one plain streaming call every unattended
// feature makes (lesson prep, book notes, slides, news triage, memory
// distillation). `thinking` picks which effort setting applies: "chat" for the
// conversational path, "prep" for the background pipelines.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { loadSettings, toReasoning, type AiLanguage } from "../platform/app/settings";
import {
	ModelCallError,
	streamChat,
	type ProviderId,
	type ResponseHead,
	type StreamOutcome,
} from "./providers";
import type { AiCallOptions } from "./watchdog";

export type ThinkingKind = "chat" | "prep";

export interface ResolvedModel {
	providerId: ProviderId;
	modelId: string;
	reasoning: ThinkingLevel | undefined;
	aiLanguage: AiLanguage;
}

export async function resolveModel(thinking: ThinkingKind): Promise<ResolvedModel> {
	const s = await loadSettings();
	if (!s.defaultProviderId || !s.defaultModelId) {
		throw new Error("no default AI provider configured (Settings)");
	}
	return {
		providerId: s.defaultProviderId as ProviderId,
		modelId: s.defaultModelId,
		reasoning: toReasoning(thinking === "chat" ? s.chatThinking : s.prepThinking),
		aiLanguage: s.aiLanguage,
	};
}

// What an unattended call can be told about the turn beyond its text. Optional
// and unused by the pipelines themselves: the call resolves to the reply string
// as before, and everything else — the response head, the finished
// AssistantMessage with its usage and responseId — arrives here instead of
// widening the return type of every caller.
export interface ModelCallObserver {
	onResponse?: ResponseHead;
	onFinal?(assistant: StreamOutcome): void;
}

// One plain (tool-less) model call, promisified. onProgress reports the
// cumulative received character count so a caller's watchdog and liveness
// counter can track a long stream; signal aborts it. Both visible text and
// thinking count as liveness, so a model that thinks for a long stretch before
// answering isn't aborted as stalled. systemPrompt may be a function when it
// depends on the resolved model (e.g. its output language).
//
// A failure rejects with a ModelCallError carrying pi's AssistantMessage when
// the provider produced one, so the watchdog can tell a transient failure from a
// deterministic one instead of guessing from the message text.
export function callModel(
	thinking: ThinkingKind,
	systemPrompt: string | ((model: ResolvedModel) => string),
	userText: string,
	opts: AiCallOptions,
	observer?: ModelCallObserver,
): Promise<string> {
	return resolveModel(thinking).then(
		(model) =>
			new Promise<string>((resolve, reject) => {
				let chars = 0;
				const bump = (t: string) => {
					chars += t.length;
					opts.onProgress(chars);
				};
				void streamChat({
					providerId: model.providerId,
					modelId: model.modelId,
					systemPrompt: typeof systemPrompt === "function" ? systemPrompt(model) : systemPrompt,
					messages: [{ role: "user", text: userText }],
					signal: opts.signal,
					reasoning: model.reasoning,
					onDelta: bump,
					onThinking: bump,
					onResponse: observer?.onResponse,
					onDone: (text, assistant) => {
						if (assistant) observer?.onFinal?.(assistant);
						resolve(text);
					},
					onError: (m, assistant) => {
						if (assistant) observer?.onFinal?.(assistant);
						reject(new ModelCallError(m, assistant));
					},
				});
			}),
	);
}
