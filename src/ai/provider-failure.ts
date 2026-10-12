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
