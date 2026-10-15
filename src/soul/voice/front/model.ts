// The front's one call (docs/companion/136 "前台的上下文与模型"): no tool loop,
// thinking off unless the slot says low, the front model slot or the talk model.
// The port is what cascade.ts calls; `liveFrontModel` is it on the device's
// default provider, the same for every provider.

import { clampThinkingLevel, normalizeContext, type Api, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { providers, resolveCall, toPiMessages } from "../../../ai/providers";
import type { ProviderId } from "../../../ai/auth/provider-ids";
import { loadSettings } from "../../../platform/app/settings";
import type { AgentTool } from "../../../legion/durable/contract";
import type { FrontMessage } from "./context";

export type FrontThinking = "off" | "low";

export interface FrontModelRequest {
  system: string;
  messages: FrontMessage[];
  tools: AgentTool[];
  signal: AbortSignal;
  /** The request is on the wire. */
  onSent(): void;
  onText(chunk: string): void;
  onToolCall(call: { name: string; args: Record<string, unknown> }): void;
  /** Any event from the provider, said or not: thinking, a tool call's arguments as they stream. */
  onProgress?(): void;
}

/** Resolves when the reply is complete; rejects when it failed. */
export type FrontModel = (req: FrontModelRequest) => Promise<void>;

/** The model the front runs on: its own slot, or the talk model when the slot is empty. */
export function frontModelId(slot: string | null | undefined, talk: string): string {
  return slot ?? talk;
}

/**
 * The reasoning level the front asks for. Off, or low when the slot says so; a
 * model that cannot turn thinking off gets its lowest level. Undefined means
 * none is passed.
 */
export function frontReasoning(model: Model<Api>, setting: FrontThinking): Exclude<ModelThinkingLevel, "off"> | undefined {
  if (!model.reasoning) return undefined;
  const level = clampThinkingLevel(model, setting);
  return level === "off" ? undefined : level;
}

export function liveFrontModel(): FrontModel {
  return async (req) => {
    const s = await loadSettings();
    if (!s.defaultProviderId || !s.defaultModelId) throw new Error("no default AI provider configured (Settings)");
    const providerId = s.defaultProviderId as ProviderId;
    const modelId = frontModelId(s.voiceFrontModelId, s.defaultModelId);
    const call = await resolveCall(providerId, modelId, []);
    const reasoning = frontReasoning(call.model, s.voiceFrontThinking);
    const stream = providers[providerId].streamSimple(
      call.model,
      normalizeContext({
        systemPrompt: req.system,
        messages: toPiMessages(req.messages.map((m) => ({ role: m.role === "user" ? "user" : "ai", text: m.text }))),
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      }),
      { apiKey: call.apiKey, signal: req.signal, reasoning, transport: call.transport, maxRetries: 0 },
    );
    req.onSent();
    for await (const ev of stream) {
      req.onProgress?.();
      if (ev.type === "text_delta") req.onText(ev.delta);
      else if (ev.type === "toolcall_end") req.onToolCall({ name: ev.toolCall.name, args: ev.toolCall.arguments });
      else if (ev.type === "error") throw new Error(ev.error.errorMessage || "front call failed");
    }
  };
}
