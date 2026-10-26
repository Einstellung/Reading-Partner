// The provider connection's bytes, by provider session (src/ai/provider-bytes.ts):
// every chunk is heard before any parser sees it, SSE comments included, and
// the body reads back unchanged.
// Run: scripts/t.sh tests/ai/provider-bytes.test.ts

import type { FetchFunction } from "@earendil-works/pi-ai";
import { expect, test } from "bun:test";
import { onProviderBytes, tappingBytes } from "../../src/ai/provider-bytes";

const SSE = [": keepalive\n\n", ": keepalive\n\n", 'event: response.completed\ndata: {"type":"response.completed"}\n\n'];

/** A provider that answers every request with `chunks`, one body chunk each. */
function provider(chunks: string[], status = 200): FetchFunction {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const response = new Response(body, { status, statusText: "Whatever", headers: { "x-request-id": "r1" } });
    Object.defineProperty(response, "url", { value: "https://provider.test/v1/responses" });
    return response;
  }) as unknown as FetchFunction;
}

test("every chunk of a session's response is heard, comments included, and the body is unchanged", async () => {
  let mine = 0;
  let theirs = 0;
  const stopMine = onProviderBytes("s1", () => (mine += 1));
  const stopTheirs = onProviderBytes("s2", () => (theirs += 1));
  try {
    const options = tappingBytes({ sessionId: "s1", fetch: provider(SSE) });
    const response = await options.fetch!("https://provider.test/v1/responses");
    expect([response.status, response.statusText, response.headers.get("x-request-id"), response.url]).toEqual([
      200,
      "Whatever",
      "r1",
      "https://provider.test/v1/responses",
    ]);
    expect(await response.text()).toBe(SSE.join(""));
    expect(mine).toBe(3);
    expect(theirs).toBe(0);
  } finally {
    stopMine();
    stopTheirs();
  }
});

test("a listener that stopped hears nothing more", async () => {
  let heard = 0;
  onProviderBytes("s3", () => (heard += 1))();
  const options = tappingBytes({ sessionId: "s3", fetch: provider(SSE) });
  await (await options.fetch!("https://provider.test/v1/responses")).text();
  expect(heard).toBe(0);
});

test("options without a provider session pass through", () => {
  const options: { maxRetries: number; sessionId?: string } = { maxRetries: 2 };
  expect(tappingBytes(options)).toBe(options);
});
