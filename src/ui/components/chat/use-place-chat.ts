// A one-thread conversation's rows and turns on the device's durable runtime
// (docs/soul/87, 第二阶段), for the coach (docs/44) and the retell (docs/31):
// the rows on screen, the thread file they are written to, and the place
// session (reading/turn/place-session.ts) that runs the turns. What each
// surface loads, when it asks, and what leaving means stay with it.
//
// A line said while a turn runs goes into it (docs/72). Stop keeps the half
// sentence and the receipts. A card raised during a turn goes above the
// turn's rows and into the file. Leaving stops the turn — its half sentence
// lands — unless the surface keeps it running out of sight; it is then only
// landed, and the surface hears when.

import { useCallback, useEffect, useRef, useState } from "react";
import { appendMessage } from "../../../platform/app/threads";
import type { AiSurface } from "../../../platform/app/cache-telemetry";
import { readingDurable } from "../../../reading/turn/durable-runtime";
import type { CallRow } from "../../../reading/turn/call-state";
import { createPlaceSession, withPlaceTurnRows, type PlaceAssembled, type PlaceSession } from "../../../reading/turn/place-session";
import { cardRow, nextCardId, toPersistedCardPart, type CardPayload } from "./chatParts";
import type { ThreadMessage as UiMessage } from "./types";

export interface PlaceChatConfig {
  /** The thread store's key for the conversation's file, and the thread in it. */
  storeKey: string;
  threadId: string;
  /** The conversation's key in `rp.conversations`. */
  conversation: string;
  surface: AiSurface;
  /** Whether a turn can be asked for now; says why not itself (no model set up). */
  canAsk(): boolean;
  /** Assemble a turn on the conversation as it stands: the rows on screen, none streaming or queued. */
  assemble(signal: AbortSignal, rows: readonly UiMessage[]): Promise<PlaceAssembled>;
  /** Called on every leave, saying whether a turn is running: true keeps it running out of sight. */
  keepOnLeave?(running: boolean): boolean;
  /** A turn kept running out of sight has landed. */
  settledAway?(): void;
}

export interface PlaceChat {
  messages: UiMessage[];
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>;
  /** The rows as they are this instant. */
  rows(): UiMessage[];
  streaming: boolean;
  raiseCard(prefix: string, payload: CardPayload): void;
  /** A turn on the conversation as it stands, when one can be asked for. */
  ask(): void;
  /** The reader's line: into the running turn, or written and answered by a turn of its own. */
  send(text: string): number | null;
  stop(): void;
  running(): boolean;
  /** Follow the turn in flight on the conversation, if there is one. */
  resume(): Promise<boolean>;
}

const isCardRow = (m: UiMessage) => m.parts?.some((part) => part.type === "card") ?? false;

export function usePlaceChat(config: PlaceChatConfig): PlaceChat {
  const configRef = useRef(config);
  configRef.current = config;
  const { storeKey, threadId, conversation, surface } = config;
  const [messages, setRendered] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const sessionRef = useRef<PlaceSession | null>(null);

  // Every change lands on the mirror at once, so a turn started in the same
  // tick reads the conversation it is answering.
  const messagesRef = useRef<UiMessage[]>([]);
  const setMessages = useCallback<React.Dispatch<React.SetStateAction<UiMessage[]>>>((action) => {
    messagesRef.current = typeof action === "function" ? action(messagesRef.current) : action;
    setRendered(messagesRef.current);
  }, []);

  // Kept strictly increasing so two rows made in one millisecond stay two rows.
  const lastTsRef = useRef(0);
  const stamp = useCallback(() => {
    const at = Math.max(Date.now(), lastTsRef.current + 1);
    lastTsRef.current = at;
    return at;
  }, []);

  useEffect(() => {
    // Leaving is this conversation's, not whichever one the surface has moved on to.
    const leaving = configRef.current;
    let gone = false;
    let away = false;
    const session = createPlaceSession({
      durable: readingDurable,
      key: conversation,
      surface,
      assemble: (signal) => configRef.current.assemble(signal, messagesRef.current.filter((m) => !m.streaming && !m.queued)),
      lastLine: () => {
        let ts = 0;
        for (const m of messagesRef.current) if (m.role === "user" && !m.queued) ts = m.ts;
        return ts;
      },
      draw: (after, rows) => {
        if (gone) return;
        setMessages((prev) => withPlaceTurnRows<CallRow & UiMessage>(prev, after, rows as (CallRow & UiMessage)[], isCardRow));
      },
      file: (lines) => {
        for (const line of lines) appendMessage(storeKey, threadId, { role: "user", text: line.text, ts: line.ts });
      },
      streaming: (on) => {
        if (!gone) {
          setStreaming(on);
          return;
        }
        // Out of sight, the turn has landed — unless its ending opened another (a stall asked again).
        if (!on && away)
          queueMicrotask(() => {
            if (!away || session.running()) return;
            away = false;
            leaving.settledAway?.();
          });
      },
    });
    sessionRef.current = session;
    return () => {
      gone = true;
      sessionRef.current = null;
      if (leaving.keepOnLeave?.(session.running()) && session.running()) {
        away = true;
        return;
      }
      session.leave();
    };
  }, [storeKey, threadId, conversation, surface, setMessages]);

  const raiseCard = useCallback(
    (prefix: string, payload: CardPayload) => {
      const cardId = nextCardId(prefix);
      const cardTs = stamp();
      setMessages((prev) => {
        const card = cardRow(cardId, payload, cardTs);
        const at = prev.findIndex((m) => m.ts > cardTs || m.streaming === true);
        return at === -1 ? [...prev, card] : [...prev.slice(0, at), card, ...prev.slice(at)];
      });
      appendMessage(storeKey, threadId, { role: "ai", text: "", ts: cardTs, parts: [toPersistedCardPart(cardId, payload)] });
    },
    [storeKey, threadId, setMessages, stamp],
  );

  const ask = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.running() || !configRef.current.canAsk()) return;
    session.ask();
  }, []);

  const send = useCallback(
    (text: string): number | null => {
      const trimmed = text.trim();
      const session = sessionRef.current;
      if (!trimmed || !session) return null;
      const ts = stamp();
      // Into the turn that is running (docs/72); otherwise a turn of its own.
      if (session.say(trimmed, ts)) return ts;
      setMessages((prev) => [...prev, { role: "user", text: trimmed, ts }]);
      appendMessage(storeKey, threadId, { role: "user", text: trimmed, ts });
      ask();
      return ts;
    },
    [storeKey, threadId, setMessages, stamp, ask],
  );

  const stop = useCallback(() => sessionRef.current?.stop(), []);
  const running = useCallback(() => sessionRef.current?.running() ?? false, []);
  const resume = useCallback(async () => (await sessionRef.current?.resume()) ?? false, []);
  const rows = useCallback(() => messagesRef.current, []);

  return { messages, setMessages, rows, streaming, raiseCard, ask, send, stop, running, resume };
}
