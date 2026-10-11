// A soul turn nobody is watching, on the soul's held harness: a turn the last
// process died in the middle of being finished (recover.ts, an old soul
// session's, until docs/soul/87 第四阶段), and a bell answered at a place that
// still lays a desk for the harness (bell.ts, deliveryOpener) until it moves
// to the durable runtime. The same call every other soul turn makes, on the
// talk model, with no streaming surface listening — only the end of it is of
// any interest, so the promise settles on that and nothing else.
//
// A bell's turn at a place on the durable runtime runs headless as an
// `rp.turn` instead (reading/turn/place-bell.ts, `headlessPlaceTurn`): it is
// started on the runtime and followed to its landing with no rows drawn.

import { runAgentTurn, type AgentTool } from "../legion/execute/turn";
import type { SteerPort } from "../legion/execute/contract";
import type { HeldHarness } from "../legion/execute/held";
import type { DeskMessage } from "../desk";
import type { ProviderId } from "../ai";
import { modelIdFor } from "../ai/model-tier";
import { toReasoning, type Settings } from "../platform/app/settings";
import type { AiSurface } from "../platform/app/cache-telemetry";

export interface HeadlessTurn {
  settings: Settings;
  systemPrompt: string;
  messages: DeskMessage[];
  tools: AgentTool[];
  harness: HeldHarness;
  /** Which face of the app this turn is, for the cache accounting. */
  surface: AiSurface;
  threadId: string;
  signal?: AbortSignal;
  onSteerable?: (port: SteerPort) => void;
  deliverTo?: Record<string, unknown>;
  /** Finish this operation on the harness instead of sending `messages`. */
  resume?: string;
}

/** Runs the turn and answers with everything it said, or rejects with why it did not. */
export function sendHeadless(turn: HeadlessTurn): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void runAgentTurn({
      providerId: turn.settings.defaultProviderId as ProviderId,
      modelId: modelIdFor(turn.settings, "talk") as string,
      systemPrompt: turn.systemPrompt,
      messages: turn.messages,
      tools: turn.tools,
      harness: turn.harness,
      ...(turn.resume ? { resume: turn.resume } : {}),
      ...(turn.signal ? { signal: turn.signal } : {}),
      ...(turn.onSteerable ? { onSteerable: turn.onSteerable } : {}),
      ...(turn.deliverTo ? { deliverTo: turn.deliverTo } : {}),
      reasoning: toReasoning(turn.settings.chatThinking),
      telemetry: { surface: turn.surface, thread: turn.threadId },
      onDelta: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onDone: (finalText, _assistant, turnText) => resolve(turnText || finalText),
      onError: (message: string) => reject(new Error(message)),
      onRefusal: (message: string) => reject(new Error(message)),
    });
  });
}
