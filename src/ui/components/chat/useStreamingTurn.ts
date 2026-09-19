// One AI turn streaming into a conversation: the rows it writes, the controller
// that stops it, and the six callbacks runAgentTurn hands the surface back.
//
// The coach (rehearsal) and the retell both hold a conversation whose turns are
// assembled from a file the AI may write to mid-turn, and both streamed them the
// same way down to the character. What differs is only what the turn is made of
// and what happens once it settles, so that is what stays at the call sites.
// The row arithmetic itself has no React in it and lives in streaming-turn.ts.

import { useCallback, useRef, useState } from "react";
import type { AgentCallbacks } from "../../../legion/execute/contract";
import { appendMessage } from "../../../platform/app/threads";
import { phaseOnToolStart, refusalRow } from "../../../ai/turn-rows";
import {
  cardRow,
  insertBeforeLast,
  nextCardId,
  toPersistedCardPart,
  type CardPayload,
} from "./chatParts";
import {
  answeredRow,
  dropAiRow,
  openAnswerRow,
  patchAiRow,
  withDelta,
  withPhase,
  withToolEnd,
  withToolStart,
} from "./streaming-turn";
import type { TurnPhase } from "../../../ai/turn-rows";
import type { ThreadMessage } from "./types";

// The callbacks a caller passes straight through to runAgentTurn.
type TurnHandlers = Pick<
  AgentCallbacks,
  "onDelta" | "onThinking" | "onToolStart" | "onToolEnd" | "onDone" | "onError" | "onRefusal"
>;

export interface StreamingTurnRun {
  // The timestamp of the row being answered into, and the id the reply is
  // persisted under.
  ts: number;
  signal: AbortSignal;
  // The loop declined rather than failed to reach the model, so the sentence is
  // the app talking about the turn, not a reply (turn-rows.ts).
  decline(message: string): void;
  // `notice` is what the turn had to leave out to fit the window; it is known
  // only once the turn has been assembled, so it is given here rather than at
  // begin().
  handlers(notice?: string): TurnHandlers;
}

export interface StreamingTurn {
  messages: ThreadMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ThreadMessage[]>>;
  streaming: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  patchRow(ts: number, fn: (m: ThreadMessage) => ThreadMessage): void;
  // A receipt for something the AI just wrote: shown above the reply being
  // written and persisted with it, so a reopened conversation still shows what
  // landed. Only the id prefix differs between the kinds of card.
  raiseCard(prefix: string, payload: CardPayload): void;
  // Opens the row the answer streams into and takes the turn in flight.
  begin(): StreamingTurnRun;
  // Whether a turn is in flight.
  running(): boolean;
  stop(): void;
  // Stops the turn without keeping the half sentence: the way out when the view
  // is going away rather than the reader pressing stop.
  abort(): void;
}

export function useStreamingTurn(
  key: string,
  threadId: string,
  // Work owed to the moment the turn settles, however it ended. The retell's
  // exit distillation waits on it; the coach has nothing to hand over.
  onSettled?: () => void,
): StreamingTurn {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const partialRef = useRef<{ ts: number; text: string } | null>(null);
  // The phase the row was last told about. Thinking deltas arrive by the
  // hundred and say nothing the line does not already say, so only a change of
  // phase is written through.
  const phaseRef = useRef<TurnPhase | null>(null);

  // Read rather than closed over, so begin() stays stable across renders.
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const patchRow = useCallback((ts: number, fn: (m: ThreadMessage) => ThreadMessage) => {
    setMessages((rows) => patchAiRow(rows, ts, fn));
  }, []);

  const raiseCard = useCallback(
    (prefix: string, payload: CardPayload) => {
      const cardId = nextCardId(prefix);
      const cardTs = Date.now();
      setMessages((rows) => insertBeforeLast(rows, cardRow(cardId, payload, cardTs)));
      appendMessage(key, threadId, {
        role: "ai",
        text: "",
        ts: cardTs,
        parts: [toPersistedCardPart(cardId, payload)],
      });
    },
    [key, threadId],
  );

  const begin = useCallback((): StreamingTurnRun => {
    const controller = new AbortController();
    abortRef.current = controller;
    const ts = Date.now();
    partialRef.current = { ts, text: "" };
    phaseRef.current = null;
    setError(null);
    setStreaming(true);
    setMessages((rows) => openAnswerRow(rows, ts));

    const finish = () => {
      if (abortRef.current === controller) abortRef.current = null;
      partialRef.current = null;
      phaseRef.current = null;
      setStreaming(false);
    };
    // The turn is over, however it ended. Work waiting on it takes the
    // conversation as it stands: the reader's half is on disk either way, and a
    // reply that failed is no reason to lose what they said.
    const settle = () => settledRef.current?.();
    const fail = (text: string) => {
      finish();
      patchRow(ts, () => ({ role: "ai", text, ts, failed: true }));
      settle();
    };
    const decline = (message: string) => {
      finish();
      patchRow(ts, (m) => ({ ...m, ...refusalRow(m, message), phase: undefined }));
      settle();
    };

    return {
      ts,
      signal: controller.signal,
      decline,
      handlers: (notice?: string) => ({
        onDelta: (chunk) => {
          const p = partialRef.current;
          if (p) p.text += chunk;
          phaseRef.current = "writing";
          patchRow(ts, (m) => withDelta(m, chunk));
        },
        // The thinking itself is dropped; only that it is happening is shown.
        onThinking: () => {
          if (phaseRef.current === "thinking") return;
          phaseRef.current = "thinking";
          patchRow(ts, (m) => withPhase(m, "thinking"));
        },
        // A quiet call leaves the phase where it was, so the row goes on saying
        // whatever it was saying (turn-rows.ts).
        onToolStart: (info) => {
          phaseRef.current = phaseOnToolStart(phaseRef.current, info.quiet) ?? null;
          patchRow(ts, (m) => withToolStart(m, info));
        },
        onToolEnd: (info) => patchRow(ts, (m) => withToolEnd(m, info)),
        // Every round's words, not the answering round's alone: a round that
        // called a tool may have written a sentence first, and it has been on
        // screen since (withToolStart keeps it), so it is part of the reply.
        onDone: (finalText, _assistant, turnText) => {
          if (controller.signal.aborted) return; // stop() already kept the partial
          const full = turnText || finalText;
          finish();
          patchRow(ts, (m) => answeredRow(m, full, ts, notice));
          appendMessage(key, threadId, { role: "ai", text: full, ts });
          // After the append, never before: work deferred to the settle reads
          // the thread file, which only now holds the reply.
          settle();
        },
        onError: (message) => fail(`⚠️ Couldn't reach the model. ${message}`),
        onRefusal: (message) => decline(message),
      }),
    };
  }, [key, threadId, patchRow]);

  const running = useCallback(() => abortRef.current !== null, []);

  // Stop keeps the half sentence: the abort silences the agent, so persisting it
  // here is the only way it survives.
  const stop = useCallback(() => {
    const controller = abortRef.current;
    const partial = partialRef.current;
    if (!controller) return;
    controller.abort();
    abortRef.current = null;
    setStreaming(false);
    const text = (partial?.text ?? "").trim();
    if (partial && text) {
      appendMessage(key, threadId, { role: "ai", text, ts: partial.ts });
      patchRow(partial.ts, () => ({ role: "ai", text, ts: partial.ts }));
    } else if (partial) {
      setMessages((rows) => dropAiRow(rows, partial.ts));
    }
    partialRef.current = null;
  }, [key, threadId, patchRow]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return {
    messages,
    setMessages,
    streaming,
    error,
    setError,
    patchRow,
    raiseCard,
    begin,
    running,
    stop,
    abort,
  };
}
