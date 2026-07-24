// Public AI-pipeline surface for the shell (shell-m1 wires product flows to this).

export { installFetchBridge } from "./fetch-bridge";
export {
	anthropicLogin,
	anthropicLoginManualStart,
	anthropicLoginWithManualCode,
	anthropicLogout,
	getValidAnthropicAuth,
} from "./anthropic-oauth";
export {
	openaiLogin,
	openaiLoginManualStart,
	openaiLoginWithManualCode,
	openaiLoginDeviceCode,
	openaiLogout,
	getValidOpenAIAuth,
} from "./openai-oauth";
export type { DeviceCodeState } from "./device-code";
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
