// Server-sent events off a fetch Response, one parsed JSON payload at a time.
//
// Portions adapted from pi-web-search by ttttmr (https://www.npmjs.com/package/pi-web-search),
// MIT License; see LICENSE.pi-web-search in this directory.

export interface SseEvent {
  event: string;
  data: any;
}

/**
 * Read `response` as SSE and hand each event's JSON to `onEvent`. Returning
 * true from `onEvent` stops reading. A payload that is not JSON (`[DONE]`, a
 * keep-alive) is skipped.
 */
export async function readSseEvents(
  response: Response,
  signal: AbortSignal | undefined,
  onEvent: (event: SseEvent) => boolean | void,
): Promise<void> {
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data = "";
  let name = "";
  let stopped = false;
  let reachedEof = false;

  const flush = (): boolean => {
    if (!data) return false;
    const raw = data.trim();
    const eventName = name;
    data = "";
    name = "";
    if (!raw || raw === "[DONE]") return false;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    return onEvent({ event: eventName, data: parsed }) === true;
  };

  const take = (line: string) => {
    if (line.startsWith("data:")) {
      const chunk = line.slice(5).trim();
      data = data ? `${data}\n${chunk}` : chunk;
    } else if (line.startsWith("event:")) {
      name = line.slice(6).trim();
    }
  };

  try {
    read: while (true) {
      if (signal?.aborted) throw new Error("Request was aborted");
      const { done, value } = await reader.read();
      if (done) {
        reachedEof = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "" || line === "\r") {
          if (flush()) {
            stopped = true;
            break read;
          }
          continue;
        }
        take(line.endsWith("\r") ? line.slice(0, -1) : line);
      }
    }
    if (!stopped) {
      if (buffer.trim()) take(buffer.trim());
      flush();
    }
  } finally {
    if (!reachedEof) {
      try {
        await reader.cancel();
      } catch {
        // The stream is being abandoned either way.
      }
    }
    reader.releaseLock();
  }
}
