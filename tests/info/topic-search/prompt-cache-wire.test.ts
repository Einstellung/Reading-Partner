// Where a topic search's model calls put Anthropic's cache breakpoints, read
// off the request that leaves (the real provider object through the live
// result deps; settings, the key and fetch faked, nothing reaches the network).
// A call no later call repeats sends none: a breakpoint there writes the whole
// prompt at 1.25x and nothing reads it (pitfall 663). The write-up's second try
// sends the first try's text as its own block, so the breakpoint the first try
// wrote sits on a block boundary of the second and is read.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as providersModule from "../../../src/ai/providers";
import * as settings from "../../../src/platform/app/settings";
import { liveResultDeps } from "../../../src/info/topic-search/build-live";

interface Sent {
  system?: { type: string; text: string; cache_control?: unknown }[];
  messages: { role: string; content: string | { type: string; text: string; cache_control?: unknown }[] }[];
}

let sent: Sent[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  const model = providersModule.providers["anthropic-api"].getModels()[0]!.id;
  spyOn(settings, "loadSettings").mockResolvedValue({
    ...settings.DEFAULT_SETTINGS,
    defaultProviderId: "anthropic-api",
    defaultModelId: model,
    everydayModelId: null,
  });
  spyOn(providersModule, "resolveApiKey").mockResolvedValue("sk-ant-api03-test");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    sent.push(JSON.parse(await req.text()));
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stop" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function send(call: { user: string; tail?: string[]; cache: boolean }): Promise<Sent> {
  await liveResultDeps
    .model({ site: call.cache ? "write" : "rerank", system: "Rank these.", ...call, signal: new AbortController().signal })
    .catch(() => {});
  expect(sent).toHaveLength(1);
  return sent.pop()!;
}

test("a stage that calls once sends no cache breakpoint at all", async () => {
  const body = await send({ user: "Topic: cells\nCandidates: …", cache: false });
  expect(JSON.stringify(body)).not.toContain("cache_control");
  expect(body.messages).toEqual([{ role: "user", content: "Topic: cells\nCandidates: …" }]);
});

test("the write-up's first try ends its prompt with a breakpoint, and the second try reads up to it", async () => {
  const user = "Topic: cells\nItems: …";
  const first = await send({ user, cache: true });
  expect(first.system?.[0].cache_control).toEqual({ type: "ephemeral" });
  expect(first.messages).toEqual([{ role: "user", content: [{ type: "text", text: user, cache_control: { type: "ephemeral" } }] }]);

  const problems = "Your previous answer had these problems; write it again:\n- The overview is missing.";
  const second = await send({ user, tail: [problems], cache: true });
  expect(second.system).toEqual(first.system);
  // The first try's text is a block of its own, unchanged: the breakpoint the
  // first try wrote is at this block's end, inside the second try's lookback.
  expect(second.messages).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: user },
        { type: "text", text: problems, cache_control: { type: "ephemeral" } },
      ],
    },
  ]);
});
