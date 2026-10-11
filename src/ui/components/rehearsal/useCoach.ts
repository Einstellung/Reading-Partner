// The talk's conversation as live state: the outline it is about, the messages,
// and the turn currently streaming (docs/44).
//
// It sits in the ui layer for the same reason useRetell does — it is where the
// domain meets the chat rendering: a write to the outline is both a file on disk
// and a card in the conversation, and one of those two is a render concern.
// Everything decidable without React (the prompt, the turn, the pass message) is
// in reading/rehearsal and tested there; the turns run on the device's durable
// runtime through the chat layer's usePlaceChat (docs/soul/87).
//
// The coach never opens the conversation itself. A talk with no pass in it has
// nothing to say about, so the turn runs when the conversation is waiting on a
// reply — a pass just handed in, or a line the reader typed.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadMessage as StoredMessage } from "../../../platform/app/threads";
import { loadSettings, type Settings } from "../../../platform/app/settings";
import { useT } from "../../../i18n";
import { coachConversationKey, prepareCoachTurn } from "../../../reading/rehearsal";
import {
  editTalkOutline,
  loadTalkOutline,
  talkThreadKey,
  type TalkArrangementCardData,
  type TalkOutline,
} from "../../../reading/talk";
import type { PlaceAssembled } from "../../../reading/turn/place-session";
import { rehydrateMessage } from "../chat/chatParts";
import type { ThreadMessage } from "../chat/types";
import { usePlaceChat } from "../chat/use-place-chat";
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
  const t = useT();
  const [outline, setOutline] = useState<TalkOutline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const topicNameRef = useRef(topicName);
  useEffect(() => {
    topicNameRef.current = topicName;
  }, [topicName]);

  const raiseCardRef = useRef<(prefix: string, payload: TalkArrangementCardData) => void>(() => {});

  // One turn, assembled from the outline as it stands and the whole thread, so
  // the second pass is read with the first one and what was said about it.
  const assemble = useCallback(
    async (_signal: AbortSignal): Promise<PlaceAssembled> => {
      const current = outlineRef.current;
      const s = settingsRef.current;
      if (!current || !s?.defaultProviderId || !s.defaultModelId) return { kind: "failed", message: t("study.coach.needProvider", { settings: t("settings.title") }) };
      // The card rows are persisted with no text of their own (the payload is
      // in `parts`), and an empty message is one some providers reject
      // outright. What they say is in the outline the prompt carries anyway.
      const stored = (await openCoachThread(outlineId).catch((): StoredMessage[] => [])).filter((m) => m.text.trim() !== "");
      const line = stored[stored.length - 1];
      if (!line || line.role !== "user") return { kind: "failed", message: "the coach has nothing to answer" };
      return prepareCoachTurn({
        outline: current,
        topicName: topicNameRef.current,
        settings: { ...s, defaultProviderId: s.defaultProviderId, defaultModelId: s.defaultModelId },
        lineTs: line.ts,
        history: stored.map((m) => ({ role: m.role, text: m.text })),
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
        onCard: (payload: TalkArrangementCardData) => raiseCardRef.current("talk", payload),
      });
    },
    [outlineId, t],
  );

  const chat = usePlaceChat({
    storeKey: key,
    threadId,
    conversation: coachConversationKey(outlineId),
    surface: "talk",
    canAsk: () => {
      const s = settingsRef.current;
      if (outlineRef.current && s?.defaultProviderId && s.defaultModelId) return true;
      if (outlineRef.current) setError(t("study.coach.needProvider", { settings: t("settings.title") }));
      return false;
    },
    assemble,
  });
  raiseCardRef.current = chat.raiseCard;
  const { setMessages, running, resume, ask } = chat;

  // Open the talk and its conversation, and read them again when a pass has been
  // handed in: `passKey` is bumped by the shell the moment a pass reaches disk,
  // which is the only time this device adds a message nobody typed. A turn in
  // flight on it — one a killed process left, resumed at start — is followed
  // rather than asked again.
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
        setError(t("study.rehearsal.outlineMissing"));
        setLoading(false);
        return;
      }
      setOutline(read);
      outlineRef.current = read;
      // A turn on screen keeps its rows; the rows it has not got are added.
      if (running()) {
        setMessages((rows) => [...rows, ...toDisplay(stored).filter((m) => !rows.some((r) => r.role === m.role && r.ts === m.ts))]);
      } else setMessages(toDisplay(stored));
      setLoading(false);
      if (await resume().catch((e: unknown) => (console.warn("coach turn could not be resumed", e), false))) return;
      if (cancelled) return;
      // The pass that has just been handed in, or a message left unanswered when
      // the app was last closed. Either way the conversation is waiting.
      const now = await openCoachThread(outlineId).catch((): StoredMessage[] => []);
      const last = now[now.length - 1];
      if (!running() && awaitingReply(now) && last && last.ts > answeredRef.current) {
        answeredRef.current = last.ts;
        ask();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outlineId, passKey, running, resume, ask, setMessages, t]);

  // Leaving does not stop the turn: it lands out of sight and, with the view
  // closed, puts a box card (use-place-chat.ts). Nothing
  // is distilled here: what the coach hears is the reader giving a talk rather
  // than answering for a chapter, and what an observation would be made of has
  // not been decided (docs/44).

  const send = useCallback(
    (text: string) => {
      const ts = chat.send(text);
      if (ts !== null) answeredRef.current = Math.max(answeredRef.current, ts);
    },
    [chat],
  );

  return { outline, messages: chat.messages, loading, streaming: chat.streaming, error, send, stop: chat.stop };
}
