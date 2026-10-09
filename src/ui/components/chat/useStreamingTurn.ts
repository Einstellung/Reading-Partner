// One AI turn streaming into a conversation: the rows it writes, the controller
// that stops it, and the callbacks runAgentTurn hands the surface back.
//
// Every chat surface but the reading call streams through this: the coach
// (rehearsal), the retell, the phone lesson and the info companion. What
// differs between them is only what the turn is made of and what happens once
// it settles, so that is what stays at the call sites. What a turn does to its
// row is applyRowChange (ai/turn-view/turn-rows.ts), the reducer the reading call runs
// too; which row that is lives in streaming-turn.ts.
//
// The reader can talk into a turn that is running (docs/72), the way the
// reading call takes it (reading/session/use-call.ts): the line is queued into
// the turn and the model is handed it at the end of the round in flight. The
// bookkeeping is the reading call's own: which lines the model has
// (reading/turn/steering.ts) and which row the reply that follows goes into
// (reading/turn/turn-row-split.ts). Only a surface that calls steer() uses it.

import { useCallback, useRef, useState } from "react";
import type { AgentCallbacks } from "../../../legion/execute/contract";
import { isStall } from "../../../legion/execute/stall";
import { appendMessage } from "../../../platform/app/threads";
import {
  applyRowChange,
  keptOnStop,
  phaseOnToolStart,
  type RowChange,
  type TurnPhase,
} from "../../../ai/turn-view/turn-rows";
import { createSteering, type PendingSteer, type Steering } from "../../../reading/turn/steering";
import { createRowSplit, type RowSplit } from "../../../reading/turn/turn-row-split";
import {
  cardRow,
  nextCardId,
  toPersistedCardPart,
  toPersistedTracePart,
  type CardPayload,
} from "./chatParts";
import {
  answerRow,
  deliverRows,
  dropAiRow,
  insertAbove,
  openAnswerRow,
  patchAiRow,
  queuedRow,
  splitRows,
} from "./streaming-turn";
import type { ThreadMessage } from "./types";

// The callbacks a caller passes straight through to runAgentTurn.
type TurnHandlers = Pick<
  AgentCallbacks,
  | "onDelta"
  | "onThinking"
  | "onToolStart"
  | "onToolEnd"
  | "onSteerable"
  | "onSteered"
  | "onDone"
  | "onError"
  | "onRefusal"
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
  // `ask` assembles the turn and sends it. It is called again, with a fresh
  // row, when the first attempt's stream went silent (see onError below) and
  // when the turn ended with lines the reader said into it that the model never
  // took, so it reads what it sends from where it lives (rows(), the thread
  // file) at the moment it is called, never from what it was first called with.
  begin(ask: (run: StreamingTurnRun) => void): void;
  // The conversation as it stands, every change applied, including the ones
  // React has not drawn yet.
  rows(): ThreadMessage[];
  // The reader said `text` while a turn is in flight (docs/72): drawn now under
  // the reply, marked queued, and handed to the model at the end of the round
  // in flight. False when no turn is running: the caller sends it as a turn of
  // its own. Text only; images do not ride a steer.
  steer(text: string): boolean;
  // Whether a turn is in flight.
  running(): boolean;
  stop(): void;
  // Stops the turn without keeping the half sentence: the way out when the view
  // is going away rather than the reader pressing stop.
  abort(): void;
}

// The turn in flight: its controller, and its own copy of the row it writes.
// The copy is what stop() keeps and what the trace is persisted from, read
// here rather than out of the rows on screen. The row moves when the reader
// speaks into the turn and the reply that follows gets a row of its own.
interface LiveTurn {
  controller: AbortController;
  row: ThreadMessage;
  steering: Steering;
  split: RowSplit;
  // The lines the model never took go into the thread file as the turn ends
  // (docs/72). True when there were any. Once per turn, however many endings
  // reach it.
  putBack(): boolean;
  // Opens the turn that answers them.
  again(): void;
}

export function useStreamingTurn(
  key: string,
  threadId: string,
  // Work owed to the moment the turn settles, however it ended. The retell's
  // exit distillation waits on it; the coach has nothing to hand over.
  onSettled?: () => void,
): StreamingTurn {
  const [messages, setRendered] = useState<ThreadMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every change goes through here and lands on the mirror at once, so a turn
  // asked again in the same tick reads the conversation it is answering, not
  // the last one React drew.
  const rowsRef = useRef<ThreadMessage[]>([]);
  const setMessages = useCallback<React.Dispatch<React.SetStateAction<ThreadMessage[]>>>((action) => {
    rowsRef.current = typeof action === "function" ? action(rowsRef.current) : action;
    setRendered(rowsRef.current);
  }, []);
  const rows = useCallback(() => rowsRef.current, []);

  const liveRef = useRef<LiveTurn | null>(null);

  // Rows the reader's lines open are keyed by when they were said, and two in
  // one millisecond would be one row. Kept strictly increasing, and the rows a
  // turn opens are stamped from it too, so a reply sorts after the lines it
  // answers.
  const lastTsRef = useRef(0);
  const stamp = useCallback(() => {
    const at = Math.max(Date.now(), lastTsRef.current + 1);
    lastTsRef.current = at;
    return at;
  }, []);

  // Read rather than closed over, so begin() stays stable across renders.
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const patchRow = useCallback(
    (ts: number, fn: (m: ThreadMessage) => ThreadMessage) => {
      setMessages((rows) => patchAiRow(rows, ts, fn));
    },
    [setMessages],
  );

  const raiseCard = useCallback(
    (prefix: string, payload: CardPayload) => {
      const cardId = nextCardId(prefix);
      const cardTs = Date.now();
      const replyTs = liveRef.current?.row.ts ?? -1;
      setMessages((rows) => insertAbove(rows, replyTs, cardRow(cardId, payload, cardTs)));
      appendMessage(key, threadId, {
        role: "ai",
        text: "",
        ts: cardTs,
        parts: [toPersistedCardPart(cardId, payload)],
      });
    },
    [key, threadId, setMessages],
  );

  const begin = useCallback(
    (ask: (run: StreamingTurnRun) => void) => {
      const attempt = (n: number) => {
        const controller = new AbortController();
        const ts = stamp();
        const split = createRowSplit();
        split.start(ts);

        // The model was handed the reader's lines. The row above goes into the
        // thread file now, with what it did, and the lines under it, so the
        // file reads user / ai / user / ai in the order it happened; the reply
        // that follows gets a row of its own on the next write.
        const handOver = (lines: PendingSteer[]) => {
          const down = split.steered(live.row.text.trim());
          if (down) {
            const trace = toPersistedTracePart(live.row.tools ?? []);
            appendMessage(key, threadId, {
              role: "ai",
              text: down.text,
              ts: down.ts,
              ...(trace ? { parts: [trace] } : {}),
            });
          }
          for (const line of lines) appendMessage(key, threadId, { role: "user", text: line.text, ts: line.ts });
          setMessages((rows) => deliverRows(rows, lines.map((l) => l.ts)));
        };

        // What the reader said that the model never took: the turn was
        // stopped, failed, or answered before the queue drained. Not thrown
        // away: each line goes into the thread file at the moment it was said
        // and loses its mark. Whether a turn is then opened on them is the
        // ending's call.
        let putBack = false;
        const live: LiveTurn = {
          controller,
          row: answerRow(ts),
          steering: createSteering(handOver),
          split,
          putBack: () => {
            if (putBack) return false;
            putBack = true;
            const left = live.steering.outstanding();
            for (const line of left) appendMessage(key, threadId, { role: "user", text: line.text, ts: line.ts });
            if (left.length) setMessages((rows) => deliverRows(rows, left.map((l) => l.ts)));
            return left.length > 0;
          },
          again: () => attempt(0),
        };
        liveRef.current = live;
        setError(null);
        setStreaming(true);
        setMessages((rows) => openAnswerRow(rows, ts));

        // One change, applied to both copies of the row being written.
        const write = (change: RowChange) => {
          live.row = applyRowChange(live.row, change);
          patchRow(live.row.ts, (m) => applyRowChange(m, change));
        };
        // The phase the row was last told about. Thinking deltas arrive by the
        // hundred and say nothing the line does not already say, so only a
        // change of phase is written through.
        let phase: TurnPhase | null = null;
        // Called by everything that puts something in the row, and by nothing
        // that ends the turn: an ending writes into the row already there.
        // Opens the reply's own row when the model has just been handed a line.
        const writingRow = () => {
          const at = split.writing(stamp);
          if (!at.split) return;
          const was = at.split.was;
          live.row = answerRow(at.ts);
          setMessages((rows) => splitRows(rows, was, live.row));
          phase = null;
        };

        // Only the turn on screen frees the composer: one that ends after
        // stop() has let the next one start has nothing to say about it.
        const finish = () => {
          if (liveRef.current !== live) return;
          liveRef.current = null;
          setStreaming(false);
        };
        // The turn is over, however it ended. Work waiting on it takes the
        // conversation as it stands: the reader's half is on disk either way,
        // and a reply that failed is no reason to lose what they said.
        const settle = () => settledRef.current?.();
        // The abort is a request: the stream can still land a word after stop()
        // has settled the row, and the row is not reopened for it.
        const stopped = () => controller.signal.aborted;
        // A failed turn puts back what the reader said into it and opens
        // nothing on it: Retry and asking again are for that.
        const fail = (text: string) => {
          if (stopped()) return;
          finish();
          write({ kind: "error", text });
          settle();
          live.putBack();
        };
        const decline = (message: string) => {
          if (stopped()) return;
          finish();
          write({ kind: "refusal", text: message });
          settle();
          live.putBack();
        };

        ask({
          ts,
          signal: controller.signal,
          decline,
          fail,
          handlers: (notice?: string) => ({
            onDelta: (chunk) => {
              if (stopped()) return;
              writingRow();
              phase = "writing";
              write({ kind: "delta", chunk });
            },
            // The thinking itself is dropped; only that it is happening is shown.
            onThinking: () => {
              if (stopped()) return;
              writingRow();
              if (phase === "thinking") return;
              phase = "thinking";
              write({ kind: "phase", phase: "thinking" });
            },
            // A quiet call leaves the phase where it was, so the row goes on
            // saying whatever it was saying (turn-rows.ts).
            onToolStart: (info) => {
              if (stopped()) return;
              writingRow();
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
            onSteerable: (port) => {
              if (!stopped()) live.steering.open(port);
            },
            onSteered: (ids) => {
              if (!stopped()) live.steering.injected(ids);
            },
            // Every round's words, not the answering round's alone: a round that
            // called a tool may have written a sentence first, and it has been
            // on screen since (the tool start keeps it), so it is part of the
            // reply.
            onDone: (finalText, _assistant, turnText) => {
              if (stopped()) return; // stop() already kept the partial
              // A turn nobody spoke into is the whole reply. One that was
              // steered has already put the rows above the reader's last line
              // into the file, so what is left is this row's own text; nothing,
              // when the model was handed their line and then stopped.
              const tail = split.answerTail(turnText || finalText, live.row.text);
              finish();
              if (tail !== null) {
                write({ kind: "answer", text: tail, ...(notice ? { notice } : {}) });
                // The settled trace goes to disk with the answer: what the turn
                // did is part of the reply, and the lesson reads which chapters
                // it taught back off it (reading/lesson/thread-state.ts).
                const trace = toPersistedTracePart(live.row.tools ?? []);
                appendMessage(key, threadId, {
                  role: "ai",
                  text: tail,
                  ts: live.row.ts,
                  ...(trace ? { parts: [trace] } : {}),
                });
              } else {
                write({ kind: "handed-over" });
              }
              // After the append, never before: work deferred to the settle reads
              // the thread file, which only now holds the reply.
              settle();
              // The model finished before the queue drained: what the reader
              // said is still owed an answer, and it opens the next turn.
              if (live.putBack()) live.again();
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
                setMessages((rows) => dropAiRow(rows, live.row.ts));
                // Anything said into the dead turn goes into the file first, so
                // the turn asked again reads it and answers it too.
                live.putBack();
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
    [key, threadId, patchRow, setMessages, stamp],
  );

  const running = useCallback(() => liveRef.current !== null, []);

  const steer = useCallback(
    (text: string) => {
      const live = liveRef.current;
      if (!live) return false;
      const at = stamp();
      setMessages((rows) => [...rows, queuedRow(at, text)]);
      live.steering.say(at, text);
      return true;
    },
    [setMessages, stamp],
  );

  // Stop keeps what the turn produced: the half sentence and every call that
  // settled, receipts included (keptOnStop). The abort silences the agent, so
  // persisting it here is the only way it survives. A row with neither goes.
  // Stopping cuts off the answer, not the reader: what they said that the
  // model was never handed opens the next turn (docs/72).
  const stop = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    live.controller.abort();
    liveRef.current = null;
    setStreaming(false);
    const { ts } = live.row;
    const kept = keptOnStop(live.row);
    if (kept) {
      // Handed over with nothing written since: the row is in the file already.
      if (!live.split.down) {
        appendMessage(key, threadId, {
          role: "ai",
          text: kept.text,
          ts,
          ...(kept.trace ? { parts: [{ type: "trace" as const, tools: kept.trace }] } : {}),
        });
      }
      patchRow(ts, (m) => applyRowChange(m, { kind: "stopped", text: kept.text }));
    } else {
      setMessages((rows) => dropAiRow(rows, ts));
    }
    if (live.putBack()) live.again();
  }, [key, threadId, patchRow, setMessages]);

  // The view is going away. What the reader said into the turn still goes into
  // the thread file; nothing is left on screen to answer it in.
  const abort = useCallback(() => {
    const live = liveRef.current;
    live?.controller.abort();
    liveRef.current = null;
    setStreaming(false);
    live?.putBack();
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
    rows,
    steer,
    running,
    stop,
    abort,
  };
}
