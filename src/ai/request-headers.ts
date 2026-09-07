// HTTP headers a provider requires that no client library sends on its own.
//
// pi merges ProviderRequestOptions.headers last, after its own defaults and the
// model's (openai-completions, openai-responses and anthropic-messages all do
// it), so an entry here is what actually reaches the wire.
//
// OpenCode routes and caches per conversation and will not take a request that
// does not say which one it belongs to: without `x-opencode-session` the
// service answers 400 MissingSessionID and the turn fails having sent nothing.
// The value has to be stable across a conversation's turns — a fresh id per
// call clears the 400 and gives up the routing and prompt caching the header
// exists for. Measured on `opencode-go`, which is the provider that returned
// that 400; OpenCode Zen (`opencode`) is here on the strength of the docs
// alone, which require the header on "main and auxiliary OpenCode requests"
// rather than naming one endpoint.
//
// One entry per provider: a second provider with its own header requirement is
// a line in this table, not a second branch on the send path.

import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { ProviderId } from "./provider-ids";

// What one call has to carry, given the id of the conversation it belongs to.
type HeaderRule = (sessionId: string) => ProviderHeaders;

const openCodeSession: HeaderRule = (sessionId) => ({ "x-opencode-session": sessionId });

const RULES: Partial<Record<ProviderId, HeaderRule>> = {
	opencode: openCodeSession,
	"opencode-go": openCodeSession,
};

// undefined for every provider that requires nothing, which is what is handed
// to pi: no header added, no default suppressed.
export function providerRequestHeaders(
	providerId: ProviderId,
	sessionId: string,
): ProviderHeaders | undefined {
	return RULES[providerId]?.(sessionId);
}
