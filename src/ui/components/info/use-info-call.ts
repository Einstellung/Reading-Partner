// The info call's live state (docs/16, docs/17): the anchor's thread, the turn
// currently streaming, the briefing job the one card is tracking, and what each
// card gesture fans out to.
//
// It sits in the ui layer rather than in info/briefer because it is where the
// domain meets the chat rendering (chatParts): a card is both a payload the
// tools produced and a row in the conversation, and one of those two is a render
// concern. Everything decidable without React — which card a start attempt draws
// (briefer/call.ts), what an Add or an Apply does in what order
// (briefer/card-actions.ts) — is in the domain and tested there; what is left
// here is wiring and the effects it drives.
//
// The turns run on the device's durable runtime (docs/soul/87): assembled by
// info/briefer/info-durable.ts prepareInfoTurn, driven by
// reading/turn/place-session.ts, landed into the conversation's file by the
// info or meals place. The reader can talk into a running turn (docs/72); Stop
// keeps the half sentence and the receipts; a turn in flight when the
// conversation opens — one a killed process left, resumed at start — is drawn,
// stoppable and steerable like one started here. Closing the call does not stop
// its turn: it runs on and lands, with a box card if nobody has the
// conversation open by then, and the call opened again follows it.

import { useCallback, useEffect, useRef, useState } from "react";
import { applyTopicProposal, type TopicProposalCardData } from "../../../memory";
import type { DeskItem } from "../../../desk";
import { infoThreadKey, infoThreadOrigin, prepareInfoTurn, watchInfoConversation } from "../../../info/briefer/info-durable";
import { createTopic } from "../../../platform/app/topics";
import {
  appendMessage,
  createThread,
  getThread,
  loadThreads,
  patchThreadMessage,
  setThreadTopic,
} from "../../../platform/app/threads";
import { buildLiveCompanionTools } from "../../../info/briefer/companion-live";
import {
  BRIEFING_CARD_ID,
  OPENING_KICKOFF,
  askFailedNote,
  askScope,
  askSentNote,
  briefingJobPlan,
  briefingJobUpdate,
  infoBookId,
  labArchivedNote,
  labFiledNote,
  sourceAddedNote,
  topicFiledNote,
  type BriefingJob,
} from "../../../info/briefer/call";
import {
  addSourceFromCard,
  applyLabArchive,
  applyLabProposal,
} from "../../../info/briefer/card-actions";
import { addLab, archiveLab, claimSources } from "../../../info/labs/store";
import { applyDraft, checkNote, type Applied } from "../../../info/meals/apply";
import { planNote } from "../../../info/meals/screen/plan-note";
import { draftCardId, type MealsCard, type MealsDraftCardData } from "../../../info/meals/cards";
import { buildLiveMealsTools, liveMealsPorts } from "../../../info/meals/live";
import { todayLocal } from "../../../info/collect/store";
import type { InfoCallAnchor } from "../../../info/briefer/anchors";
import { addSource, hasSources, loadSources } from "../../../info/sources/source-store";
import { distillInfoThread } from "../../../memory";
import { readingDurable } from "../../../reading/turn/durable-runtime";
import type { CallRow } from "../../../reading/turn/call-state";
import { createPlaceSession, registerOpenSession, withPlaceTurnRows, type PlaceAssembled, type PlaceSession } from "../../../reading/turn/place-session";
import { forgetScroll } from "../common/scroll-memory";
import { navigateAway } from "../chat/call/call-layout";
import { replayableHistory } from "../../../ai/turn-view/turn-rows";
import {
  cardRow,
  findCardPart,
  nextCardId,
  patchCardPayload,
  rehydrateMessage,
  toPersistedCardPart,
  upsertCardRow,
  latestCardOf,
  type CardAction,
  type CardPayload,
} from "../chat/chatParts";
import type { BriefingView, RequestOutcome } from "../../../info/briefer/reader";
import type {
  LabArchiveCardData,
  LabProposalCardData,
} from "../../../info/boxes/cards";
import type { ThreadMessage as UiMessage } from "../chat/types";

export interface InfoCallOptions {
  anchor: InfoCallAnchor;
  dateKey: string;
  view: BriefingView;
  collecting: boolean;
  // Whether the call has corner cards, and with them a layout to swap into.
  pipCards: boolean;
  onHangUp: () => void;
  onSourcesChanged?: () => void;
  // Filing something under a new topic puts a topic on the shelf that was not
  // there, so the host reloads it.
  onTopicsChanged?: () => void;
  onOpenBriefing?: (date: string) => void;
  // The meals screen reloads. Applying a plan and recording a deviation both
  // write without the screen asking, so nothing else would tell it.
  onMealsChanged?: () => void;
  // Open a meals screen from a card's link (the draft card's 查看计划 and 采购单).
  onOpenMeals?: (screen: "meals" | "meals-shopping") => void;
}

export interface InfoCallController {
  messages: UiMessage[];
  // Identifies this conversation to the transcript's scroll memory
  // (ui/components/common/scroll-memory.ts).
  stickKey: string;
  streaming: boolean;
  // Whether the reader has tapped the call out of the way.
  swapped: boolean;
  setSwapped: (swapped: boolean) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  onCardAction: (cardId: string, action: CardAction) => void;
}

/**
 * The key this conversation's scroll position is stored under. The briefing and
 * article thread ids now carry the day themselves (anchors.ts), so the date here
 * is redundant for those two and still separates the days for "onboarding",
 * which is a constant. The prefix keeps info out of the reading thread-id space.
 */
export function infoStickKey(dateKey: string, threadId: string): string {
  return `info:${dateKey}:${threadId}`;
}

const isCardRow = (m: UiMessage) => m.parts?.some((part) => part.type === "card") ?? false;

export function useInfoCall(opts: InfoCallOptions): InfoCallController {
  const { anchor, dateKey, view, collecting, pipCards, onHangUp, onSourcesChanged, onTopicsChanged, onOpenBriefing, onMealsChanged, onOpenMeals } =
    opts;
  const [swapped, setSwapped] = useState(false);
  // A conversation anchored to a date lives in that day's file; a standing one
  // (meals's) names its own, so its thread outlives any day (anchors.ts).
  const bookId = anchor.bookKey ?? infoBookId(dateKey);
  const stickKey = infoStickKey(dateKey, anchor.threadId);
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

  // An info call ends by its component unmounting, where a reading call ends at
  // call === null and App clears the whole store.
  useEffect(() => () => forgetScroll(stickKey), [stickKey]);

  // Closing the conversation is this side's hangup: what the reader said goes to
  // a distillation pass (memory/distill). Fired and forgotten — a pass has to
  // outlive the component that started it, it never surfaces UI, and a
  // conversation this misses is picked up by the half-hourly sweep, which reads
  // the same source. The onboarding thread is not a unit any source lists, so
  // naming it here distils nothing.
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

  // First-briefing tracking (add-source mode): whether we are waiting on a
  // generation we kicked. The progress -> ready/failed card rides a single
  // stable card id, so no per-run ts bookkeeping is needed. Only a collector
  // ever waits — a reader's request goes to another machine and comes back as a
  // briefing, not as a run to watch.
  const awaitingBriefing = useRef(false);
  // Which briefing job the progress/ready/failed card is tracking, so the ready
  // copy and the failed-card retry both address the right run.
  const lastJobRef = useRef<BriefingJob>("first");

  // A synthetic turn injected into the thread outside an AI reply: a card gesture
  // reporting itself, or a settled briefing job re-anchoring the AI. Shown at
  // once, and written to disk unless the outcome is in-session only.
  const noteTurn = useCallback(
    (text: string, opts?: { role?: "user" | "ai"; persist?: boolean }) => {
      const role = opts?.role ?? "user";
      const ts = stamp();
      notesRef.current.add(`${role}:${ts}`);
      setMessages((prev) => [...prev, { role, text, ts }]);
      if (opts?.persist !== false) appendMessage(bookId, anchor.threadId, { role, text, ts });
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

  // Load (or start) the anchor's thread whenever it changes, and join a turn
  // in flight on it. In onboarding, kick the AI's opening turn once the empty
  // thread loads.
  useEffect(() => {
    let live = true;
    let unwatch: (() => void) | undefined;
    setSwapped(false);
    const origin = infoThreadOrigin(anchor, dateKey);
    const key = infoThreadKey(origin);
    (async () => {
      try {
        await loadThreads(bookId);
      } catch {
        // A missing/corrupt thread file starts an empty conversation.
      }
      if (!live) return;
      let thread = getThread(bookId, anchor.threadId);
      if (!thread) thread = createThread(bookId, "info", anchor.threadId);
      setMessages(thread.messages.map(rehydrateMessage));
      const session = createPlaceSession({
        durable: readingDurable,
        key,
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
      const unwatchInfo = watchInfoConversation(key);
      unwatch = () => {
        closed();
        unwatchInfo();
      };
      const looking = session.resume().catch((e: unknown) => {
        console.warn("info turn could not be resumed", e);
        return false;
      });
      lookingRef.current = looking;
      if ((await looking) || !live) return;
      const empty = thread.messages.length === 0;
      // Onboarding: the AI opens the conversation itself when the thread is empty.
      // Gated on the on-disk thread being empty, so a reopened conversation never
      // re-greets.
      if (anchor.onboarding && empty) session.ask();
      // A screen's button opened this conversation with something to say ("Plan
      // this week."). Sent as the reader's own turn, shown and persisted, and
      // only into an empty thread — a standing conversation reopened next week
      // would otherwise re-say it every time.
      if (anchor.kickoff && empty) void send(anchor.kickoff);
    })();
    return () => {
      live = false;
      sessionRef.current?.detach();
      sessionRef.current = null;
      unwatch?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, anchor.threadId]);

  // Briefing generation status: reflect the singleton pipeline's progress and
  // drop in the ready/failed card when it finishes. The one briefing card is
  // addressed by BRIEFING_CARD_ID through the patchPart channel (upsertCardRow)
  // across its whole progress -> ready/failed lifecycle; what that card shows,
  // the note the outcome injects, and whether either is durable is decided in
  // info/briefer/call.
  useEffect(() => {
    const unsub = view.subscribe(() => {
      if (!awaitingBriefing.current) return;
      const update = briefingJobUpdate(lastJobRef.current, view.snapshot());
      setMessages((prev) => upsertCardRow(prev, BRIEFING_CARD_ID, update.card));
      if (update.status === "running") return;
      awaitingBriefing.current = false;
      if (update.persist) {
        appendMessage(bookId, anchor.threadId, {
          role: "ai",
          text: "",
          ts: Date.now(),
          parts: [toPersistedCardPart(BRIEFING_CARD_ID, update.card)],
        });
      }
      // Re-anchor the AI on the outcome, so its next turn answers from the fresh
      // briefing rather than the one still in its context (or knows the run died).
      noteTurn(update.note, { persist: update.persist });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, anchor.threadId, noteTurn, view]);

  // Start (or retry) a briefing job through the one BRIEFING_CARD_ID card: "first"
  // collects + triages (onboarding); "full" does the same on the user's explicit
  // regenerate request; "retriage" re-triages today's cached items with the current
  // profile (no collection). Retry reuses the same card row so progress/error
  // updates in place rather than appending a new row.
  //
  // The view answers with which of three things happened; briefingJobPlan turns
  // that into which of two things this thread does about it.
  function runBriefingJob(job: BriefingJob): RequestOutcome {
    const { outcome, done } = view.request(askScope(job));
    const plan = briefingJobPlan(job, outcome, view.snapshot());
    lastJobRef.current = plan.job;
    if (plan.kind === "asked") {
      // The note waits for the file to really be on disk, which is the one thing
      // the tool's own reply cannot wait for: a request the user was told had
      // been passed on, and that never left the device, is worse than none.
      void done.then(
        () => noteTurn(askSentNote(plan.job, view.notices()[0]), { role: "ai", persist: false }),
        () => noteTurn(askFailedNote(), { role: "ai", persist: false }),
      );
      return outcome;
    }
    awaitingBriefing.current = true;
    setMessages((prev) => upsertCardRow(prev, plan.cardId, plan.card));
    return outcome;
  }

  // Add the trialed source when the user clicks a confirm card's Add. One gesture,
  // three effects: mutate (addSource, the local write path, not the AI's
  // add_source), local (flip `added` on the card, in the UI and on disk), and
  // reply (note the add in the thread so the AI knows). The order and the guards
  // are in info/briefer/card-actions.
  const handleAddFromCard = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "probe-confirm") return;
      const card = found.payload;
      await addSourceFromCard(card, {
        hasSources,
        addSource: (d) => addSource(d).then(() => {}),
        markAdded: () => {
          setMessages((prev) => patchCardPayload(prev, cardId, { added: true }));
          patchThreadMessage(bookId, anchor.threadId, found.ts, {
            parts: [toPersistedCardPart(cardId, { ...card, added: true })],
          });
        },
        sourcesChanged: () => onSourcesChanged?.(),
        note: () => noteTurn(sourceAddedNote(card)),
        startFirstBriefing: () => runBriefingJob("first"),
      });
    },
    // runBriefingJob reads only refs, so its per-render identity is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId, anchor.threadId, onSourcesChanged, noteTurn],
  );

  // File what the AI proposed when the user clicks a topic card's Apply: mint
  // the topic where it is new, file this conversation under it, let what is on
  // the desk follow the topic (the article files its kept copy), and tell the
  // AI. The order and what a failure stops are in memory/filing/settle.ts.
  //
  // Filing the thread is what makes the next turn's desk, its distillation and
  // its conversation search all read the topic the reader chose; until they have
  // chosen one there is none (soul/self.ts reads it off the thread record).
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

  // Open the room the companion drafted a charter for, and hand it the sources
  // the charter claimed (docs/63). Two writes for one gesture; the order and
  // what a failed claim does not undo are in info/briefer/card-actions.
  const handleApplyLab = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "lab-proposal") return;
      const card = found.payload;
      const { ok } = await applyLabProposal(card, {
        addLab: (lab) => addLab(lab),
        claimSources: (labId, sourceIds) => claimSources(labId, sourceIds),
        listSources: () => loadSources(),
        now: () => Date.now(),
        // The same reload the source list gets: it reads the rooms too, and the
        // home card is watching them — the notice that nothing is being
        // collected has to go the moment the room behind it exists.
        labsChanged: () => onSourcesChanged?.(),
      });
      if (!ok) return;
      const applied: LabProposalCardData = { ...card, phase: "applied" };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      noteTurn(labFiledNote(card));
    },
    [bookId, anchor.threadId, noteTurn, onSourcesChanged],
  );

  // Close a room. The record and its picture stay on disk; only the status flips.
  const handleArchiveLab = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "lab-archive") return;
      const card = found.payload;
      const { ok } = await applyLabArchive(card, {
        archiveLab: (labId, now) => archiveLab(labId, now),
        now: () => Date.now(),
        labsChanged: () => onSourcesChanged?.(),
      });
      if (!ok) return;
      const applied: LabArchiveCardData = { ...card, phase: "applied" };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      noteTurn(labArchivedNote(card));
    },
    [bookId, anchor.threadId, noteTurn, onSourcesChanged],
  );

  // The draft's 「就这样」, or apply_meal_plan: the plan and the shopping list
  // derived from it in one write, the screen reloaded through the ports'
  // `changed`, and the card collapsed to its applied form. The model is told in
  // a row that draws nothing (info/meals/cards.ts) unless the tool asked, whose
  // own result tells it.
  const handleApplyMealsDraft = useCallback(
    async (cardId: string, fromTool = false): Promise<Applied | null> => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "meals-draft") return null;
      const card = found.payload;
      const result = await applyDraft(
        card,
        liveMealsPorts({ today: () => todayLocal(), changed: () => onMealsChanged?.() }),
      );
      if (!result.ok) return result;
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
      return result;
    },
    [bookId, anchor.threadId, noteCardTurn, onMealsChanged],
  );

  // The draft card still waiting for its 「就这样」, which a new draft revises.
  const currentDraft = (): MealsDraftCardData | null => {
    const hit = latestCardOf(messagesRef.current, "meals-draft");
    return hit && hit.payload.phase === "proposed" ? hit.payload : null;
  };

  // The card action dispatcher wired into the message list. Stable across
  // streaming deltas, so the memoized rows never churn. It owns orchestration:
  // one gesture may fan out to several effects (see handleAddFromCard).
  const onCardAction = useCallback(
    (cardId: string, action: CardAction) => {
      switch (action.kind) {
        case "mutate":
          if (action.op === "add-source") void handleAddFromCard(cardId);
          else if (action.op === "apply-topic") void handleApplyTopic(cardId);
          else if (action.op === "apply-lab") void handleApplyLab(cardId);
          else if (action.op === "apply-lab-archive") void handleArchiveLab(cardId);
          else if (action.op === "apply-meals-draft") void handleApplyMealsDraft(cardId);
          else if (action.op === "retriage") runBriefingJob("retriage");
          else if (action.op === "retry-briefing") runBriefingJob(lastJobRef.current);
          break;
        case "navigate":
          if (action.to === "briefing") {
            const date = action.arg ?? (findCardPart(messagesRef.current, cardId)?.payload as { date?: string })?.date;
            if (date) onOpenBriefing?.(date);
            // Get out of the way of the screen just opened: shrink into the pip
            // where there is one, hang up where the chat is the whole screen.
            if (navigateAway(pipCards) === "swap") setSwapped(true);
            else onHangUp();
          } else if (action.to === "meals" || action.to === "meals-shopping") {
            onOpenMeals?.(action.to);
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
    // The three handlers are stable; runBriefingJob reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      handleAddFromCard,
      handleApplyTopic,
      handleApplyLab,
      handleArchiveLab,
      handleApplyMealsDraft,
      onOpenBriefing,
      onOpenMeals,
      onHangUp,
      pipCards,
      noteTurn,
    ],
  );

  // A turn on the conversation as it stands when it is asked, which is not
  // always when it was first asked (place-session.ts: a stall asks again, and
  // so do lines the reader said into a turn that never took them): the
  // anchor's desk (the day's briefing, and the article where there is one, or
  // the meals desk) assembled into one call with the tools this surface draws
  // the cards of. The onboarding opener has nothing above it; the AI speaks first.
  async function assemble(signal: AbortSignal): Promise<PlaceAssembled> {
    const history = messagesRef.current.filter((m) => !m.streaming && !m.queued);
    const said = replayableHistory(history);
    const opening = anchor.onboarding && said.length === 0;
    const latest = opening ? undefined : [...history].reverse().find((m) => m.role === "user");
    const prepared = await prepareInfoTurn({
      anchor,
      key: bookId,
      dateKey,
      signal,
      messages: opening ? [{ role: "user", text: OPENING_KICKOFF }] : said,
      // The briefing controller for generate_briefing: a background job through
      // the one card's lifecycle, answering with which of the three things
      // happened — a run started here, a run was already going here, or the
      // request was left for the machine that collects — so the companion
      // reports the right one.
      companionTools: () =>
        buildLiveCompanionTools(
          (payload) => raiseCard("probe", payload),
          { start: (scope) => runBriefingJob(scope) },
          {
            collecting,
            lab: {
              threadId: anchor.threadId,
              onLabCard: (payload) => raiseCard("lab", payload),
            },
          },
        ),
      mealsTools: async () =>
        buildLiveMealsTools({
          threadId: anchor.threadId,
          onMealsCard: showMealsCard,
          currentDraft,
          applyDraft: async () => {
            const hit = currentDraft();
            return hit ? handleApplyMealsDraft(draftCardId(hit.draftId), true) : null;
          },
          today: () => todayLocal(),
          changed: () => onMealsChanged?.(),
        }),
      mealsDraft: currentDraft,
      topic: { onCard: (payload) => raiseCard("topic", payload) },
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
