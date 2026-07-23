// Public AI-pipeline surface for the shell (shell-m1 wires product flows to this).

export { installFetchBridge } from "./fetch-bridge";
export {
	anthropicLogin,
	anthropicLoginWithManualCode,
	anthropicLogout,
	getValidAnthropicAuth,
} from "./anthropic-oauth";
export {
	openaiLogin,
	openaiLoginWithManualCode,
	openaiLogout,
	getValidOpenAIAuth,
} from "./openai-oauth";
export {
	listProviders,
	setApiKey,
	getModels,
	defaultModelFor,
	nextDefaultsForActive,
	modelSupportsImages,
	streamChat,
	type ProviderId,
	type ProviderInfo,
	type ChatMessage,
	type StreamChatOptions,
} from "./providers";
export {
	runAgentTurn,
	type AgentTool,
	type AgentToolStart,
	type AgentToolEnd,
	type RunAgentTurnOptions,
	type ToolResult,
	type ToolResultImage,
} from "./agent";
