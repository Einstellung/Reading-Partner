// Which providers can search, and over which wire (docs/info/24).
//
// The search runs as its own request to the conversation's provider with the
// provider's hosted search tool, so a channel is a wire dialect plus the auth
// it carries. A provider with no channel gets no web_search tool at all.
//
// Portions adapted from pi-web-search by ttttmr (https://www.npmjs.com/package/pi-web-search),
// MIT License; see LICENSE.pi-web-search in this directory.

/**
 *   anthropic      Messages API with web_search_20260209, subscription OAuth (Claude Code headers).
 *   anthropic-key  the same request on an Anthropic Console API key, without the Claude Code identity.
 *   deepseek       the same tool on DeepSeek's Anthropic-compatible /anthropic route, API key.
 *   codex          ChatGPT subscription on the Codex backend's Responses API.
 *   responses      an OpenAI Responses endpoint with an API key (OpenCode's GPT models).
 *   grok           xAI's Responses dialect: plain-string input, inline citations.
 */
export type SearchChannel = "anthropic" | "anthropic-key" | "deepseek" | "codex" | "responses" | "grok";

/** The channels that speak the Anthropic Messages API. */
export function isMessagesChannel(channel: SearchChannel): channel is "anthropic" | "anthropic-key" | "deepseek" {
  return channel === "anthropic" || channel === "anthropic-key" || channel === "deepseek";
}

/** The two things about a model the choice reads. */
export interface ChannelModel {
  id: string;
  api: string;
}

const GROK_ID = /^grok([.-]|$)/i;

/** The channel a provider's model searches over, or null where it cannot. */
export function searchChannel(providerId: string, model: ChannelModel | undefined): SearchChannel | null {
  if (!model) return null;
  switch (providerId) {
    case "anthropic":
      return model.api === "anthropic-messages" ? "anthropic" : null;
    case "anthropic-api":
      return model.api === "anthropic-messages" ? "anthropic-key" : null;
    case "openai":
      return model.api === "openai-codex-responses" ? "codex" : null;
    case "deepseek":
      return "deepseek";
    case "xai":
      return model.api === "openai-responses" ? "grok" : null;
    case "opencode":
    case "opencode-go":
      if (model.api !== "openai-responses") return null;
      return GROK_ID.test(model.id) ? "grok" : "responses";
    default:
      return null;
  }
}
