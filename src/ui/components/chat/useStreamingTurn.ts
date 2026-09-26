// One AI turn streaming into a conversation: the rows it writes, the controller
// that stops it, and the callbacks runAgentTurn hands the surface back.
//
// Every chat surface but the reading call streams through this: the coach
// (rehearsal), the retell, the phone lesson and the info companion. What
// differs between them is only what the turn is made of and what happens once
// it settles, so that is what stays at the call sites. What a turn does to its
// row is applyRowChange (ai/turn-view/turn-rows.ts), the reducer the reading call runs
// too; which row that is lives in streaming-turn.ts.

import { useCallback, useRef, useState } from "react";
import type { AgentCallbacks } from "../../../legion/execute/contract";
import { isStall } from "../../../legion/execute/stall";
import { appendMessage } from "../../../platform/app/threads";
import {
  applyRowChange,
  phaseOnToolStart,
  type RowChange,
  type TurnPhase,
} from "../../../ai/turn-view/turn-rows";
import {
  cardRow,
  insertBeforeLast,
  nextCardId,
  toPersistedCardPart,
  toPersistedTracePart,
  type CardPayload,
} from "./chatParts";
import { answerRow, dropAiRow, openAnswerRow, patchAiRow } from "./streaming-turn";
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
  // The turn could not be sent at all, for a reason the surface words itself.
  // The sentence stands in the row as a failure.
  fail(text: string): void;
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
  // Opens the row the answer streams into and hands `ask` the turn in flight.
  // `ask` assembles the turn and sends it; it is called a second time, with a
  // fresh row, when the first attempt's stream went silent (see onError below),
  // so it has to read what it sends from where it lives rather than from the
  // rows on screen.
  begin(ask: (run: StreamingTurnRun) => void): void;
  // Whether a turn is in flight.
  running(): boolean;
  stop(): void;
  // Stops the turn without keeping the half sentence: the way out when the view
  // is going away rather than the reader pressing stop.
  abort(): void;
}

// The turn in flight: its controller, and its own copy of the row it writes.
// The copy is what stop() keeps and what the trace is persisted from, read
// here rather than out of the rows on screen.
interface LiveTurn {
  controller: AbortController;
  row: ThreadMessage;
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

  const liveRef = useRef<LiveTurn | null>(null);

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

  const begin = useCallback(
    (ask: (run: StreamingTurnRun) => void) => {
      const attempt = (n: number) => {
        const controller = new AbortController();
        const ts = Date.now();
        const live: LiveTurn = { controller, row: answerRow(ts) };
        liveRef.current = live;
        setError(null);
        setStreaming(true);
        setMessages((rows) => openAnswerRow(rows, ts));

        // One change, applied to both copies of the row.
        const write = (change: RowChange) => {
          live.row = applyRowChange(live.row, change);
          patchRow(ts, (m) => applyRowChange(m, change));
        };
        // The phase the row was last told about. Thinking deltas arrive by the
        // hundred and say nothing the line does not already say, so only a
        // change of phase is written through.
        let phase: TurnPhase | null = null;

        const finish = () => {
          if (liveRef.current === live) liveRef.current = null;
          setStreaming(false);
        };
        // The turn is over, however it ended. Work waiting on it takes the
        // conversation as it stands: the reader's half is on disk either way,
        // and a reply that failed is no reason to lose what they said.
        const settle = () => settledRef.current?.();
        const fail = (text: string) => {
          finish();
          write({ kind: "error", text });
          settle();
        };
        const decline = (message: string) => {
          finish();
          write({ kind: "refusal", text: message });
          settle();
        };
        // The abort is a request: the stream can still land a word after stop()
        // has settled the row, and the row is not reopened for it.
        const stopped = () => controller.signal.aborted;

        ask({
          ts,
          signal: controller.signal,
          decline,
          fail,
          handlers: (notice?: string) => ({
            onDelta: (chunk) => {
              if (stopped()) return;
              phase = "writing";
              write({ kind: "delta", chunk });
            },
            // The thinking itself is dropped; only that it is happening is shown.
            onThinking: () => {
              if (stopped() || phase === "thinking") return;
              phase = "thinking";
              write({ kind: "phase", phase: "thinking" });
            },
            // A quiet call leaves the phase where it was, so the row goes on
            // saying whatever it was saying (turn-rows.ts).
            onToolStart: (info) => {
              if (stopped()) return;
              phase = phaseOnToolStart(phase, info.quiet) ?? null;
              write({
                kind: "tool-start",
                name: info.name,
                label: info.label,
                ...(info.quiet ? { quiet: true as const } : {}),
              });
            },
            onToolEnd: (info) => {
              if (stopped()) return;
              write({
                kind: "tool-end",
                name: info.name,
                isError: info.isError,
                ...(info.receipt ? { receipt: info.receipt } : {}),
                ...(info.error ? { error: info.error } : {}),
              });
            },
            // Every round's words, not the answering round's alone: a round that
            // called a tool may have written a sentence first, and it has been
            // on screen since (the tool start keeps it), so it is part of the
            // reply.
            onDone: (finalText, _assistant, turnText) => {
              if (stopped()) return; // stop() already kept the partial
              const full = turnText || finalText;
              finish();
              write({ kind: "answer", text: full, ...(notice ? { notice } : {}) });
              // The settled trace goes to disk with the answer: what the turn did
              // is part of the reply, and the lesson reads which chapters it
              // taught back off it (reading/lesson/thread-state.ts).
              const trace = toPersistedTracePart(live.row.tools ?? []);
              appendMessage(key, threadId, {
                role: "ai",
                text: full,
                ts,
                ...(trace ? { parts: [trace] } : {}),
              });
              // After the append, never before: work deferred to the settle reads
              // the thread file, which only now holds the reply.
              settle();
            },
            onError: (message, _assistant, thrown) => {
              if (stopped()) return;
              // The stream went silent and the watch cut it
              // (legion/execute/stall.ts): the app was switched away mid-answer
              // and the connection did not survive being frozen. The question
              // is in the thread file, so the turn is asked again in a fresh row
              // and the half-written one goes; what the reader gets is a reply
              // that arrived late (docs/pitfall/390). Nothing settles here: the
              // turn is not over until the second attempt is.
              //
              // Once. A second stall is a failure like any other, and the reader
              // is shown it rather than left watching the same turn go around.
              if (isStall(thrown) && n === 0) {
                finish();
                setMessages((rows) => dropAiRow(rows, ts));
                attempt(n + 1);
                return;
              }
              fail(`⚠️ Couldn't reach the model. ${message}`);
            },
            onRefusal: (message) => {
              if (stopped()) return;
              decline(message);
            },
          }),
        });
      };
      attempt(0);
    },
    [key, threadId, patchRow],
  );

  const running = useCallback(() => liveRef.current !== null, []);

  // Stop keeps the half sentence: the abort silences the agent, so persisting it
  // here is the only way it survives.
  const stop = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    live.controller.abort();
    liveRef.current = null;
    setStreaming(false);
    const { ts } = live.row;
    const text = live.row.text.trim();
    if (text) {
      appendMessage(key, threadId, { role: "ai", text, ts });
      patchRow(ts, (m) => applyRowChange(m, { kind: "stopped", text }));
    } else {
      setMessages((rows) => dropAiRow(rows, ts));
    }
  }, [key, threadId, patchRow]);

  const abort = useCallback(() => {
    liveRef.current?.controller.abort();
    liveRef.current = null;
    setStreaming(false);
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
