// What a call on a given provider has to carry beyond the prompt, given the id
// of the conversation it belongs to.
//
// Two kinds of thing live here, both keyed by provider and both derived from
// the same conversation id:
//
//   headers   — HTTP headers no client library sends on its own. pi merges
//               ProviderRequestOptions.headers last, after its own defaults and
//               the model's (openai-completions, openai-responses and
//               anthropic-messages all do it), so an entry here is what
//               actually reaches the wire.
//   sessionId — pi's own ProviderRequestOptions.sessionId, which pi turns into
//               the provider's session-affinity headers when the model's compat
//               says sendSessionAffinityHeaders.
//
// OpenCode routes and caches per conversation and will not take a request that
// does not say which one it belongs to: without `x-opencode-session` the
// service answers 400 MissingSessionID and the turn fails having sent nothing.
// The value has to be stable across a conversation's turns — a fresh id per
// call clears the 400 and gives up the routing and prompt caching the header
// exists for. Measured on `opencode-go` against the live service, on both an
// openai-completions model and an anthropic-messages one; OpenCode Zen
// (`opencode`) is here on the strength of the docs alone, which require the
// header on "main and auxiliary OpenCode requests" rather than naming one
// endpoint.
//
// Fireworks needs no header of its own: every model pi lists for it (14 on
// anthropic-messages, 6 on openai-completions) sets compat
// sendSessionAffinityHeaders, so passing pi the session id is all it takes for
// pi to send the affinity headers itself.
//
// sendSessionAffinityHeaders is why sessionId is opt-in per provider rather
// than passed everywhere. openai-completions and anthropic-messages both gate
// the affinity headers behind that compat flag, but openai-responses does not:
// it sends `x-session-id` / `session_id` / `x-client-request-id` for any
// sessionId at all. Our `openai` provider is pi's openai-codex, which
// authenticates with a ChatGPT subscription token, and several others have an
// openai-responses path; adding unmeasured headers there is not something this
// table does by accident.
//
// Deliberately left on the table: openai-completions and openai-responses also
// use options.sessionId as OpenAI's `prompt_cache_key`, so providers on those
// apis would likely get better cache hits from being passed one. That is a
// separate change, unmeasured here, and is not being made.
//
// One entry per provider: a second provider with its own requirement is a line
// in this table, not a second branch on the send path.

import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { ProviderId } from "./provider-ids";

// The per-call setup handed to pi. Both fields are optional and both are
// omitted for the providers that need neither, which is what pi wants: no
// header added, no default suppressed, no session id invented.
export interface CallSetup {
	headers?: ProviderHeaders;
	sessionId?: string;
}

type SetupRule = (sessionId: string) => CallSetup;

// The header OpenCode requires. No pi sessionId: OpenCode's own models carry no
// sendSessionAffinityHeaders compat, so passing one would either do nothing or,
// on an openai-responses model, add three unmeasured headers.
const openCodeSession: SetupRule = (sessionId) => ({ headers: { "x-opencode-session": sessionId } });

// Nothing custom; pi builds the affinity headers from the session id itself.
const piSessionAffinity: SetupRule = (sessionId) => ({ sessionId });

const RULES: Partial<Record<ProviderId, SetupRule>> = {
	opencode: openCodeSession,
	"opencode-go": openCodeSession,
	fireworks: piSessionAffinity,
};

const NOTHING: CallSetup = {};

// The setup for one call. An empty object for every provider that requires
// nothing, so callers can spread it unconditionally.
export function providerCallSetup(providerId: ProviderId, sessionId: string): CallSetup {
	return RULES[providerId]?.(sessionId) ?? NOTHING;
}
