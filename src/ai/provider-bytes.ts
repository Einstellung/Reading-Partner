// Every chunk a provider's response body delivers, before any parser sees it,
// by the provider session the request named (pi-durable's `pi.provider`
// document gives each conversation one, and every request of the conversation
// carries it). A turn's stall watch listens here (reading/turn/durable-turn.ts):
// a connection is alive while bytes arrive on it, whatever they parse into.
// The ChatGPT backend reasons for half a minute between parsed events and keeps
// the connection up with an SSE comment line every 5 s, which pi-ai's SSE
// parser drops, so parsed events alone say a live stream is silent.
//
// Keyed rather than process-wide: a background pass streaming beside a turn
// must not keep that turn's dead connection looking alive.

import type { FetchFunction } from "@earendil-works/pi-ai";

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Call `listener` for every body chunk a request of provider session `sessionId` receives; the returned function stops it. */
export function onProviderBytes(sessionId: string, listener: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(sessionId) === set) listeners.delete(sessionId);
  };
}

function heard(sessionId: string): void {
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

/** `response` with a body that calls `onChunk` for each chunk as it is read. */
function tapped(response: Response, onChunk: () => void): Response {
  if (!response.body) return response;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (chunk.byteLength > 0) onChunk();
        controller.enqueue(chunk);
      },
    }),
  );
  const copy = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  // `url` cannot be set through the constructor; the Tauri http plugin sets it the same way.
  Object.defineProperty(copy, "url", { value: response.url });
  return copy;
}

/**
 * Stream options whose fetch reports every body chunk for the provider session
 * they name. Options without a session pass through.
 */
export function tappingBytes<O extends { sessionId?: string; fetch?: FetchFunction }>(options: O): O {
  const { sessionId } = options;
  if (!sessionId) return options;
  const inner = options.fetch;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    tapped(await (inner ?? globalThis.fetch)(input, init), () => heard(sessionId))) as FetchFunction;
  return { ...options, fetch };
}
