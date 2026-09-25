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

import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentTurn } from "../../../legion/execute/turn";
import { soulHarness, type AssembledTurn } from "../../../soul";
import { applyTopicProposal, type TopicProposalCardData } from "../../../memory";
import type { DeskItem } from "../../../desk";
import { assembleInfoTurn } from "../../../info/briefer/info-turn";
import { loadSettings, toReasoning } from "../../../platform/app/settings";
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
  ASK_FAILED_NOTE,
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
import { applyPlan } from "../../../info/meals/apply";
import type { MealsPlanCardData } from "../../../info/meals/cards";
import { buildLiveMealsTools, liveMealsPorts } from "../../../info/meals/live";
import { todayLocal } from "../../../info/collect/store";
import type { InfoCallAnchor } from "../../../info/briefer/anchors";
import { addSource, hasSources, loadSources } from "../../../info/sources/source-store";
import { distillInfoThread } from "../../../memory";
import { forgetScroll } from "../common/scroll-memory";
import { modelIdFor } from "../../../ai/model-tier";
import { navigateAway } from "../chat/call-layout";
import { replayableHistory } from "../../../ai/turn-rows";
import {
  findCardPart,
  patchCardPayload,
  rehydrateMessage,
  toPersistedCardPart,
  upsertCardRow,
  type CardAction,
} from "../chat/chatParts";
import { useStreamingTurn, type StreamingTurnRun } from "../chat/useStreamingTurn";
import type { ChatMessage, ProviderId } from "../../../ai/providers";
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

export function useInfoCall(opts: InfoCallOptions): InfoCallController {
  const { anchor, dateKey, view, collecting, pipCards, onHangUp, onSourcesChanged, onTopicsChanged, onOpenBriefing, onMealsChanged } =
    opts;
  const [swapped, setSwapped] = useState(false);
  // A conversation anchored to a date lives in that day's file; a standing one
  // (meals's) names its own, so its thread outlives any day (anchors.ts).
  const bookId = anchor.bookKey ?? infoBookId(dateKey);
  const stickKey = infoStickKey(dateKey, anchor.threadId);
  // The turn in flight and the rows it writes into. Stop settles it the way
  // every chat surface does: runAgentTurn says nothing once the reader has
  // aborted it, so the hook keeps what was written.
  const { messages, setMessages, streaming, begin, raiseCard, stop, abort } = useStreamingTurn(
    bookId,
    anchor.threadId,
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

  // Latest messages, mirrored to a ref so the (id-keyed) card dispatcher can look
  // up a card's payload without being torn down and rebuilt on every delta.
  const messagesRef = useRef<UiMessage[]>(messages);
  messagesRef.current = messages;

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
      const ts = Date.now();
      setMessages((prev) => [...prev, { role, text, ts }]);
      if (opts?.persist !== false) appendMessage(bookId, anchor.threadId, { role, text, ts });
    },
    [bookId, anchor.threadId],
  );

  // Load (or start) the anchor's thread whenever it changes; open the chat
  // window. In onboarding, kick the AI's opening turn once the empty thread loads.
  useEffect(() => {
    let live = true;
    setSwapped(false);
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
      // Onboarding: the AI opens the conversation itself when the thread is empty.
      // Gated on the on-disk thread being empty, so a reopened conversation never
      // re-greets.
      if (anchor.onboarding && thread.messages.length === 0) {
        begin((run) => void runAgent([{ role: "user", text: OPENING_KICKOFF }], run));
      }
      // A screen's button opened this conversation with something to say ("Plan
      // this week."). Sent as the reader's own turn, shown and persisted, and
      // only into an empty thread — a standing conversation reopened next week
      // would otherwise re-say it every time.
      if (anchor.kickoff && thread.messages.length === 0) void send(anchor.kickoff);
    })();
    return () => {
      live = false;
      abort();
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
        () => noteTurn(ASK_FAILED_NOTE, { role: "ai", persist: false }),
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

  // The week's Apply: the plan and the shopping list derived from it, in one
  // write, and the screen reloaded through the ports' `changed`.
  const handleApplyMealsPlan = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "meals-plan") return;
      const card = found.payload;
      const { ok, note } = await applyPlan(
        card,
        liveMealsPorts({ today: () => todayLocal(), changed: () => onMealsChanged?.() }),
      );
      if (!ok) return;
      const applied: MealsPlanCardData = { ...card, phase: "applied" };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      noteTurn(note);
    },
    [bookId, anchor.threadId, noteTurn, onMealsChanged],
  );

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
          else if (action.op === "apply-meals-plan") void handleApplyMealsPlan(cardId);
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
      handleApplyMealsPlan,
      onOpenBriefing,
      onHangUp,
      pipCards,
      noteTurn,
    ],
  );

  // The companion's agent turn: the anchor's desk (the day's briefing, and the
  // article where there is one) assembled into one call (src/soul), then
  // run with the tool trace and confirm cards this surface draws. The row it
  // answers into is already open (useStreamingTurn); for the onboarding opener
  // there is no visible user message above it, otherwise the caller already
  // appended the user turn.
  async function runAgent(history: ChatMessage[], run: StreamingTurnRun) {
    const settings = await loadSettings();
    if (!settings.defaultProviderId || !settings.defaultModelId) {
      run.fail("No AI provider configured (Settings).");
      return;
    }
    // The briefing controller for generate_briefing: a background job through the
    // one card's lifecycle, answering with which of the three things happened —
    // a run started here, a run was already going here, or the request was left
    // for the machine that collects — so the companion reports the right one.
    //
    // The desk is laid inside a catch: opening
    // the briefing builds those tools, which awaits the article extractor's
    // chunk (info/extract/readable-lazy). That is a fetch, and a fetch can fail
    // — a chunk 404ing after a redeploy, a dropped connection, a CSP that turns
    // it down. Nothing upstream would catch it.
    // `send` is handed to the composer as a void-returning prop and the
    // onboarding opener kicks this with `void`, so an escaping rejection is an
    // unhandled one and the reply row spins for good. The turn stops here
    // instead, in the row the reader is already looking at; the next send tries
    // the chunk again, since cacheUntilFailure drops a rejected load.
    let turn: AssembledTurn | null;
    try {
      const assembled = await assembleInfoTurn({
        anchor,
        key: bookId,
        dateKey,
        settings,
        signal: run.signal,
        messages: history,
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
            onMealsCard: (payload) => raiseCard("meals", payload),
            today: () => todayLocal(),
            changed: () => onMealsChanged?.(),
          }),
        topic: { onCard: (payload) => raiseCard("topic", payload) },
      });
      deskRef.current = assembled.items;
      turn = assembled.turn;
    } catch (e) {
      console.error("failed to load the article extractor", e);
      run.fail("The article extractor could not be loaded. Try again.");
      return;
    }
    // The reader walked away while the desk was being laid.
    if (!turn) return;
    // Too big to leave the model room to answer, and nothing to retry.
    if (turn.refusal) {
      run.fail(turn.refusal);
      return;
    }
    void runAgentTurn({
      providerId: settings.defaultProviderId as ProviderId,
      // Which of the two models this thread runs on (ai/model-tier.ts): the
      // meals conversation is everyday work, the day's briefing chat is not.
      modelId: modelIdFor(settings, "talk") as string,
      systemPrompt: turn.systemPrompt,
      messages: turn.messages,
      tools: turn.tools,
      reasoning: toReasoning(settings.chatThinking),
      signal: run.signal,
      telemetry: { surface: "info", thread: anchor.threadId },
      harness: soulHarness(),
      ...(turn.origin ? { deliverTo: turn.origin } : {}),
      ...run.handlers(),
    });
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const now = Date.now();
    const userMsg: UiMessage = { role: "user", text, ts: now };
    const history: ChatMessage[] = replayableHistory([...messages, userMsg]);
    setMessages((prev) => [...prev, userMsg]);
    appendMessage(bookId, anchor.threadId, { role: "user", text, ts: now });
    let sent: Promise<void> | undefined;
    begin((run) => {
      sent = runAgent(history, run);
    });
    await sent;
  }

  return { messages, stickKey, streaming, swapped, setSwapped, send, stop, onCardAction };
}
