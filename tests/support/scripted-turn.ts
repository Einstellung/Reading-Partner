// A scripted model turn, streamed the way a provider streams one.
//
// The harness encodes every stream event into a durable frame as it arrives,
// and the encoder holds the stream to the provider grammar: `start` first, then
// each content block opened, delivered and closed, then `done` or `error`. A
// fixture that pushes a bare text_delta and a done — which the hand-written
// loop was happy with — faults the harness on the first delta
// (docs/pitfall/306). So every test that scripts a turn builds its events here.

import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";

export type ToolReq = { name: string; args: Record<string, any>; id?: string };

// Either a `done` (optional text + optional tool calls) or an `error`. `usage`
// sets the finished message's reported total, which is what makes pi's
// estimator switch to its usage shortcut on the next round. `reason: "aborted"`
// is how pi reports a stream the signal cut off: the message carries the same
// stop reason.
export type Turn =
  | { text?: string; calls?: ToolReq[]; usage?: number }
  | { error: string; reason?: "error" | "aborted"; text?: string };

// The events that stream `message`: start, every block start/delta/end in
// content order, then done — or error when the message is a failed one. The
// partial grows block by block the way the faux provider's does, because the
// encoder keys its deltas off what the partial already shows.
export function messageEvents(message: AssistantMessage): AssistantMessageEvent[] {
  const partial: AssistantMessage = { ...message, content: [] };
  const snapshot = (): AssistantMessage => ({ ...partial, content: [...partial.content] });
  const events: AssistantMessageEvent[] = [{ type: "start", partial: snapshot() }];
  message.content.forEach((block, contentIndex) => {
    if (block.type === "text") {
      partial.content = [...partial.content, { type: "text", text: "" }];
      events.push({ type: "text_start", contentIndex, partial: snapshot() });
      if (block.text) {
        partial.content[contentIndex] = { type: "text", text: block.text };
        events.push({ type: "text_delta", contentIndex, delta: block.text, partial: snapshot() });
      }
      events.push({ type: "text_end", contentIndex, content: block.text, partial: snapshot() });
    } else if (block.type === "thinking") {
      partial.content = [...partial.content, { type: "thinking", thinking: "" }];
      events.push({ type: "thinking_start", contentIndex, partial: snapshot() });
      if (block.thinking) {
        partial.content[contentIndex] = { type: "thinking", thinking: block.thinking };
        events.push({ type: "thinking_delta", contentIndex, delta: block.thinking, partial: snapshot() });
      }
      events.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: snapshot() });
    } else if (block.type === "toolCall") {
      partial.content = [...partial.content, { ...block, arguments: {} }];
      events.push({ type: "toolcall_start", contentIndex, partial: snapshot() });
      partial.content[contentIndex] = block;
      events.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: snapshot() });
    }
  });
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    events.push({ type: "error", reason: message.stopReason, error: message });
  } else {
    events.push({
      type: "done",
      reason: message.stopReason as "stop" | "toolUse" | "length" | "deferred",
      message,
    });
  }
  return events;
}

export function turnEvents(turn: Turn): AssistantMessageEvent[] {
  if ("error" in turn) {
    const stopReason = turn.reason ?? "error";
    return messageEvents(fauxAssistantMessage(turn.text ?? "", { stopReason, errorMessage: turn.error }));
  }
  const blocks = [
    ...(turn.text ? [fauxText(turn.text)] : []),
    ...(turn.calls ?? []).map((c) => fauxToolCall(c.name, c.args, { id: c.id })),
  ];
  const hasCalls = (turn.calls ?? []).length > 0;
  const message: AssistantMessage = fauxAssistantMessage(blocks.length ? blocks : "", {
    stopReason: hasCalls ? "toolUse" : "stop",
  });
  if (turn.usage) message.usage = { ...message.usage, input: turn.usage, totalTokens: turn.usage };
  return messageEvents(message);
}
