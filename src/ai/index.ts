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
	isSelectableModel,
	modelSupportsImages,
	streamChat,
	ModelCallError,
	providers,
	PROVIDER_IDS,
	API_KEY_PROVIDER_IDS,
	AUTH_KIND,
	isApiKeyProvider,
	bridgedHosts,
	type ApiKeyProviderId,
	type AuthKind,
	type ModelChoice,
	type ProviderId,
	type ProviderInfo,
	type ChatMessage,
	type ResponseHead,
	type StreamChatOptions,
	type StreamOutcome,
} from "./providers";
export { formatContextWindow, modelChoiceLabel } from "./model-label";
export { enforceKnownModel } from "./model-call";
export {
	runAgentTurn,
	type AgentTool,
	type AgentToolStart,
	type AgentToolEnd,
	type RunAgentTurnOptions,
	type ToolResult,
	type ToolResultImage,
} from "./agent";
