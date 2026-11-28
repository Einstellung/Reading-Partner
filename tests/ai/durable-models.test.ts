import { describe, expect, spyOn, test } from "bun:test";
import * as credentials from "../../src/ai/auth/credentials";
import { createAppModels } from "../../src/ai/durable-models";
import { PROVIDER_IDS, providers, transportFor } from "../../src/ai/providers";

// Durable turns name their model by this app's provider id (settings.defaultProviderId),
// which is not always pi's: our "openai" is pi's "openai-codex".
describe("createAppModels", () => {
  test("every app provider id resolves its own models", () => {
    const models = createAppModels();
    for (const id of PROVIDER_IDS) {
      const first = providers[id].getModels()[0];
      if (!first) continue;
      expect(models.getModel(id, first.id)?.id).toBe(first.id);
    }
  });

  test("ChatGPT and OpenAI API resolve the same model id to different providers", () => {
    const models = createAppModels();
    const id = "gpt-6.1-terra";
    const chatgpt = models.getModel("openai", id);
    expect(chatgpt?.provider).toBe("openai-codex");
    expect(models.getModel("openai-codex", id)).toBe(chatgpt);
    expect(chatgpt?.baseUrl).toBe("https://chatgpt.com/backend-api");
    expect(transportFor("openai")).toBe("sse");
    expect(models.getModel("openai-api", id)?.provider).toBe("openai-api");
    expect(transportFor("openai-api")).toBeUndefined();
  });

  test("OpenAI API sends the saved key and replays Responses tool IDs across models", async () => {
    const key = "sk-test-openai";
    const saved = spyOn(credentials, "loadCredentials").mockResolvedValue({
      "openai-api": { type: "apiKey", key },
    });
    try {
      const models = createAppModels();
      const terra = models.getModel("openai-api", "gpt-6.1-terra")!;
      const sol = models.getModel("openai-api", "gpt-6.1-sol")!;
      const item = {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "lookup",
        arguments: "{}",
        status: "completed",
      };
      const complete = { type: "response.completed", response: { id: "r1", status: "completed" } };
      const seen: { url: string; authorization: string | null; body: Record<string, unknown> }[] = [];
      const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        seen.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
          body: await request.json(),
        });
        const events = seen.length === 1
          ? [{ type: "response.output_item.done", output_index: 0, item }, complete]
          : [complete];
        const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      }) as typeof globalThis.fetch;
      const user = { role: "user", content: "Look it up", timestamp: 1 } as const;
      const first = await models.completeSimple(terra, { messages: [user] }, { fetch, maxTokens: 128 });
      expect(first.stopReason).toBe("toolUse");
      expect(first.provider).toBe("openai");
      expect(first.content[0]).toMatchObject({ type: "toolCall", id: "call_1|fc_1" });
      const second = await models.completeSimple(sol, {
        messages: [user, first, {
          role: "toolResult",
          toolName: "lookup",
          toolCallId: "call_1|fc_1",
          content: [{ type: "text", text: "Found it" }],
          isError: false,
          timestamp: 2,
        }],
      }, { fetch });
      expect(second.stopReason).toBe("stop");
      expect(seen).toHaveLength(2);
      for (const request of seen) {
        expect(request.url).toBe("https://api.openai.com/v1/responses");
        expect(request.authorization).toBe(`Bearer ${key}`);
      }
      expect(seen[0]!.body).toMatchObject({ model: terra.id, max_output_tokens: 128 });
      expect(seen[1]!.body.model).toBe(sol.id);
      expect(seen[1]!.body.input).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "function_call", call_id: "call_1" }),
        expect.objectContaining({ type: "function_call_output", call_id: "call_1", output: "Found it" }),
      ]));
    } finally {
      saved.mockRestore();
    }
  });
});
