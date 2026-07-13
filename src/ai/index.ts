// Public AI-pipeline surface for the shell (shell-m1 wires product flows to this).

export { installFetchBridge } from "./fetch-bridge";
export {
	anthropicLogin,
	anthropicLoginWithManualCode,
	anthropicLogout,
	getValidAnthropicAuth,
} from "./anthropic-oauth";
export {
	listProviders,
	setApiKey,
	getModels,
	streamChat,
	type ProviderId,
	type ProviderInfo,
	type ChatMessage,
	type StreamChatOptions,
} from "./providers";
