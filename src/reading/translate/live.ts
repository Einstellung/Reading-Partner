// The live binding of the batch call: the app's own model, through the same
// provider path everything else uses. The core never imports this — it takes
// the function — so this file is the only place the translation knows which
// model is answering.

import { streamChat, type ProviderId } from "../../ai/providers";
import { newRunId } from "../../platform/app/cache-telemetry";
import {
  parseBatchResponse,
  translateBatchMessage,
  translateSystemPrompt,
  type TranslateBatchFn,
} from "./prompt";

export interface TranslateModel {
  providerId: ProviderId;
  modelId: string;
  /**
   * The conversation the translation was asked for in. The request is a turn of
   * that conversation as far as routing and caching are concerned, and the
   * batches of one article share it so a provider that caches per conversation
   * sees one run rather than a dozen strangers.
   */
  sessionId?: string;
}

/** A TranslateBatchFn bound to one model, for translateArticleEpub's deps. */
export function translateBatchLive(model: TranslateModel): TranslateBatchFn {
  const sessionId = model.sessionId ?? newRunId();
  return (request, signal) =>
    new Promise((resolve, reject) => {
      void streamChat({
        providerId: model.providerId,
        modelId: model.modelId,
        systemPrompt: translateSystemPrompt(),
        messages: [{ role: "user", text: translateBatchMessage(request) }],
        signal,
        sessionId,
        onDelta: () => {},
        onDone: (text) => {
          try {
            resolve(parseBatchResponse(text, request));
          } catch (err) {
            reject(err);
          }
        },
        onError: (message) => reject(new Error(message)),
      });
    });
}
