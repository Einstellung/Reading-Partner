// The meals call's live state (docs/73, docs/671 对话): the standing thread, the
// turn currently streaming, and what each card gesture fans out to.
//
// It sits in the ui layer because it is where the domain meets the chat
// rendering (chatParts): a card is both a payload the tools produced and a row
// in the conversation. What a draft's Apply writes is meals/apply.ts's; what is
// left here is wiring and the effects it drives.
//
// The turns run on the device's durable runtime (docs/soul/87): assembled by
// meals/conversation/durable.ts prepareMealsTurn, driven by
// reading/turn/place-session.ts, landed into the conversation's file by the
// meals place. The reader can talk into a running turn (docs/72); Stop keeps the
// half sentence and the receipts; a turn in flight when the conversation opens
// — one a killed process left, resumed at start — is drawn, stoppable and
// steerable like one started here. Closing the call does not stop its turn: it
// runs on and lands, with a box card if nobody has the conversation open by
// then, and the call opened again follows it.

import { HOUSEKEEPER_CONFIRM_KIND } from "../../../housekeeper/write";
import { listenToThread, withArrivedRow } from "../companion/door-arrivals";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyTopicProposal, distillInfoThread, type TopicProposalCardData } from "../../../memory";
import type { DeskItem } from "../../../desk";
import { MEALS_CONVERSATION_KEY, prepareMealsTurn, watchMealsConversation } from "../../../meals/conversation/durable";
import type { MealsCallAnchor } from "../../../meals/conversation/anchor";
import { createTopic } from "../../../platform/app/topics";
import {
  appendMessage,
  createThread,
  getThread,
  loadThreads,
  patchThreadMessage,
  setThreadTopic,
} from "../../../platform/app/threads";
import { applyDraftFile, checkNote, type Applied } from "../../../meals/apply";
import { currentDraft as waitingDraft, draftCardFromFile, type MealsDraftFile } from "../../../meals/draft-file";
import { loadMealsDraft, watchMealsDraft } from "../../../meals/draft-store";
import { hostRegion } from "../../../meals/region";
import { planNote } from "../../../meals/screen/plan-note";
import { draftCardId, type MealsCard, type MealsDraftCardData } from "../../../meals/cards";
import { buildLiveMealsTools, liveMealsPorts } from "../../../meals/live";
import { loadMeals } from "../../../meals/plan/store";
import { startPrepFromChat } from "../../../meals/prep-session";
import { putMealsPrepCard } from "../../../meals/conversation/call";
import { todayLocal } from "../../../meals/today";
import { requestPrepVoice } from "./use-prep-voice";
import { leaveForAppliedPlan, mealsStickKey, topicFiledNote } from "./host";
import { readingDurable } from "../../../reading/turn/durable-runtime";
import type { CallRow } from "../../../reading/turn/call-state";
import { createPlaceSession, registerOpenSession, withPlaceTurnRows, type PlaceAssembled, type PlaceSession } from "../../../reading/turn/place-session";
import { forgetScroll } from "../common/scroll-memory";
import { navigateAway, swappedFor, type CallSwap } from "../chat/call/call-layout";
import { replayableHistory } from "../../../ai/turn-view/turn-rows";
import {
  cardRow,
  findCardPart,
  nextCardId,
  patchCardPayload,
  rehydrateMessage,
  toPersistedCardPart,
  upsertCardRow,
  type CardAction,
  type CardPayload,
} from "../chat/chatParts";
import type { ThreadMessage as UiMessage } from "../chat/types";

export interface MealsCallOptions {
  anchor: MealsCallAnchor;
  // Whether the call has corner cards, and with them a layout to swap into.
  pipCards: boolean;
  onHangUp: () => void;
  // Filing the conversation under a new topic puts a topic on the shelf that
  // was not there, so the host reloads it.
  onTopicsChanged?: () => void;
  // The meals screen reloads. Applying a plan and recording a deviation both
  // write without the screen asking, so nothing else would tell it.
  onMealsChanged?: () => void;
  // Open a meals screen from a card's link (the draft card's 查看计划 and 采购单).
  onOpenMeals?: (screen: "meals" | "meals-shopping") => void;
  // A meal plan was just applied (the draft card's button or apply_meal_plan):
  // the host opens its batch cook, or the Meals page when it cooks nothing ahead.
  onMealsApplied?: (session: string | null) => void;
}

export interface MealsCallController {
  messages: UiMessage[];
  // Identifies this conversation to the transcript's scroll memory.
  stickKey: string;
  streaming: boolean;
  // Whether the reader has tapped the call out of the way.
  swapped: boolean;
  setSwapped: (swapped: boolean) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  onCardAction: (cardId: string, action: CardAction) => void;
}

const isCardRow = (m: UiMessage) => m.parts?.some((part) => part.type === "card") ?? false;

export function useMealsCall(opts: MealsCallOptions): MealsCallController {
  const { anchor, pipCards, onHangUp, onTopicsChanged, onMealsChanged, onOpenMeals, onMealsApplied } = opts;
  // Keyed by the anchor: pressing Ask again hands over a new anchor, which
  // brings the chat back even when the thread is the same one (call-layout.ts).
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const [swap, setSwap] = useState<CallSwap<MealsCallAnchor>>({ key: anchor, swapped: false });
  const swapped = swappedFor(swap, anchor);
  const setSwapped = useCallback((next: boolean) => setSwap({ key: anchorRef.current, swapped: next }), []);
  const bookId = anchor.bookKey;
  const stickKey = mealsStickKey(anchor.threadId);
  const [messages, setRendered] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const sessionRef = useRef<PlaceSession | null>(null);
  // The conversation was just opened and the runtime has not yet said whether
  // a turn is in flight on it; a line said meanwhile waits for the answer.
  const lookingRef = useRef<Promise<unknown> | null>(null);

  // Every change lands on the mirror at once, so a turn started in the same
  // tick reads the conversation it is answering, and the (id-keyed) card
  // dispatcher can look up a card's payload without being rebuilt on every delta.
  const messagesRef = useRef<UiMessage[]>([]);
  const setMessages = useCallback<React.Dispatch<React.SetStateAction<UiMessage[]>>>((action) => {
    messagesRef.current = typeof action === "function" ? action(messagesRef.current) : action;
    setRendered(messagesRef.current);
  }, []);

  // Rows this view makes are keyed by when they were made; kept strictly
  // increasing so two in one millisecond stay two rows.
  const lastTsRef = useRef(0);
  const stamp = useCallback(() => {
    const at = Math.max(Date.now(), lastTsRef.current + 1);
    lastTsRef.current = at;
    return at;
  }, []);

  // The notes this view put in while a turn may be drawing: a turn's draw
  // replaces the rows after the reader's line with its own, and keeps these
  // and the cards above them.
  const notesRef = useRef(new Set<string>());
  const keepRow = useCallback(
    (m: UiMessage) => isCardRow(m) || notesRef.current.has(`${m.role}:${m.ts}`),
    [],
  );

  // The call ends by its component unmounting.
  useEffect(() => () => forgetScroll(stickKey), [stickKey]);

  // Closing the conversation is this side's hangup: what the reader said goes to
  // a distillation pass (memory/distill). Fired and forgotten — a pass has to
  // outlive the component that started it, it never surfaces UI, and a
  // conversation this misses is picked up by the half-hourly sweep, which reads
  // the same source.
  const threadId = anchor.threadId;
  useEffect(
    () => () => {
      void distillInfoThread({ threadId, trigger: "info-close" });
    },
    [threadId],
  );

  // The desk the last turn was assembled over, for the card gestures that reach
  // back into it: applying a topic tells every item it settled (src/desk:
  // onTopicSettled), and the items are the running turn's, not the card's.
  const deskRef = useRef<DeskItem[]>([]);

  // A synthetic turn injected into the thread outside an AI reply: a card
  // gesture reporting itself. Shown at once and written to disk.
  const noteTurn = useCallback(
    (text: string, opts?: { role?: "user" | "ai" }) => {
      const role = opts?.role ?? "user";
      const ts = stamp();
      notesRef.current.add(`${role}:${ts}`);
      setMessages((prev) => [...prev, { role, text, ts }]);
      appendMessage(bookId, anchor.threadId, { role, text, ts });
    },
    [bookId, anchor.threadId, setMessages, stamp],
  );

  // A note for the model drawn as a card: the row's text goes to the model on
  // the next turn and the card is what the reader sees, the way an aside's
  // receipt is written (reading/aside.ts). Always persisted.
  const noteCardTurn = useCallback(
    (text: string, cardId: string, card: CardPayload) => {
      const ts = stamp();
      setMessages((prev) => [...prev, { role: "ai", text, ts, parts: [{ type: "card", id: cardId, card }] }]);
      appendMessage(bookId, anchor.threadId, { role: "ai", text, ts, parts: [toPersistedCardPart(cardId, card)] });
    },
    [bookId, anchor.threadId, setMessages, stamp],
  );

  // A receipt for something the AI just wrote, shown above the turn's rows and
  // persisted, so a reopened conversation still shows what landed.
  const raiseCard = useCallback(
    (prefix: string, payload: CardPayload, id?: string) => {
      const cardId = id ?? nextCardId(prefix);
      const cardTs = stamp();
      setMessages((prev) => {
        const card = cardRow(cardId, payload, cardTs);
        const at = prev.findIndex((m) => m.ts > cardTs || m.streaming === true);
        return at === -1 ? [...prev, card] : [...prev.slice(0, at), card, ...prev.slice(at)];
      });
      appendMessage(bookId, anchor.threadId, { role: "ai", text: "", ts: cardTs, parts: [toPersistedCardPart(cardId, payload)] });
    },
    [bookId, anchor.threadId, setMessages, stamp],
  );

  // A meals card from the planning tool. A draft revising the one still on
  // screen replaces it in place under the draft's card id: no row is added, so
  // the conversation does not move (docs/671 对话).
  const showMealsCard = useCallback(
    (payload: MealsCard) => {
      if (payload.kind !== "meals-draft") return raiseCard("meals", payload);
      const cardId = draftCardId(payload.draftId);
      const found = findCardPart(messagesRef.current, cardId);
      if (!found) return raiseCard("meals", payload, cardId);
      setMessages((prev) => upsertCardRow(prev, cardId, payload));
      patchThreadMessage(bookId, anchor.threadId, found.ts, { parts: [toPersistedCardPart(cardId, payload)] });
    },
    [bookId, anchor.threadId, raiseCard, setMessages],
  );

  // The draft card patched to the draft file as it is now: a new version
  // written by another run on this device or pulled from another device, or
  // the draft applied there (docs/platform/687).
  const syncMealsDraftCard = useCallback(async () => {
    const file = await loadMealsDraft().catch(() => null);
    if (!file) return;
    const found = findCardPart(messagesRef.current, draftCardId(file.draftId));
    if (!found || found.payload.kind !== "meals-draft") return;
    const next = draftCardFromFile(file, found.payload, await loadMeals(), hostRegion());
    if (next) showMealsCard(next);
  }, [showMealsCard]);

  useEffect(() => watchMealsDraft(() => void syncMealsDraftCard()), [syncMealsDraftCard]);

  // A confirmation card a delegated run left lands after its reply, written by
  // the bell (soul/run-confirm-cards.ts) whoever is looking (docs/platform/687).
  // This view's own cards come through here too and are already on screen.
  useEffect(
    () =>
      listenToThread(bookId, anchor.threadId, (message) => {
        if (!message.parts?.some((p) => p.type === "card" && p.card.kind === HOUSEKEEPER_CONFIRM_KIND)) return;
        const row = rehydrateMessage(message);
        setMessages((prev) => withArrivedRow(prev, row));
      }),
    [bookId, anchor.threadId, setMessages],
  );

  // Load (or start) the thread whenever the anchor changes, and join a turn in
  // flight on it.
  useEffect(() => {
    let live = true;
    let unwatch: (() => void) | undefined;
    const key = MEALS_CONVERSATION_KEY;
    (async () => {
      try {
        await loadThreads(bookId);
      } catch {
        // A missing/corrupt thread file starts an empty conversation.
      }
      if (!live) return;
      let thread = getThread(bookId, anchor.threadId);
      // The thread's kind is what the file has always said; it is on disk.
      if (!thread) thread = createThread(bookId, "info", anchor.threadId);
      setMessages(thread.messages.map(rehydrateMessage));
      void syncMealsDraftCard();
      const session = createPlaceSession({
        durable: readingDurable,
        key,
        // The surface the log has always named this conversation's spend under.
        surface: "info",
        assemble,
        lastLine: () => {
          let ts = 0;
          for (const m of messagesRef.current) if (m.role === "user" && !m.queued) ts = m.ts;
          return ts;
        },
        draw: (after, rows) =>
          setMessages((prev) => withPlaceTurnRows<CallRow & UiMessage>(prev, after, rows as (CallRow & UiMessage)[], keepRow)),
        file: (lines) => {
          for (const line of lines) appendMessage(bookId, anchor.threadId, { role: "user", text: line.text, ts: line.ts });
        },
        streaming: setStreaming,
      });
      sessionRef.current = session;
      // A bell rung for this conversation while it is open runs in this session (place-bell.ts).
      const closed = registerOpenSession(key, session);
      const unwatchMeals = watchMealsConversation();
      unwatch = () => {
        closed();
        unwatchMeals();
      };
      const looking = session.resume().catch((e: unknown) => {
        console.warn("meals turn could not be resumed", e);
        return false;
      });
      lookingRef.current = looking;
      if ((await looking) || !live) return;
      // A screen's button opened this conversation with something to say ("Plan
      // this week."). Sent as the reader's own turn, shown and persisted, and
      // only into an empty thread — a standing conversation reopened next week
      // would otherwise re-say it every time.
      if (anchor.kickoff && thread.messages.length === 0) void send(anchor.kickoff);
    })();
    return () => {
      live = false;
      sessionRef.current?.detach();
      sessionRef.current = null;
      unwatch?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, anchor.threadId]);

  // File what the AI proposed when the user clicks a topic card's Apply: mint
  // the topic where it is new, file this conversation under it, let what is on
  // the desk follow the topic, and tell the AI. The order and what a failure
  // stops are in memory/filing/settle.ts.
  const handleApplyTopic = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "topic-proposal") return;
      const card = found.payload;
      const { ok } = await applyTopicProposal(card, {
        createTopic,
        fileThread: (threadId, topicId) => setThreadTopic(bookId, threadId, topicId),
        settled: deskRef.current.flatMap((i) => (i.onTopicSettled ? [i.onTopicSettled.bind(i)] : [])),
        topicsChanged: () => onTopicsChanged?.(),
      });
      if (!ok) return;
      const applied: TopicProposalCardData = { ...card, phase: "applied" };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      noteTurn(topicFiledNote(card));
    },
    [bookId, anchor.threadId, noteTurn, onTopicsChanged],
  );

  // The draft's 「就这样」, or apply_meal_plan: the plan and the shopping list
  // derived from it in one write, the screen reloaded through the ports'
  // `changed`, and the card collapsed to its applied form. The model is told in
  // a row that draws nothing (meals/cards.ts) unless the tool asked, whose
  // own result tells it.
  const handleApplyMealsDraft = useCallback(
    async (cardId: string, fromTool = false): Promise<Applied | null> => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "meals-draft") return null;
      const card = found.payload;
      const result = await applyDraftFile(
        card.draftId,
        liveMealsPorts({ today: () => todayLocal(), changed: () => onMealsChanged?.() }),
      );
      if (!result?.ok) return result;
      // What the draft rules still find goes on the meals page as a note the
      // reader can wipe away; the plan is written either way.
      planNote.show(result.check ?? null);
      const applied: MealsDraftCardData = { ...card, phase: "applied" };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      const broken = checkNote(result.check);
      if (!fromTool && result.shown) {
        noteCardTurn(broken ? `${result.note} ${broken}` : result.note, nextCardId("meals"), result.shown);
      }
      // Into the batch cook just planned (docs/671 备餐页).
      if (onMealsApplied) leaveForAppliedPlan(result.session ?? null, pipCards, { open: onMealsApplied, swap: () => setSwapped(true), hangUp: onHangUp });
      return result;
    },
    [bookId, anchor.threadId, noteCardTurn, onMealsChanged, onMealsApplied, pipCards, onHangUp],
  );

  // The draft still waiting for its 「就这样」 in this conversation, from the draft file.
  const currentDraft = async (): Promise<MealsDraftFile | null> => waitingDraft(await loadMealsDraft(), anchor.threadId);

  // The card action dispatcher wired into the message list. Stable across
  // streaming deltas, so the memoized rows never churn.
  const onCardAction = useCallback(
    (cardId: string, action: CardAction) => {
      switch (action.kind) {
        case "mutate":
          if (action.op === "apply-topic") void handleApplyTopic(cardId);
          else if (action.op === "apply-meals-draft") void handleApplyMealsDraft(cardId);
          break;
        case "navigate":
          if (action.to === "meals" || action.to === "meals-shopping") {
            onOpenMeals?.(action.to);
            // Get out of the way of the screen just opened: shrink into the pip
            // where there is one, hang up where the chat is the whole screen.
            if (navigateAway(pipCards) === "swap") setSwapped(true);
            else onHangUp();
          }
          break;
        case "local":
          setMessages((prev) => patchCardPayload(prev, cardId, action.patch));
          break;
        case "reply":
          noteTurn(action.text, { role: action.role });
          break;
        case "resolve":
          // Reserved for future human-in-the-loop cards; no card dispatches it yet.
          break;
      }
    },
    [handleApplyTopic, handleApplyMealsDraft, onOpenMeals, onHangUp, pipCards, noteTurn, setMessages, setSwapped],
  );

  // A turn on the conversation as it stands when it is asked, which is not
  // always when it was first asked (place-session.ts: a stall asks again, and
  // so do lines the reader said into a turn that never took them): the meals
  // desk assembled into one call with the tools this surface draws the cards of.
  async function assemble(signal: AbortSignal): Promise<PlaceAssembled> {
    const history = messagesRef.current.filter((m) => !m.streaming && !m.queued);
    const said = replayableHistory(history);
    const latest = [...history].reverse().find((m) => m.role === "user");
    const prepared = await prepareMealsTurn({
      anchor,
      signal,
      messages: said,
      mealsTools: async () =>
        buildLiveMealsTools({
          threadId: anchor.threadId,
          onMealsCard: showMealsCard,
          applyDraft: async () => {
            const hit = await currentDraft();
            return hit ? handleApplyMealsDraft(draftCardId(hit.draftId), true) : null;
          },
          today: () => todayLocal(),
          changed: () => onMealsChanged?.(),
          // start_prep: the run and its card, then the call (docs/671 时间线与语音).
          startPrep: () =>
            startPrepFromChat(
              {
                ports: liveMealsPorts({ today: () => todayLocal(), changed: () => onMealsChanged?.() }),
                putCard: putMealsPrepCard,
                today: () => todayLocal(),
              },
              requestPrepVoice,
            ),
        }),
      mealsDraft: currentDraft,
      mealsState: () => loadMeals(),
      topic: { onCard: (payload) => raiseCard("topic", payload) },
      raiseConfirmCard: (payload) => raiseCard("housekeeper", payload),
    });
    if (prepared.kind === "failed") return prepared;
    if (prepared.kind === "refused") return { kind: "refused", message: prepared.text };
    if (prepared.kind === "aborted") return prepared;
    deskRef.current = prepared.items;
    return {
      kind: "turn",
      request: {
        key: prepared.key,
        origin: prepared.origin,
        conversation: anchor.threadId,
        surface: "info",
        line: { text: prepared.line, ...(latest ? { ts: latest.ts } : {}) },
        systemPrompt: prepared.systemPrompt,
        tools: prepared.tools,
        model: prepared.model,
        ...(prepared.thinkingLevel ? { thinkingLevel: prepared.thinkingLevel } : {}),
      },
      ...(prepared.notice ? { notice: prepared.notice } : {}),
    };
  }

  async function send(text: string) {
    const said = text.trim();
    if (!said) return;
    await lookingRef.current;
    const session = sessionRef.current;
    if (!session) return;
    const ts = stamp();
    // A turn is running: this is a line into it, not a second turn (docs/72).
    // It is drawn under the reply, handed to the model at the end of the round
    // in flight, and opens the next turn if this one ends without taking it.
    if (session.say(text, ts)) return;
    setMessages((prev) => [...prev, { role: "user", text, ts }]);
    appendMessage(bookId, anchor.threadId, { role: "user", text, ts });
    session.ask();
  }

  const stop = useCallback(() => sessionRef.current?.stop(), []);

  return { messages, stickKey, streaming, swapped, setSwapped, send, stop, onCardAction };
}
