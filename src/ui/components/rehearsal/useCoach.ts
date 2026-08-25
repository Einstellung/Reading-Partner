// The talk's conversation as live state: the outline it is about, the messages,
// and the turn currently streaming (docs/44).
//
// It sits in the ui layer for the same reason useRetell does — it is where the
// domain meets the chat rendering: a write to the outline is both a file on disk
// and a card in the conversation, and one of those two is a render concern.
// Everything decidable without React (the prompt, the turn, the pass message) is
// in reading/rehearsal and tested there.
//
// The coach never opens the conversation itself. A talk with no pass in it has
// nothing to say about, so the turn runs when the conversation is waiting on a
// reply — a pass just handed in, or a line the reader typed.

import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentTurn, type ProviderId } from "../../../ai";
import { appendRunningTool, resolveToolStatus } from "../../../ai/tool-status";
import { holdsNoAnswer, refusalRow } from "../../../ai/turn-rows";
import { appendMessage, type ThreadMessage as StoredMessage } from "../../../platform/app/threads";
import { loadSettings, toReasoning, type Settings } from "../../../platform/app/settings";
import { toolStatusLabel } from "../../../reading/context";
import { buildCoachTurn } from "../../../reading/rehearsal";
import {
  editTalkOutline,
  loadTalkOutline,
  talkThreadKey,
  type TalkArrangementCardData,
  type TalkOutline,
} from "../../../reading/talk";
import {
  cardRow,
  insertBeforeLast,
  nextCardId,
  rehydrateMessage,
  toPersistedCardPart,
} from "../chat/chatParts";
import type { ThreadMessage } from "../chat/types";
import { awaitingReply, coachThreadId, openCoachThread } from "./coach-thread";

function toDisplay(msgs: readonly StoredMessage[]): ThreadMessage[] {
  return msgs.map(rehydrateMessage);
}

export interface CoachController {
  outline: TalkOutline | null;
  messages: ThreadMessage[];
  loading: boolean;
  streaming: boolean;
  // A failure the reader has to see: no provider configured, a turn that could
  // not be assembled, an outline that has gone.
  error: string | null;
  send(text: string): void;
  stop(): void;
}

export function useCoach(outlineId: string, topicName: string, passKey = 0): CoachController {
  const [outline, setOutline] = useState<TalkOutline | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outlineRef = useRef<TalkOutline | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const partialRef = useRef<{ ts: number; text: string } | null>(null);
  // The last thing already answered, or being answered. Without it the effect
  // that answers a waiting message would fire again on every re-render of the
  // same conversation and run a second turn against it.
  const answeredRef = useRef<number>(0);

  useEffect(() => {
    outlineRef.current = outline;
  }, [outline]);

  const key = talkThreadKey(outlineId);
  const threadId = coachThreadId(outlineId);

  const topicNameRef = useRef(topicName);
  useEffect(() => {
    topicNameRef.current = topicName;
  }, [topicName]);

  const patchRow = useCallback((ts: number, fn: (m: ThreadMessage) => ThreadMessage) => {
    setMessages((rows) => rows.map((m) => (m.ts === ts && m.role === "ai" ? fn(m) : m)));
  }, []);

  // One turn. Assembled from the outline as it stands and the whole thread, so
  // the second pass is read with the first one and what was said about it.
  const runTurn = useCallback(() => {
    const current = outlineRef.current;
    const s = settingsRef.current;
    if (!current) return;
    if (!s?.defaultProviderId || !s?.defaultModelId) {
      setError("Configure a provider in Settings and I can tell you how that pass went.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const ts = Date.now();
    partialRef.current = { ts, text: "" };
    setError(null);
    setStreaming(true);
    setMessages((rows) => [
      ...rows.filter((m) => !holdsNoAnswer(m)),
      { role: "ai", text: "", ts, streaming: true },
    ]);

    const finish = () => {
      if (abortRef.current === controller) abortRef.current = null;
      partialRef.current = null;
      setStreaming(false);
    };
    const fail = (text: string) => {
      finish();
      patchRow(ts, () => ({ role: "ai", text, ts, failed: true }));
    };
    const decline = (message: string) => {
      finish();
      patchRow(ts, (m) => ({ ...m, ...refusalRow(m, message) }));
    };

    // A receipt for a write to the outline, shown above the reply being written
    // and persisted with it, so a reopened conversation still shows what landed.
    const raiseCard = (payload: TalkArrangementCardData) => {
      const cardId = nextCardId("talk");
      const cardTs = Date.now();
      setMessages((rows) => insertBeforeLast(rows, cardRow(cardId, payload, cardTs)));
      appendMessage(key, threadId, {
        role: "ai",
        text: "",
        ts: cardTs,
        parts: [toPersistedCardPart(cardId, payload)],
      });
    };

    void (async () => {
      const stored = await openCoachThread(outlineId).catch((): StoredMessage[] => []);
      if (controller.signal.aborted) return;
      const turn = buildCoachTurn({
        outline: current,
        topicName: topicNameRef.current,
        settings: s,
        // The card rows are persisted with no text of their own (the payload is
        // in `parts`), and an empty message is one some providers reject
        // outright. What they say is in the outline the prompt carries anyway.
        history: stored
          .filter((m) => m.text.trim() !== "")
          .map((m) => ({ role: m.role, text: m.text })),
        talk: {
          read: () => loadTalkOutline(outlineId),
          edit: async (change) => {
            const next = await editTalkOutline(outlineId, change);
            if (next) {
              outlineRef.current = next;
              setOutline(next);
            }
            return next;
          },
        },
        onCard: raiseCard,
      });
      // Declined before sending: the same inputs assemble the same call, so
      // there is nothing a second press would change (docs/pitfall/65).
      if (turn.refusal) {
        decline(turn.refusal);
        return;
      }
      void runAgentTurn({
        providerId: s.defaultProviderId as ProviderId,
        modelId: s.defaultModelId as string,
        systemPrompt: turn.systemPrompt,
        messages: turn.messages,
        tools: turn.tools,
        signal: controller.signal,
        reasoning: toReasoning(s.chatThinking),
        telemetry: { surface: "talk", thread: threadId },
        onDelta: (chunk) => {
          const p = partialRef.current;
          if (p) p.text += chunk;
          patchRow(ts, (m) => ({ ...m, text: m.text + chunk }));
        },
        onToolStart: (info) =>
          patchRow(ts, (m) => ({
            ...m,
            text: "",
            tools: appendRunningTool(m.tools, info.name, toolStatusLabel(info.name, info.args)),
          })),
        onToolEnd: (info) =>
          patchRow(ts, (m) => {
            const tools = resolveToolStatus(m.tools, info.name, info.isError);
            return tools ? { ...m, tools } : m;
          }),
        onDone: (full) => {
          if (controller.signal.aborted) return; // stop() already kept the partial
          finish();
          patchRow(ts, (m) => ({
            role: "ai",
            text: full,
            ts,
            tools: (m.tools ?? []).filter((t) => t.state === "error"),
            ...(turn.notice ? { notice: turn.notice } : {}),
          }));
          appendMessage(key, threadId, { role: "ai", text: full, ts });
        },
        onError: (message) => fail(`⚠️ Couldn't reach the model. ${message}`),
        onRefusal: (message) => decline(message),
      });
    })();
  }, [outlineId, key, threadId, patchRow]);

  // Open the talk and its conversation, and read them again when a pass has been
  // handed in: `passKey` is bumped by the shell the moment a pass reaches disk,
  // which is the only time this device adds a message nobody typed.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const [read, stored] = await Promise.all([
        loadTalkOutline(outlineId).catch(() => null),
        openCoachThread(outlineId).catch((): StoredMessage[] => []),
      ]);
      if (cancelled) return;
      settingsRef.current = await loadSettings().catch(() => null);
      if (cancelled) return;
      if (!read) {
        setError("The outline for this talk is not on this device.");
        setLoading(false);
        return;
      }
      setOutline(read);
      outlineRef.current = read;
      setMessages(toDisplay(stored));
      setLoading(false);
      // The pass that has just been handed in, or a message left unanswered when
      // the app was last closed. Either way the conversation is waiting.
      const last = stored[stored.length - 1];
      if (!abortRef.current && awaitingReply(stored) && last && last.ts > answeredRef.current) {
        answeredRef.current = last.ts;
        runTurn();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outlineId, passKey, runTurn]);

  // Leaving stops the turn. Nothing is distilled here: what the coach hears is
  // the reader giving a talk rather than answering for a chapter, and what an
  // observation would be made of has not been decided (docs/44).
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [outlineId],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const ts = Date.now();
      answeredRef.current = ts;
      appendMessage(key, threadId, { role: "user", text: trimmed, ts });
      setMessages((rows) => [...rows, { role: "user", text: trimmed, ts }]);
      runTurn();
    },
    [key, threadId, runTurn],
  );

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
      setMessages((rows) => rows.filter((m) => !(m.ts === partial.ts && m.role === "ai")));
    }
    partialRef.current = null;
  }, [key, threadId, patchRow]);

  return { outline, messages, loading, streaming, error, send, stop };
}
