// The default-model lookup and the one plain streaming call every unattended
// feature makes (lesson prep, book notes, slides, news triage, memory
// distillation). `thinking` picks which effort setting applies: "chat" for the
// conversational path, "prep" for the background pipelines.

import type { Api, Context, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { contextBudget, fitsBudget, OUTPUT_FLOOR, REFUSE_FLOOR_OVER, type BudgetPurpose } from "../budget";
import { loadSettings, toReasoning, type AiLanguage, type Settings } from "../platform/app/settings";
import {
	defaultModelFor,
	isSelectableModel,
	ModelCallError,
	providers,
	streamChat,
	type ProviderId,
	type ResponseHead,
	type StreamOutcome,
} from "./providers";
import type { AiCallOptions } from "./watchdog";

export type ThinkingKind = "chat" | "prep";

// Settings read off disk with a default model that no longer qualifies swapped
// for one that does — the model floor applies to what was stored, not only to
// what can be picked from now on. A settings file predates the floor, or arrives
// from a device that was on an older build, or came in over sync; none of those
// may leave the app pointing at a model it will not offer.
//
// `notice` is the sentence to show the user, and it is the point: swapping the
// model under someone silently is worse than the stale value. null means nothing
// changed. The model is only ever cleared when the provider has nothing over the
// floor at all, and the app then behaves as it does before any provider is set
// up, rather than failing at the first call.
export function enforceModelFloor(settings: Settings): { settings: Settings; notice: string | null } {
	const providerId = settings.defaultProviderId;
	if (!providerId || !(providerId in providers) || !settings.defaultModelId) {
		return { settings, notice: null };
	}
	const id = providerId as ProviderId;
	if (isSelectableModel(id, settings.defaultModelId)) return { settings, notice: null };

	const stale = settings.defaultModelId;
	const replacement = defaultModelFor(id);
	const name = providers[id].name;
	return {
		settings: { ...settings, defaultModelId: replacement },
		notice: replacement
			? `${stale} no longer meets this app's context-window minimum; switched to ${replacement}.`
			: `${stale} no longer meets this app's context-window minimum, and ${name} has no model that does. Pick another provider in Settings.`,
	};
}

export interface ResolvedModel {
	providerId: ProviderId;
	modelId: string;
	reasoning: ThinkingLevel | undefined;
	aiLanguage: AiLanguage;
}

export async function resolveModel(thinking: ThinkingKind): Promise<ResolvedModel> {
	const s = await loadSettings();
	if (!s.defaultProviderId || !s.defaultModelId) {
		// Terminal: this is a settings read, and repeating it cannot conjure a
		// provider. Without the flag the watchdog spends its whole retry budget on
		// an app that has nothing to call.
		throw new ModelCallError("no default AI provider configured (Settings)", { terminal: true });
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

// The resolved model's catalog metadata, for its context window. Null when the
// settings name a model pi doesn't know (a stale stored id still calls, see
// resolveCall), in which case there is no window to measure against and the call
// goes out unmeasured rather than being blocked on a lookup.
function catalogModel(m: ResolvedModel): Model<Api> | null {
	return providers[m.providerId]?.getModels().find((x) => x.id === m.modelId) ?? null;
}

// Refuse to send a whole-input task that leaves the model no room to answer.
//
// These calls — the notes plan, the overview, the slide plan and its content,
// the lesson plan, news triage — take their material entire. There is no smaller
// version of the question: an overview assembled from 12 of 24 chapters reads
// exactly like a complete one, so silently sampling would produce a wrong answer
// that looks right. Splitting them into a map-reduce pass is the eventual fix
// and is deliberately not done here. Until then the honest move is to say what
// happened and stop.
//
// Terminal, so the watchdog does not spend its retry budget: the same material
// assembles the same call, and it would be clamped the same way every time.
//
// Exported for its own test, which is the only way to reach it without settings,
// credentials or a network: callModel resolves all three before it gets here.
export function wholeInputRefusal(
	model: Model<Api>,
	purpose: BudgetPurpose,
	systemPrompt: string,
	userText: string,
): string | null {
	const ctx: Context = {
		systemPrompt,
		messages: [{ role: "user", content: userText, timestamp: Date.now() }],
	};
	const budget = contextBudget(model, ctx);
	if (fitsBudget(budget, purpose)) return null;
	const n = (v: number) => v.toLocaleString("en-US");
	return `${REFUSE_FLOOR_OVER} (${n(budget.used)} tokens of material against a ${n(
		budget.contextWindow,
	)}-token window leaves ${n(budget.allowedOutput)} for the answer; this one needs ${n(
		OUTPUT_FLOOR[purpose],
	)}.)`;
}

function gateWholeInput(
	model: ResolvedModel,
	purpose: BudgetPurpose,
	systemPrompt: string,
	userText: string,
): void {
	const catalog = catalogModel(model);
	if (!catalog) return;
	const refusal = wholeInputRefusal(catalog, purpose, systemPrompt, userText);
	if (refusal) throw new ModelCallError(refusal, { terminal: true });
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
	purpose: BudgetPurpose,
	systemPrompt: string | ((model: ResolvedModel) => string),
	userText: string,
	opts: AiCallOptions,
	observer?: ModelCallObserver,
): Promise<string> {
	return resolveModel(thinking).then(
		(model) =>
			new Promise<string>((resolve, reject) => {
				const prompt = typeof systemPrompt === "function" ? systemPrompt(model) : systemPrompt;
				gateWholeInput(model, purpose, prompt, userText);
				let chars = 0;
				const bump = (t: string) => {
					chars += t.length;
					opts.onProgress(chars);
				};
				void streamChat({
					providerId: model.providerId,
					modelId: model.modelId,
					systemPrompt: prompt,
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
						reject(new ModelCallError(m, { assistant }));
					},
				});
			}),
	);
}
