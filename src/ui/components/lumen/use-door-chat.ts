// The conversation typed to Lumen: the day's conversation at the door (docs/61,
// soul/door.ts), as the chat surface holds it. Loaded and replayed when it
// opens, every line written to the day's thread file as it is said, and the
// turn itself handed to soul/door-chat.ts, which needs no React.
//
// What lands in the conversation while it is open without this view writing it
// — a bell answering a delegated run at the door (soul/bell.ts) — is appended
// as it arrives, so the next turn is sent over the conversation as it stands.

import { useCallback, useEffect, useRef, useState } from "react";

import { applyTopicProposal } from "../../../memory";
import { doorDate, doorKey, openDoorThread, sendAtTheDoor } from "../../../soul";
import { t } from "../../../i18n";
import { topicFiledNote } from "../../../info/briefer/call";
import { replayableHistory } from "../../../ai/turn-view/turn-rows";
import { createTopic } from "../../../platform/app/topics";
import {
  appendMessage,
  onThreadMessage,
  patchThreadMessage,
  setThreadTopic,
} from "../../../platform/app/threads";
import {
  findCardPart,
  patchCardPayload,
  rehydrateMessage,
  toPersistedCardPart,
  type CardAction,
} from "../chat/chatParts";
import { useStreamingTurn, type StreamingTurnRun } from "../chat/useStreamingTurn";
import type { ThreadMessage as UiMessage } from "../chat/types";
import { forgetScroll } from "../common/scroll-memory";
import { doorTools } from "./door-tools";

export interface DoorChat {
  messages: UiMessage[];
  /** This conversation's key in the transcript's scroll memory. */
  stickKey: string;
  /** The day's thread is loaded and a line can be sent. */
  ready: boolean;
  streaming: boolean;
  send(text: string): Promise<void>;
  stop(): void;
  onCardAction(cardId: string, action: CardAction): void;
}

export function useDoorChat(): DoorChat {
  // The day the chat was opened on. A conversation left open over midnight
  // stays in the day it began, the way a call does.
  const [date] = useState(doorDate);
  const key = doorKey(date);
  const stickKey = `door:${date}`;
  const [threadId, setThreadId] = useState<string | null>(null);
  const { messages, setMessages, streaming, begin, raiseCard, running, stop, abort } = useStreamingTurn(
    key,
    threadId ?? "",
  );
  const messagesRef = useRef<UiMessage[]>(messages);
  messagesRef.current = messages;

  useEffect(() => {
    let live = true;
    void openDoorThread(date).then((thread) => {
      if (!live) return;
      setThreadId(thread.id);
      setMessages(thread.messages.map(rehydrateMessage));
    });
    return () => {
      live = false;
      abort();
      forgetScroll(stickKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Every append through the store is announced, this view's own included; a
  // row already on screen under that timestamp is this view's and is skipped.
  // The functional update runs after the one that put it there.
  useEffect(() => {
    if (!threadId) return;
    return onThreadMessage((append) => {
      if (append.key !== key || append.threadId !== threadId) return;
      const row = rehydrateMessage(append.message);
      setMessages((prev) =>
        prev.some((m) => m.ts === row.ts && m.role === row.role) ? prev : [...prev, row],
      );
    });
  }, [key, threadId, setMessages]);

  const note = useCallback(
    (text: string, role: "user" | "ai" = "user") => {
      if (!threadId) return;
      const ts = Date.now();
      setMessages((prev) => [...prev, { role, text, ts }]);
      appendMessage(key, threadId, { role, text, ts });
    },
    [key, threadId, setMessages],
  );

  const run = useCallback(
    async (history: UiMessage[], turn: StreamingTurnRun, id: string) => {
      let outcome;
      try {
        outcome = await sendAtTheDoor({
          threadId: id,
          date,
          history: replayableHistory(history),
          signal: turn.signal,
          handlers: turn.handlers(),
          // The door's own tools, beside the soul's (door-tools.ts).
          tools: doorTools({ threadId: id, date, raiseCard }),
          topic: { onCard: (payload) => raiseCard("topic", payload) },
        });
      } catch (e) {
        console.error("door turn failed to start", e);
        turn.fail(t("shell.door.failed"));
        return;
      }
      if (outcome.kind === "no-provider") turn.fail(t("info.errors.noProvider"));
      else if (outcome.kind === "refused") turn.fail(outcome.text);
    },
    [date, raiseCard],
  );

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || !threadId || running()) return;
      const ts = Date.now();
      const line: UiMessage = { role: "user", text, ts };
      const history = [...messagesRef.current, line];
      setMessages((prev) => [...prev, line]);
      appendMessage(key, threadId, { role: "user", text, ts });
      let sent: Promise<void> | undefined;
      begin((turn) => {
        sent = run(history, turn, threadId);
      });
      await sent;
    },
    [key, threadId, running, begin, run, setMessages],
  );

  // Filing the conversation under a topic is what lets it be distilled at all:
  // a day at the door has no material to say what it is about (soul/door.ts).
  const applyTopic = useCallback(
    async (cardId: string) => {
      if (!threadId) return;
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "topic-proposal") return;
      const card = found.payload;
      const { ok } = await applyTopicProposal(card, {
        createTopic,
        fileThread: (id, topicId) => setThreadTopic(key, id, topicId),
        settled: [],
        topicsChanged: () => {},
      });
      if (!ok) return;
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
      patchThreadMessage(key, threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, { ...card, phase: "applied" })],
      });
      note(topicFiledNote(card));
    },
    [key, threadId, note, setMessages],
  );

  // A card's gestures. A door tool's card adds its own `mutate` op here.
  const onCardAction = useCallback(
    (cardId: string, action: CardAction) => {
      switch (action.kind) {
        case "mutate":
          if (action.op === "apply-topic") void applyTopic(cardId);
          break;
        case "local":
          setMessages((prev) => patchCardPayload(prev, cardId, action.patch));
          break;
        case "reply":
          note(action.text, action.role);
          break;
        case "navigate":
        case "resolve":
          break;
      }
    },
    [applyTopic, note, setMessages],
  );

  return { messages, stickKey, ready: threadId !== null, streaming, send, stop, onCardAction };
}
