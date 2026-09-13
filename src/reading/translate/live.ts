// The live bindings of the two calls: the app's own model, through the same
// provider path everything else uses. The core never imports this — it takes the
// functions — so this file is the only place the translation knows which model
// is answering.

import { streamChat, type ProviderId } from "../../ai/providers";
import { newRunId } from "../../platform/app/cache-telemetry";
import {
  glossaryMessage,
  glossarySystemPrompt,
  parseBatchResponse,
  parseGlossaryResponse,
  translateBatchMessage,
  translateSystemPrompt,
  type GlossaryFn,
  type TranslateBatchFn,
} from "./prompt";

export interface TranslateModel {
  providerId: ProviderId;
  modelId: string;
  /**
   * The conversation the translation was asked for in. The calls are turns of
   * that conversation as far as routing and caching are concerned, and every
   * call of one article shares it, so a provider that caches per conversation
   * sees one run rather than a dozen strangers.
   */
  sessionId?: string;
}

/** One call, answered as text. Both passes differ only in what they send and read. */
function ask(
  model: TranslateModel,
  sessionId: string,
  systemPrompt: string,
  message: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    void streamChat({
      providerId: model.providerId,
      modelId: model.modelId,
      systemPrompt,
      messages: [{ role: "user", text: message }],
      signal,
      sessionId,
      onDelta: () => {},
      onDone: (text) => resolve(text),
      onError: (text) => reject(new Error(text)),
    });
  });
}

/** The glossary pass, bound to one model. */
export function translateGlossaryLive(model: TranslateModel): GlossaryFn {
  const sessionId = model.sessionId ?? newRunId();
  return async (request, signal) =>
    parseGlossaryResponse(
      await ask(model, sessionId, glossarySystemPrompt(), glossaryMessage(request), signal),
    );
}

/** A TranslateBatchFn bound to one model, for translateArticleEpub's deps. */
export function translateBatchLive(model: TranslateModel): TranslateBatchFn {
  const sessionId = model.sessionId ?? newRunId();
  return async (request, signal) =>
    parseBatchResponse(
      await ask(model, sessionId, translateSystemPrompt(), translateBatchMessage(request), signal),
      request,
    );
}
