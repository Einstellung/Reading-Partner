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
import { createTopic, listTopics } from "../../../platform/app/topics";
import { extractLinks, linkTurnNote, linksToTake } from "../../../reading/ingest/take-link-tool";
import { chooseIntakeTopic, readIntake } from "../../../reading/ingest/topic-intake";
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
import {
  INTAKE_CHOOSE_OP,
  INTAKE_NEW_TOPIC_OP,
  INTAKE_OPEN_TARGET,
  documentToOpen,
  type IntakeOpenDocument,
} from "./intake-view";

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

export interface DoorChatOptions {
  /**
   * The day whose conversation to open: a card in Lumen's box goes back to the
   * conversation it came from, which may be an earlier day's. Today otherwise.
   */
  date?: string;
  /** Open a document an intake card filed (its 「打开阅读」), in this shell's reader. */
  onOpenDocument?: (doc: IntakeOpenDocument) => void;
}

export function useDoorChat(options: DoorChatOptions = {}): DoorChat {
  // The day the chat was opened on. A conversation left open over midnight
  // stays in the day it began, the way a call does.
  const [date] = useState(() => options.date ?? doorDate());
  const openDocumentRef = useRef(options.onOpenDocument);
  openDocumentRef.current = options.onOpenDocument;
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
        // A message carrying links goes to the model with an app note that
        // numbers them and the topics, which is what take_link is called with.
        const latest = history[history.length - 1];
        const latestLinks = latest?.role === "user" ? extractLinks(latest.text) : [];
        const note = latestLinks.length > 0 ? linkTurnNote(latestLinks, await listTopics().catch(() => [])) : "";
        const sent = note ? [...history.slice(0, -1), { ...latest, text: latest.text + note }] : history;
        outcome = await sendAtTheDoor({
          threadId: id,
          date,
          history: replayableHistory(sent),
          signal: turn.signal,
          handlers: turn.handlers(),
          // The door's own tools, beside the soul's (door-tools.ts).
          tools: doorTools({ threadId: id, date, raiseCard, links: linksToTake(history) }),
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

  // The intake card's pick: a topic on the shelf, or one made on the card first.
  // The card redraws off the intake record, so nothing is patched here.
  const intakeOf = useCallback((cardId: string): string | null => {
    const found = findCardPart(messagesRef.current, cardId);
    return found && found.payload.kind === "link-intake" ? found.payload.intakeId : null;
  }, []);
  const pickIntakeTopic = useCallback(
    async (cardId: string, topic: { id?: string; name?: string }) => {
      const intakeId = intakeOf(cardId);
      if (!intakeId) return;
      try {
        const topicId = topic.id ?? (topic.name ? (await createTopic(topic.name)).id : null);
        if (topicId) await chooseIntakeTopic(intakeId, topicId);
      } catch (e) {
        console.warn("the intake's topic could not be picked", e);
      }
    },
    [intakeOf],
  );
  const openIntakeDocument = useCallback(
    async (cardId: string, hash: string) => {
      const intakeId = intakeOf(cardId);
      const doc = intakeId ? documentToOpen(await readIntake(intakeId), hash) : null;
      if (doc) openDocumentRef.current?.(doc);
    },
    [intakeOf],
  );

  // A card's gestures. A door tool's card adds its own `mutate` op here.
  const onCardAction = useCallback(
    (cardId: string, action: CardAction) => {
      switch (action.kind) {
        case "mutate":
          if (action.op === "apply-topic") void applyTopic(cardId);
          else if (action.op === INTAKE_CHOOSE_OP && action.arg) void pickIntakeTopic(cardId, { id: action.arg });
          else if (action.op === INTAKE_NEW_TOPIC_OP && action.arg) void pickIntakeTopic(cardId, { name: action.arg });
          break;
        case "local":
          setMessages((prev) => patchCardPayload(prev, cardId, action.patch));
          break;
        case "reply":
          note(action.text, action.role);
          break;
        case "navigate":
          if (action.to === INTAKE_OPEN_TARGET && action.arg) void openIntakeDocument(cardId, action.arg);
          break;
        case "resolve":
          break;
      }
    },
    [applyTopic, pickIntakeTopic, openIntakeDocument, note, setMessages],
  );

  return { messages, stickKey, ready: threadId !== null, streaming, send, stop, onCardAction };
}
