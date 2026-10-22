// A name for a model call that failed inside the durable runtime. pi-ai turns
// whatever a provider threw into an assistant message with `stopReason:
// "error"` and only the text survives (probed: a credential lookup that throws
// ends as "API key auth failed for provider anthropic: …", a refused connection
// as "Connection error."). Failure logs need offline and not-signed-in apart,
// so the text is mapped back to a stable name in the shape of an error class.

export type ProviderFailureName = "NotSignedInError" | "OfflineError" | "ModelCallError";

const NOT_SIGNED_IN =
  /auth failed for provider|is not connected|no api key|invalid x-api-key|authentication_error|unauthorized|\b401\b/i;

const OFFLINE =
  /connection error|fetch failed|load failed|networkerror|network connection was lost|internet connection appears to be offline|econnrefused|econnreset|enotfound|eai_again|could not connect/i;

export function providerFailureName(message: string): ProviderFailureName {
  if (NOT_SIGNED_IN.test(message)) return "NotSignedInError";
  if (OFFLINE.test(message)) return "OfflineError";
  return "ModelCallError";
}

/**
 * A failed call's text as the reader can act on it. `model-rejected`: the
 * provider refuses the model asked for, as the ChatGPT Codex backend does with
 * a catalog model the account may not use ("The 'gpt-5.5' model is not
 * supported when using Codex with a ChatGPT account."); `model` is the id when
 * the text names it, `chatgpt` whether it names a ChatGPT account. `provider`:
 * any other error, with the provider's own words unwrapped from its JSON body.
 */
export type ModelCallFailure =
  | { kind: "model-rejected"; model: string | null; chatgpt: boolean }
  | { kind: "not-signed-in" }
  | { kind: "offline" }
  | { kind: "provider"; detail: string };

const MODEL_REJECTED = [
  /\bthe ['"`]([^'"`]+)['"`] model is not supported\b/i,
  /\bmodel ['"`]([^'"`]+)['"`] (?:is not supported|does not exist|is not available|not found)\b/i,
  /\bmodel_not_found\b/i,
  /\bunsupported model\b/i,
];

/** The provider's own words when the text is a JSON error body ({"detail": …}, {"error": {"message": …}}); else the text. */
export function providerDetail(message: string): string {
  const text = message.trim();
  const start = text.indexOf("{");
  if (start < 0) return text;
  try {
    const body = JSON.parse(text.slice(start)) as Record<string, unknown>;
    const error = body.error;
    const nested = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
    const said = [body.detail, body.message, error, nested].find((x): x is string => typeof x === "string" && x.trim() !== "");
    return said ? said.trim() : text;
  } catch {
    return text;
  }
}

export function modelCallFailure(message: string): ModelCallFailure {
  const detail = providerDetail(message);
  for (const pattern of MODEL_REJECTED) {
    const m = pattern.exec(detail) ?? pattern.exec(message);
    if (m) return { kind: "model-rejected", model: m[1] ?? null, chatgpt: /chatgpt account/i.test(detail) };
  }
  const name = providerFailureName(message);
  if (name === "NotSignedInError") return { kind: "not-signed-in" };
  if (name === "OfflineError") return { kind: "offline" };
  return { kind: "provider", detail };
}
