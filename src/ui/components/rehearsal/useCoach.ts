// The talk's conversation as live state: the outline it is about, the messages,
// and the turn currently streaming (docs/44).
//
// It sits in the ui layer for the same reason useRetell does — it is where the
// domain meets the chat rendering: a write to the outline is both a file on disk
// and a card in the conversation, and one of those two is a render concern.
// Everything decidable without React (the prompt, the turn, the pass message) is
// in reading/rehearsal and tested there; the streaming itself is the chat
// layer's useStreamingTurn.
//
// The coach never opens the conversation itself. A talk with no pass in it has
// nothing to say about, so the turn runs when the conversation is waiting on a
// reply — a pass just handed in, or a line the reader typed.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderId } from "../../../ai";
import { runAgentTurn } from "../../../legion/execute/turn";
import { soulHarness } from "../../../soul";
import { appendMessage, type ThreadMessage as StoredMessage } from "../../../platform/app/threads";
import { loadSettings, toReasoning, type Settings } from "../../../platform/app/settings";
import { buildCoachTurn } from "../../../reading/rehearsal";
import {
  editTalkOutline,
  loadTalkOutline,
  talkThreadKey,
  type TalkArrangementCardData,
  type TalkOutline,
} from "../../../reading/talk";
import { rehydrateMessage } from "../chat/chatParts";
import type { ThreadMessage } from "../chat/types";
import { useStreamingTurn } from "../chat/useStreamingTurn";
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
  const [loading, setLoading] = useState(true);

  const outlineRef = useRef<TalkOutline | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  // The last thing already answered, or being answered. Without it the effect
  // that answers a waiting message would fire again on every re-render of the
  // same conversation and run a second turn against it.
  const answeredRef = useRef<number>(0);

  useEffect(() => {
    outlineRef.current = outline;
  }, [outline]);

  const key = talkThreadKey(outlineId);
  const threadId = coachThreadId(outlineId);
  const {
    messages,
    setMessages,
    streaming,
    error,
    setError,
    begin,
    raiseCard,
    running,
    stop,
    abort,
  } = useStreamingTurn(key, threadId);

  const topicNameRef = useRef(topicName);
  useEffect(() => {
    topicNameRef.current = topicName;
  }, [topicName]);

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
    begin((run) => {
      void (async () => {
        const stored = await openCoachThread(outlineId).catch((): StoredMessage[] => []);
        if (run.signal.aborted) return;
        const assembled = await buildCoachTurn({
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
          onCard: (payload: TalkArrangementCardData) => raiseCard("talk", payload),
        });
        // Declined before sending: the same inputs assemble the same call, so
        // there is nothing a second press would change (docs/pitfall/65).
        if (assembled.refusal) {
          run.decline(assembled.refusal);
          return;
        }
        void runAgentTurn({
          providerId: s.defaultProviderId as ProviderId,
          modelId: s.defaultModelId as string,
          systemPrompt: assembled.systemPrompt,
          messages: assembled.messages,
          tools: assembled.tools,
          signal: run.signal,
          reasoning: toReasoning(s.chatThinking),
          telemetry: { surface: "talk", thread: threadId },
          harness: soulHarness(),
          ...(assembled.origin ? { deliverTo: assembled.origin } : {}),
          ...run.handlers(assembled.notice),
        });
      })();
    });
  }, [outlineId, threadId, begin, raiseCard, setError]);

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
      if (!running() && awaitingReply(stored) && last && last.ts > answeredRef.current) {
        answeredRef.current = last.ts;
        runTurn();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outlineId, passKey, runTurn, running, setError, setMessages]);

  // Leaving stops the turn. Nothing is distilled here: what the coach hears is
  // the reader giving a talk rather than answering for a chapter, and what an
  // observation would be made of has not been decided (docs/44).
  useEffect(() => () => abort(), [outlineId, abort]);

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
    [key, threadId, runTurn, setMessages],
  );

  return { outline, messages, loading, streaming, error, send, stop };
}
