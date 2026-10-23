// One search sub-request: what goes on the wire for each channel, and the
// streamed answer read back into text, sources and usage.
//
// Portions adapted from pi-web-search by ttttmr (https://www.npmjs.com/package/pi-web-search),
// MIT License; see LICENSE.pi-web-search in this directory.

import { codexAccountId } from "../ai/auth/openai-oauth";
import { isMessagesChannel, type SearchChannel } from "./channel";
import { applyIndexCitations, cleanSources, pushUniqueSource, titleFromUrl, type SearchOutcome, type Source } from "./results";
import { readSseEvents } from "./sse";

/** Anthropic's server-side searches per request. */
export const ANTHROPIC_MAX_USES = 5;

// OAuth (sk-ant-oat) requests that omit this system prompt are refused with an
// opaque 429 rate_limit_error.
const CLAUDE_CODE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

export interface SearchCall {
  channel: SearchChannel;
  modelId: string;
  /** The model's baseUrl as the provider table has it. */
  baseUrl: string;
  /** The OAuth access token or the API key. */
  apiKey: string;
  /** The model's output ceiling; the request asks for a slice of it. */
  maxTokens: number;
  /** Headers the provider needs on every request (ai/call-setup.ts), e.g. OpenCode's session. */
  headers?: Record<string, string>;
}

/** The one fetch call a search makes. */
export type SearchFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SearchRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface SearchUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface SearchResponse extends SearchOutcome {
  usage?: SearchUsage;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function messagesUrl(base: string): string {
  const b = trimSlash(base);
  return b.endsWith("/v1") ? `${b}/messages` : `${b}/v1/messages`;
}

/** DeepSeek serves the hosted search only on its Anthropic-compatible route. */
export function deepSeekAnthropicBase(baseUrl: string): string {
  const b = trimSlash(baseUrl);
  if (/\/anthropic(?:\/v1)?$/.test(b)) return b;
  return `${b.replace(/\/v1$/, "")}/anthropic`;
}

function codexResponsesUrl(base: string): string {
  const b = trimSlash(base);
  if (b.endsWith("/codex/responses")) return b;
  if (b.endsWith("/codex")) return `${b}/responses`;
  return `${b}/codex/responses`;
}

export function buildSearchRequest(call: SearchCall, query: string): SearchRequest {
  if (isMessagesChannel(call.channel)) return anthropicRequest(call, query);
  return responsesRequest(call, query);
}

function anthropicRequest(call: SearchCall, query: string): SearchRequest {
  const oauth = call.channel === "anthropic";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "anthropic-version": "2023-06-01",
    ...call.headers,
  };
  if (oauth) {
    headers.Authorization = `Bearer ${call.apiKey}`;
    headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20";
    // Anthropic refuses OAuth requests from clients older than this.
    headers["user-agent"] = "claude-cli/2.1.251";
    headers["x-app"] = "cli";
  } else {
    headers["x-api-key"] = call.apiKey;
  }
  const base = call.channel === "deepseek" ? deepSeekAnthropicBase(call.baseUrl) : call.baseUrl;
  return {
    url: messagesUrl(base),
    headers,
    body: {
      model: call.modelId,
      max_tokens: Math.min(Math.max(1024, Math.floor(call.maxTokens / 3) || 4096), 8192),
      ...(oauth ? { system: [{ type: "text", text: CLAUDE_CODE_SYSTEM_PROMPT }] } : {}),
      messages: [{ role: "user", content: query }],
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: ANTHROPIC_MAX_USES,
          // Direct calls only, so models without programmatic tool calling take it.
          allowed_callers: ["direct"],
        },
      ],
      stream: true,
    },
  };
}

function responsesRequest(call: SearchCall, query: string): SearchRequest {
  const codex = call.channel === "codex";
  const grok = call.channel === "grok";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...call.headers,
    Authorization: `Bearer ${call.apiKey}`,
  };
  if (codex) {
    headers["chatgpt-account-id"] = codexAccountId(call.apiKey);
    headers.originator = "codex_cli_rs";
  }
  const body: Record<string, unknown> = {
    model: call.modelId,
    input: grok ? [{ role: "user", content: query }] : [{ role: "user", content: [{ type: "input_text", text: query }] }],
    tools: [{ type: "web_search" }],
    // Grok gateways reject web_search_call.results with a 400.
    include: codex || grok ? ["web_search_call.action.sources"] : ["web_search_call.action.sources", "web_search_call.results"],
    stream: true,
    store: false,
  };
  if (codex) {
    // The Codex backend returns no url_citation annotations (docs/pitfall), so the
    // answer has to name its pages itself.
    body.instructions = "Answer the user's request using web search. Cite the pages you used inline as markdown links.";
    body.text = { verbosity: "low" };
    body.tool_choice = "required";
    body.parallel_tool_calls = true;
  }
  return { url: codex ? codexResponsesUrl(call.baseUrl) : `${trimSlash(call.baseUrl)}/responses`, headers, body };
}

const PROVIDER_NAME: Record<SearchChannel, string> = {
  anthropic: "Anthropic",
  "anthropic-key": "Anthropic",
  deepseek: "DeepSeek",
  codex: "OpenAI",
  responses: "OpenAI",
  grok: "xAI",
};

/** Send one search and read its streamed answer. A non-2xx answer throws with the provider's body. */
export async function runSearch(
  call: SearchCall,
  query: string,
  fetchFn: SearchFetch,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const req = buildSearchRequest(call, query);
  const response = await fetchFn(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(req.body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`${PROVIDER_NAME[call.channel]} API error (${response.status}): ${await response.text()}`);
  }
  if (isMessagesChannel(call.channel)) {
    return readAnthropicStream(response, call.channel, signal);
  }
  return readResponsesStream(response, call.channel, signal);
}

/**
 * Anthropic Messages SSE. Citations arrive on the text block they support
 * (citations_delta before that block's text), so each cited block gets its
 * markers at its end.
 */
export async function readAnthropicStream(
  response: Response,
  channel: SearchChannel,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const blocks = new Map<number, { text: string; cites: Set<number> }>();
  const sources: Source[] = [];
  const found: Source[] = [];
  const usage: SearchUsage = { input: 0, output: 0 };
  let sawUsage = false;

  const cite = (index: number, c: { url?: string; title?: string } | undefined) => {
    if (!c?.url) return;
    const block = blocks.get(index);
    if (block) block.cites.add(pushUniqueSource(sources, { title: c.title || titleFromUrl(c.url), url: c.url }));
  };

  const takeUsage = (u: any) => {
    if (!u) return;
    sawUsage = true;
    if (typeof u.input_tokens === "number") usage.input = u.input_tokens;
    if (typeof u.output_tokens === "number") usage.output = u.output_tokens;
    if (typeof u.cache_read_input_tokens === "number" && u.cache_read_input_tokens) usage.cacheRead = u.cache_read_input_tokens;
    if (typeof u.cache_creation_input_tokens === "number" && u.cache_creation_input_tokens) usage.cacheWrite = u.cache_creation_input_tokens;
  };

  await readSseEvents(response, signal, ({ data: event }) => {
    if (event.type === "message_start") {
      takeUsage(event.message?.usage);
    } else if (event.type === "message_delta") {
      takeUsage(event.usage);
    } else if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block?.type === "text") {
        blocks.set(event.index, { text: block.text ?? "", cites: new Set() });
        for (const c of block.citations ?? []) cite(event.index, c);
      } else if (block?.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r?.url) found.push({ title: r.title || titleFromUrl(r.url), url: r.url });
          }
        } else if (block.content?.type === "web_search_tool_result_error" && channel === "deepseek") {
          throw new Error(`DeepSeek web search failed: ${block.content.error_code || "unknown error"}`);
        }
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "text_delta") {
        const block = blocks.get(event.index);
        if (block) block.text += delta.text ?? "";
      } else if (delta?.type === "citations_delta" && delta.citation?.type === "web_search_result_location") {
        cite(event.index, delta.citation);
      }
    } else if (event.type === "error") {
      throw new Error(event.error?.message || JSON.stringify(event.error ?? event));
    }
  });

  const text = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, b]) => b.text + [...b.cites].map((i) => `[${i + 1}]`).join(""))
    .join("");
  return {
    text: text || "No answer available.",
    sources: sources.length ? sources : cleanSources(found),
    ...(sawUsage ? { usage } : {}),
  };
}

/** OpenAI / xAI Responses SSE. */
export async function readResponsesStream(
  response: Response,
  channel: SearchChannel,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  let text = "";
  const citations: { endIndex?: number; title: string; url: string }[] = [];
  const found: Source[] = [];
  let usage: SearchUsage | undefined;

  const annotation = (a: any) => {
    if (a?.type !== "url_citation") return;
    const nested = a.url_citation ?? a.urlCitation;
    const url = a.url ?? nested?.url;
    if (typeof url !== "string" || !url) return;
    const end = a.end_index ?? a.endIndex ?? nested?.end_index ?? nested?.endIndex;
    if (citations.some((c) => c.url === url && c.endIndex === end)) return;
    citations.push({ url, title: a.title ?? nested?.title ?? titleFromUrl(url), ...(typeof end === "number" ? { endIndex: end } : {}) });
  };

  const searchCall = (item: any) => {
    if (item?.type !== "web_search_call") return;
    for (const s of item.action?.sources ?? []) {
      if (s?.url) found.push({ title: s.title || s.display_name || s.name || titleFromUrl(s.url), url: s.url });
    }
  };

  const finished = (r: any) => {
    for (const item of r?.output ?? []) {
      searchCall(item);
      if (item?.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part?.type === "output_text") for (const a of part.annotations ?? []) annotation(a);
      }
    }
    const u = r?.usage;
    if (u) {
      const cached = u.input_tokens_details?.cached_tokens ?? 0;
      usage = {
        input: (u.input_tokens ?? 0) - cached,
        output: u.output_tokens ?? 0,
        ...(cached ? { cacheRead: cached } : {}),
      };
    }
  };

  await readSseEvents(response, signal, ({ data: event }) => {
    if (event.type === "error" || event.type === "response.failed") {
      const message = event.message || event.error?.message || event.response?.error?.message;
      throw new Error(message || JSON.stringify(event.error ?? event.response?.error ?? event));
    } else if (event.type === "response.output_text.delta") {
      text += event.delta ?? "";
    } else if (event.type === "response.output_text.annotation.added") {
      annotation(event.annotation);
    } else if (event.type === "response.output_item.done") {
      searchCall(event.item);
    } else if (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete") {
      finished(event.response);
      // The Codex backend keeps the stream open after the response is done.
      if (channel === "codex") return true;
    }
  });

  const answer = text || "No answer available.";
  // Grok writes its citations inline as links; its annotations only list them.
  const cited =
    channel === "grok"
      ? { text: answer, sources: citations.reduce<Source[]>((acc, c) => (pushUniqueSource(acc, c), acc), []) }
      : applyIndexCitations(answer, citations);
  // Without annotations (Codex) the pages the answer used are its inline links;
  // they go first, then the rest of what the search found.
  const inline = [...answer.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => ({ title: m[1], url: m[2] }));
  return {
    text: cited.text,
    sources: cited.sources.length ? cited.sources : cleanSources([...inline, ...found]),
    ...(usage ? { usage } : {}),
  };
}
