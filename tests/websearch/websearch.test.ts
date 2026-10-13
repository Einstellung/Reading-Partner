import { expect, test } from "bun:test";
import { providers } from "../../src/ai/providers";
import { searchChannel } from "../../src/websearch/channel";
import { formatSearchResult, WEB_SEARCH_MAX_CHARS } from "../../src/websearch/format";
import {
  ANTHROPIC_MAX_USES,
  buildSearchRequest,
  readAnthropicStream,
  readResponsesStream,
  runSearch,
  type SearchCall,
} from "../../src/websearch/request";
import { buildWebSearchTool, liveWebSearchTools, webSearchTarget } from "../../src/websearch/tool";

const sse = (events: unknown[], chunk = 37): Response => {
  const text = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  // Split mid-line so the parser has to carry partial lines across reads.
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
};

const call = (over: Partial<SearchCall>): SearchCall => ({
  channel: "anthropic",
  modelId: "m",
  baseUrl: "https://api.anthropic.com",
  apiKey: "KEY",
  maxTokens: 64000,
  ...over,
});

// A JWT whose payload carries the ChatGPT account id, nothing else.
const codexToken = `x.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } }))
  .replace(/=+$/, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")}.y`;

test("the channel follows the provider and its model's api", () => {
  const m = (api: string, id = "x") => ({ api, id });
  expect(searchChannel("anthropic", m("anthropic-messages"))).toBe("anthropic");
  expect(searchChannel("openai", m("openai-codex-responses"))).toBe("codex");
  expect(searchChannel("deepseek", m("openai-completions"))).toBe("deepseek");
  expect(searchChannel("xai", m("openai-responses", "grok-4.6"))).toBe("grok");
  expect(searchChannel("opencode", m("openai-responses", "gpt-5.1"))).toBe("responses");
  expect(searchChannel("opencode-go", m("openai-responses", "grok-4.7"))).toBe("grok");
  expect(searchChannel("opencode", m("anthropic-messages"))).toBeNull();
  expect(searchChannel("opencode-go", m("openai-completions"))).toBeNull();
  expect(searchChannel("openrouter", m("openai-completions"))).toBeNull();
  expect(searchChannel("groq", m("openai-completions"))).toBeNull();
  expect(searchChannel("anthropic", undefined)).toBeNull();
});

test("the search runs on the provider's everyday model, and only where it has a channel", () => {
  const sonnet = providers.anthropic.getModels()[0].id;
  const haiku = providers.anthropic.getModels().find((x) => x.id.includes("haiku"))!.id;
  expect(webSearchTarget({ defaultProviderId: "anthropic", defaultModelId: sonnet, everydayModelId: haiku })).toEqual({
    providerId: "anthropic",
    modelId: haiku,
    channel: "anthropic",
  });
  expect(webSearchTarget({ defaultProviderId: "anthropic", defaultModelId: sonnet, everydayModelId: null })?.modelId).toBe(sonnet);
  const groq = providers.groq.getModels()[0].id;
  expect(webSearchTarget({ defaultProviderId: "groq", defaultModelId: groq, everydayModelId: null })).toBeNull();
  expect(liveWebSearchTools({ defaultProviderId: "groq", defaultModelId: groq, everydayModelId: null }, { caller: "reading", sessionId: "t" })).toEqual([]);
  expect(liveWebSearchTools({ defaultProviderId: null, defaultModelId: null, everydayModelId: null }, { caller: "reading", sessionId: "t" })).toEqual([]);
  const tools = liveWebSearchTools({ defaultProviderId: "anthropic", defaultModelId: sonnet, everydayModelId: null }, { caller: "reading", sessionId: "t" });
  expect(tools.map((t) => t.name)).toEqual(["web_search"]);
  expect(Object.keys((tools[0].parameters as { properties: object }).properties)).toEqual(["query"]);
});

test("Anthropic OAuth carries the Claude Code headers, system prompt and the search tool", () => {
  const req = buildSearchRequest(call({ channel: "anthropic", apiKey: "sk-ant-oat-TOKEN" }), "q");
  expect(req.url).toBe("https://api.anthropic.com/v1/messages");
  expect(req.headers.Authorization).toBe("Bearer sk-ant-oat-TOKEN");
  expect(req.headers["x-api-key"]).toBeUndefined();
  expect(req.headers["anthropic-beta"]).toBe("claude-code-20250219,oauth-2025-04-20");
  expect(req.headers["x-app"]).toBe("cli");
  expect(req.body.system).toEqual([{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }]);
  expect(req.body.max_tokens).toBe(8192);
  expect(req.body.tools).toEqual([
    { type: "web_search_20260209", name: "web_search", max_uses: ANTHROPIC_MAX_USES, allowed_callers: ["direct"] },
  ]);
  expect(ANTHROPIC_MAX_USES).toBe(5);
});

test("DeepSeek goes to its /anthropic route with an API key and no Claude Code prompt", () => {
  const req = buildSearchRequest(call({ channel: "deepseek", baseUrl: "https://api.deepseek.com", maxTokens: 6000 }), "q");
  expect(req.url).toBe("https://api.deepseek.com/anthropic/v1/messages");
  expect(req.headers["x-api-key"]).toBe("KEY");
  expect(req.headers.Authorization).toBeUndefined();
  expect(req.body.system).toBeUndefined();
  expect(req.body.max_tokens).toBe(2000);
});

test("Codex adds the account id and the Codex shape; Grok and plain Responses differ in input and include", () => {
  const codex = buildSearchRequest(call({ channel: "codex", baseUrl: "https://chatgpt.com/backend-api", apiKey: codexToken }), "q");
  expect(codex.url).toBe("https://chatgpt.com/backend-api/codex/responses");
  expect(codex.headers["chatgpt-account-id"]).toBe("acct-1");
  expect(codex.headers.originator).toBe("codex_cli_rs");
  expect(codex.body.tool_choice).toBe("required");
  expect(codex.body.include).toEqual(["web_search_call.action.sources"]);
  expect(codex.body.tools).toEqual([{ type: "web_search" }]);

  const grok = buildSearchRequest(call({ channel: "grok", baseUrl: "https://api.x.ai/v1/" }), "q");
  expect(grok.url).toBe("https://api.x.ai/v1/responses");
  expect(grok.body.input).toEqual([{ role: "user", content: "q" }]);
  expect(grok.body.include).toEqual(["web_search_call.action.sources"]);

  const oc = buildSearchRequest(
    call({ channel: "responses", baseUrl: "https://opencode.ai/zen/v1", headers: { "x-opencode-session": "s1" } }),
    "q",
  );
  expect(oc.url).toBe("https://opencode.ai/zen/v1/responses");
  expect(oc.headers["x-opencode-session"]).toBe("s1");
  expect(oc.headers.Authorization).toBe("Bearer KEY");
  expect(oc.body.include).toEqual(["web_search_call.action.sources", "web_search_call.results"]);
});

test("Anthropic: each cited text block ends with its markers, and usage is read", async () => {
  const res = sse([
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 4 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me search. " } },
    { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "s1", name: "web_search", input: {} } },
    {
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [
          { type: "web_search_result", url: "https://a.example/x?utm_source=z", title: "A" },
          { type: "web_search_result", url: "https://b.example/y", title: "B" },
        ],
      },
    },
    { type: "content_block_start", index: 3, content_block: { type: "text", text: "", citations: [] } },
    {
      type: "content_block_delta",
      index: 3,
      delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://b.example/y", title: "B", cited_text: "..." } },
    },
    { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: "Rust 1.99 is out." } },
    { type: "content_block_start", index: 4, content_block: { type: "text", text: " It came out in October." } },
    {
      type: "content_block_delta",
      index: 4,
      delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://a.example/x?utm_source=z#f", title: "A" } },
    },
    { type: "message_delta", usage: { output_tokens: 50 } },
  ]);
  const r = await readAnthropicStream(res, "anthropic");
  expect(r.text).toBe("Let me search. Rust 1.99 is out.[1] It came out in October.[2]");
  expect(r.sources).toEqual([
    { title: "B", url: "https://b.example/y" },
    { title: "A", url: "https://a.example/x" },
  ]);
  expect(r.usage).toEqual({ input: 10, output: 50, cacheRead: 4 });
});

test("Anthropic without citations lists what the search found; DeepSeek search errors throw", async () => {
  const found = await readAnthropicStream(
    sse([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "web_search_tool_result", content: [{ url: "https://c.example/f.zip" }, { url: "https://d.example/" }] },
      },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "Answer." } },
    ]),
    "anthropic",
  );
  expect(found.text).toBe("Answer.");
  expect(found.sources).toEqual([{ title: "d.example", url: "https://d.example/" }]);

  const failing = sse([
    { type: "content_block_start", index: 0, content_block: { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } } },
  ]);
  await expect(readAnthropicStream(failing, "deepseek")).rejects.toThrow("DeepSeek web search failed: unavailable");
});

test("Responses: annotations put [n] at their end index; Codex without annotations falls back to the search's sources", async () => {
  const text = "Rust 1.99 is current.";
  const r = await readResponsesStream(
    sse([
      { type: "response.output_text.delta", delta: text },
      { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://blog.rust-lang.org/1.99", title: "Rust 1.99", end_index: 9 } },
      { type: "response.completed", response: { output: [], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 7 } } },
    ]),
    "responses",
  );
  expect(r.text).toBe("Rust 1.99[1] is current.");
  expect(r.sources).toEqual([{ title: "Rust 1.99", url: "https://blog.rust-lang.org/1.99" }]);
  expect(r.usage).toEqual({ input: 60, output: 7, cacheRead: 40 });

  // What the Codex backend sends (docs/pitfall/568): no annotations, an empty
  // output on completion, and the candidates on the search call. It stops
  // reading at response.completed, since the stream stays open after it.
  const codex = await readResponsesStream(
    sse([
      {
        type: "response.output_item.done",
        item: { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ type: "url", url: "https://doc.rust-lang.org/releases.html" }] } },
      },
      { type: "response.output_text.delta", delta: "See [the blog](https://blog.rust-lang.org/)." },
      { type: "response.completed", response: { output: [], usage: { input_tokens: 5, output_tokens: 2 } } },
      { type: "response.output_text.delta", delta: "never read" },
    ]),
    "codex",
  );
  expect(codex.text).toBe("See [the blog](https://blog.rust-lang.org/).");
  expect(codex.sources).toEqual([
    { title: "the blog", url: "https://blog.rust-lang.org/" },
    { title: "releases.html", url: "https://doc.rust-lang.org/releases.html" },
  ]);

  const grok = await readResponsesStream(
    sse([
      { type: "response.output_text.delta", delta: "Yes [[1]](https://x.example/a)." },
      { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://x.example/a", end_index: 3 } },
    ]),
    "grok",
  );
  expect(grok.text).toBe("Yes [[1]](https://x.example/a).");
  expect(grok.sources).toEqual([{ title: "a", url: "https://x.example/a" }]);

  await expect(readResponsesStream(sse([{ type: "response.failed", response: { error: { message: "quota" } } }]), "responses")).rejects.toThrow("quota");
});

test("a provider error comes back with its status and body", async () => {
  const fetchFn = (async () => new Response('{"error":{"message":"bad model"}}', { status: 400 }));
  await expect(runSearch(call({ channel: "deepseek" }), "q", fetchFn)).rejects.toThrow('DeepSeek API error (400): {"error":{"message":"bad model"}}');
});

test("the result is capped: the answer is cut, the sources stay", () => {
  const sources = Array.from({ length: 30 }, (_, i) => ({ title: `Title ${i} `.repeat(30), url: `https://s${i}.example/page` }));
  const out = formatSearchResult({ text: "word ".repeat(5000), sources });
  expect(out.length).toBeLessThanOrEqual(WEB_SEARCH_MAX_CHARS);
  expect(out).toContain("[answer truncated]");
  expect(out).toContain("[20] ");
  expect(out).toContain("https://s19.example/page");
  expect(out).not.toContain("[21] ");

  const short = formatSearchResult({ text: "Answer[1]", sources: [{ title: "T", url: "https://t.example/" }] });
  expect(short).toBe("Answer[1]\n\nSources:\n[1] T — https://t.example/");
});

test("the tool runs the search on the trimmed query and refuses an empty one", async () => {
  const seen: string[] = [];
  const tool = buildWebSearchTool({
    search: async (q) => {
      seen.push(q);
      return { text: "A[1]", sources: [{ title: "T", url: "https://t.example/" }] };
    },
  });
  expect(tool.name).toBe("web_search");
  expect(tool.replay).toBe("safe");
  expect(await tool.execute({ query: "  rust  " })).toBe("A[1]\n\nSources:\n[1] T — https://t.example/");
  expect(seen).toEqual(["rust"]);
  await expect(tool.execute({ query: " " })).rejects.toThrow("web_search needs a query.");
});
