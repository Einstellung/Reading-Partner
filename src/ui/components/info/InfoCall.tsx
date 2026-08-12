// The info call over the briefing / article (docs/16), on the call model (docs/03).
// It reuses the reader call's main-screen path (the top-bar AI button's
// "直接进主画面态,不经过气泡"): clicking "ask" opens the full chat window with the
// article/briefing shrunk to a corner position card. Tapping the card swaps
// (content main, chat becomes the corner pip); ✕ hangs up. No bubble, no
// auto-started take — the composer is ready and the user types.
//
// A shell can turn the corner cards off (the phone's does, docs/22): then the
// chat is the whole screen, there is no card to tap and no swapped layout to
// tap it into. call-layout.ts holds that rule.
//
// Every info thread runs the same agent loop with the shared companion tool set
// (docs/16/17): probe/trial/add_source plus update_profile, surfacing inline
// confirm cards. The anchors differ only in context: the briefing/article
// companion, or the onboarding add-source flow (the AI opens, and on the first
// source added a background first-briefing shows its progress/readiness as a
// card). update_profile drafts a profile change the user Applies; applying it
// offers a re-triage of today's cached items through the same progress card.

import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentTurn } from "../../../ai/agent";
import { loadSettings, toReasoning } from "../../../platform/app/settings";
import { appendMessage, createThread, getThread, loadThreads, patchThreadMessage } from "../../../platform/app/threads";
import { buildLiveCompanionTools } from "../../../info/companion/companion-live";
import { companionToolStatusLabel } from "../../../info/companion/companion-tools";
import {
  BRIEFING_CARD_ID,
  OPENING_KICKOFF,
  ASK_FAILED_NOTE,
  askSentNote,
  briefingJobUpdate,
  briefingProgressCard,
  infoBookId,
  profileAppliedNote,
  runnableJob,
  sourceAddedNote,
  trackedJob,
  type BriefingJob,
} from "../../../info/companion/call";
import { addSource, hasSources } from "../../../info/sources/source-store";
import { loadProfile, saveProfile } from "../../../observation/profile";
import { replaceDeclared } from "../../../observation/guess";
import { askCollector, getInfoPipeline } from "../../../info/briefing/live";
import { Badge } from "../ui/badge";
import CallView from "../chat/CallView";
import ChatPipCard from "../chat/ChatPipCard";
import { callLayout, navigateAway } from "../chat/call-layout";
import { appendRunningTool, resolveToolStatus } from "../common/toolTrace";
import ReadingPipCard from "../chat/ReadingPipCard";
import {
  cardRow,
  findCardPart,
  insertBeforeLast,
  nextCardId,
  patchCardPayload,
  rehydrateMessage,
  toPersistedCardPart,
  upsertCardRow,
  type CardAction,
} from "../chat/chatParts";
import type { ComposerVoice } from "../chat/chat";
import type { ChatMessage } from "../../../ai/providers";
import type { BriefingView, RequestOutcome } from "../../../info/briefing/reader";
import type { ProfileUpdateCardData } from "../../../info/briefing/cards";
import type { ProbeConfirmCardData } from "../../../info/sources/source-cards";
import type { ThreadMessage as UiMessage } from "../common/types";

export interface InfoCallAnchor {
  // "briefing" for the briefing-level thread, or the item id for an article, or
  // "onboarding" for the add-source flow.
  threadId: string;
  // The chat window's empty-state heading and composer placeholder.
  emptyTitle: string;
  placeholder: string;
  systemPrompt: string;
  // The corner position card: the article/briefing shrunk to a title, an
  // optional source name tag, and a one-line reason/overview.
  position: { title: string; sourceName?: string; line: string | null };
  // The anchor kind. Every mode carries the same tools now; this only tags the
  // add-source flow for readers of the anchor.
  mode?: "chat" | "add-source";
  // First-run onboarding: the AI opens the conversation itself.
  onboarding?: boolean;
}

export function InfoCall({
  anchor,
  dateKey,
  view,
  collecting,
  onHangUp,
  voice,
  onSourcesChanged,
  onOpenBriefing,
  pipCards = true,
}: {
  anchor: InfoCallAnchor;
  dateKey: string;
  // The briefing this chat talks about, and what can be done to it. On a
  // collector it is the running pipeline; on a reader it is the published files
  // and nothing is running (docs/36).
  view: BriefingView;
  // Whether this device is the one that collects. It decides which tools the
  // companion gets and what a request for a new briefing actually does: run one
  // here, or leave a note for the machine that can.
  collecting: boolean;
  onHangUp: () => void;
  voice?: ComposerVoice | false;
  // Called after the source list changes (add), so the host refreshes hasSources.
  onSourcesChanged?: () => void;
  // Clicking the briefing-ready card: open the briefing as the main screen.
  onOpenBriefing?: (date: string) => void;
  // Whether the call keeps its corner cards, and with them the swapped layout.
  // The shell decides — no shape is detected here. False on the phone (docs/22),
  // where the chat is a screen the reader pushed and pops with a back.
  pipCards?: boolean;
}) {
  // Whether the reader has tapped the call out of the way. With no corner cards
  // there is no way to set it and no layout to set it to (call-layout.ts).
  const [swapped, setSwapped] = useState(false);
  const layout = callLayout(pipCards, swapped);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bookId = infoBookId(dateKey);

  // Latest messages, mirrored to a ref so the (id-keyed) card dispatcher can look
  // up a card's payload without being torn down and rebuilt on every delta.
  const messagesRef = useRef<UiMessage[]>(messages);
  messagesRef.current = messages;

  // First-briefing tracking (add-source mode): whether we are waiting on a
  // generation we kicked. The progress -> ready/failed card rides a single
  // stable card id, so no per-run ts bookkeeping is needed. Only a collector
  // ever waits — a reader's request goes to another machine and comes back as a
  // briefing, not as a run to watch.
  const awaitingBriefing = useRef(false);
  // Which briefing job the progress/ready/failed card is tracking, so the ready
  // copy and the failed-card retry both address the right run.
  const lastJobRef = useRef<BriefingJob>("first");

  const patchLast = useCallback((patch: Partial<UiMessage> | ((m: UiMessage) => Partial<UiMessage>)) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      const p = typeof patch === "function" ? patch(last) : patch;
      next[next.length - 1] = { ...last, ...p };
      return next;
    });
  }, []);

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
        void runAgent([{ role: "user", text: OPENING_KICKOFF }], { seedStreaming: true });
      }
    })();
    return () => {
      live = false;
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, anchor.threadId]);

  // Briefing generation status: reflect the singleton pipeline's progress and
  // drop in the ready/failed card when it finishes. The one briefing card is
  // addressed by BRIEFING_CARD_ID through the patchPart channel (upsertCardRow)
  // across its whole progress -> ready/failed lifecycle; what that card shows,
  // and the note the outcome injects, is decided in info/companion/call.
  useEffect(() => {
    const unsub = view.subscribe(() => {
      if (!awaitingBriefing.current) return;
      const update = briefingJobUpdate(lastJobRef.current, view.snapshot());
      setMessages((prev) => upsertCardRow(prev, BRIEFING_CARD_ID, update.card));
      if (update.status === "running") return;
      awaitingBriefing.current = false;
      // Ready is a durable outcome: persist the card so a reopen shows the
      // briefing exists (the progress card it replaced was never persisted). A
      // failure stays in-session — retry needs the live pipeline — and so does
      // its note, so a reopen doesn't replay it.
      const durable = update.status === "ready";
      if (durable) {
        appendMessage(bookId, anchor.threadId, {
          role: "ai",
          text: "",
          ts: Date.now(),
          parts: [toPersistedCardPart(BRIEFING_CARD_ID, update.card)],
        });
      }
      // Re-anchor the AI on the outcome, so its next turn answers from the fresh
      // briefing rather than the one still in its context (or knows the run died).
      noteTurn(update.note, { persist: durable });
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
  // The pipeline runs one run at a time and says which of the two happened. A
  // refused start does not get a card of its own — nothing would ever update it,
  // which is how a regenerate came to sit on its first frame while the run it
  // collided with went on without it. It joins the run already going instead:
  // that run's progress is what the user asked to see, and the card opens on its
  // real phase and settles with it.
  //
  // On a reader there is no run to start and none to join (docs/36), and a third
  // answer: the request is written for the collecting machine to pick up on its
  // next sync. No card either — there is nothing on this device to show progress
  // for, and no honest estimate of when the other machine will have any.
  function runBriefingJob(job: BriefingJob): RequestOutcome {
    const asked = runnableJob(job);
    if (!collecting) {
      lastJobRef.current = asked;
      // The note waits for the file to really be on disk, which is the one thing
      // the tool's own reply cannot wait for: a request the user was told had
      // been passed on, and that never left the device, is worse than none.
      void askCollector(asked === "retriage" ? "retriage" : "full").then(
        () => noteTurn(askSentNote(asked), { role: "ai", persist: false }),
        () => noteTurn(ASK_FAILED_NOTE, { role: "ai", persist: false }),
      );
      return "asked";
    }
    const p = getInfoPipeline();
    const { start } = asked === "retriage" ? p.retriage() : p.generate();
    const tracked = trackedJob(asked, start);
    lastJobRef.current = tracked;
    awaitingBriefing.current = true;
    setMessages((prev) => upsertCardRow(prev, BRIEFING_CARD_ID, briefingProgressCard(tracked, p.snapshot())));
    return start;
  }

  // Insert a trial's confirm card as its own row just before the streaming reply,
  // and persist it (probe-confirm is a durable card). The source tools hand back a
  // structured payload; this host closure is the one place that turns a payload
  // into a card part.
  function insertProbeCard(payload: ProbeConfirmCardData) {
    const cardId = nextCardId("probe");
    const ts = Date.now();
    setMessages((prev) => insertBeforeLast(prev, cardRow(cardId, payload, ts)));
    appendMessage(bookId, anchor.threadId, {
      role: "ai",
      text: "",
      ts,
      parts: [toPersistedCardPart(cardId, payload)],
    });
  }

  // Add the trialed source when the user clicks a confirm card's Add. One gesture,
  // three effects: mutate (addSource, the local write path, not the AI's
  // add_source), local (flip `added` on the card, in the UI and on disk), and
  // reply (note the add in the thread so the AI knows). Starts the first briefing
  // when this is the first source.
  const handleAddFromCard = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "probe-confirm") return;
      const card = found.payload;
      if (card.added) return;
      let had = true;
      try {
        had = await hasSources();
      } catch {
        // Assume some exist; worst case we skip the first-briefing kick.
      }
      try {
        await addSource(card.descriptor);
      } catch {
        return;
      }
      // local
      setMessages((prev) => patchCardPayload(prev, cardId, { added: true }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, { ...card, added: true })],
      });
      onSourcesChanged?.();
      // reply
      noteTurn(sourceAddedNote(card));
      if (!had) runBriefingJob("first");
    },
    // runBriefingJob reads only refs, so its per-render identity is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId, anchor.threadId, onSourcesChanged, noteTurn],
  );

  // Insert an update_profile draft card and persist it (profile-update is durable
  // like probe-confirm). The tool hands back the drafted payload; this closure is
  // the one place that turns it into a card part.
  function insertProfileCard(payload: ProfileUpdateCardData) {
    const cardId = nextCardId("profile");
    const ts = Date.now();
    setMessages((prev) => insertBeforeLast(prev, cardRow(cardId, payload, ts)));
    appendMessage(bookId, anchor.threadId, {
      role: "ai",
      text: "",
      ts,
      parts: [toPersistedCardPart(cardId, payload)],
    });
  }

  // Apply a drafted profile change when the user clicks a card's Apply: save the
  // new profile, flip the card to its applied state (in the UI and on disk), and
  // note the change so the AI knows. The applied card then offers a re-triage when
  // today's briefing exists. Apply is the only write — the tool never saves.
  const handleApplyProfile = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "profile-update") return;
      const card = found.payload;
      if (card.phase === "applied") return;
      try {
        // The card carries the declared half only (that is all the drafting model
        // was shown), so the write splices it in and leaves the AI's guess section
        // where it is (observation/guess.ts).
        await saveProfile(replaceDeclared(await loadProfile(), card.profile));
      } catch {
        return;
      }
      // A re-triage runs over the day's item snapshot — 683 KB that stays on the
      // collector — so the offer only appears where it can be taken up
      // (docs/36). On a reader the way to a new sort is asking for one.
      const canRetriage = collecting && !!view.snapshot().briefing;
      const applied: ProfileUpdateCardData = { ...card, phase: "applied", canRetriage };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied", canRetriage }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      noteTurn(profileAppliedNote(card));
    },
    [bookId, anchor.threadId, noteTurn],
  );

  // The card action dispatcher wired into the message list. Stable across
  // streaming deltas, so the memoized rows never churn. It owns orchestration:
  // one gesture may fan out to several effects (see handleAddFromCard).
  const onCardAction = useCallback(
    (cardId: string, action: CardAction) => {
      switch (action.kind) {
        case "mutate":
          if (action.op === "add-source") void handleAddFromCard(cardId);
          else if (action.op === "apply-profile") void handleApplyProfile(cardId);
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
    // handleAddFromCard/handleApplyProfile are stable; runBriefingJob reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleAddFromCard, handleApplyProfile, onOpenBriefing, onHangUp, pipCards, noteTurn],
  );

  // The add-source agent turn: probe/trial/add tools, tool trace, confirm cards.
  // `seedStreaming` starts the streaming reply without a visible user message (the
  // onboarding opener); otherwise the caller already appended the user turn.
  async function runAgent(history: ChatMessage[], opts?: { seedStreaming?: boolean }) {
    if (opts?.seedStreaming) {
      setMessages((prev) => [...prev, { role: "ai", text: "", ts: Date.now(), streaming: true }]);
    }
    const settings = await loadSettings();
    if (!settings.defaultProviderId || !settings.defaultModelId) {
      patchLast({ text: "No AI provider configured (Settings).", failed: true, streaming: false });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    let full = "";
    // The briefing controller for generate_briefing: a background job through the
    // one card's lifecycle, answering with which of the three things happened —
    // a run started here, a run was already going here, or the request was left
    // for the machine that collects — so the companion reports the right one.
    const tools = buildLiveCompanionTools(
      insertProbeCard,
      insertProfileCard,
      { start: (scope) => runBriefingJob(scope) },
      { collecting },
    );

    void runAgentTurn({
      providerId: settings.defaultProviderId as "anthropic" | "openai" | "deepseek",
      modelId: settings.defaultModelId,
      systemPrompt: anchor.systemPrompt,
      messages: history,
      tools,
      reasoning: toReasoning(settings.chatThinking),
      signal: controller.signal,
      onDelta: (t) => {
        full += t;
        patchLast({ text: full, streaming: true });
      },
      onToolStart: (info) => {
        full = "";
        patchLast((m) => ({
          text: "",
          tools: appendRunningTool(m.tools, info.name, companionToolStatusLabel(info.name, info.args)),
        }));
      },
      onToolEnd: (info) =>
        patchLast((m) => ({
          tools: resolveToolStatus(m.tools, info.name, info.isError) ?? [...(m.tools ?? [])],
        })),
      onDone: (text) => {
        const finalText = text || full;
        patchLast((m) => ({ text: finalText, streaming: false, tools: (m.tools ?? []).filter((t) => t.state === "error") }));
        setStreaming(false);
        abortRef.current = null;
        if (finalText.trim()) appendMessage(bookId, anchor.threadId, { role: "ai", text: finalText, ts: Date.now() });
      },
      onError: (m) => {
        if (controller.signal.aborted) {
          patchLast({ streaming: false });
          if (full.trim()) appendMessage(bookId, anchor.threadId, { role: "ai", text: full, ts: Date.now() });
        } else {
          patchLast({ text: m || "The reply failed.", failed: true, streaming: false, tools: undefined });
        }
        setStreaming(false);
        abortRef.current = null;
      },
    });
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const now = Date.now();
    const userMsg: UiMessage = { role: "user", text, ts: now };
    const history: ChatMessage[] = [...messages, userMsg]
      .filter((m) => m.text.trim())
      .map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, userMsg, { role: "ai", text: "", ts: now + 1, streaming: true }]);
    appendMessage(bookId, anchor.threadId, { role: "user", text, ts: now });
    await runAgent(history);
  }

  function stop() {
    abortRef.current?.abort();
  }

  const { position } = anchor;
  const lastMessage = messages.length ? messages[messages.length - 1].text : null;

  if (layout === "chat-pip") {
    return (
      <div className="absolute right-3 top-3 z-50">
        <ChatPipCard lastMessage={lastMessage} onClick={() => setSwapped(false)} onHangUp={onHangUp} />
      </div>
    );
  }

  return (
    <>
      <div className="absolute inset-0 z-40">
        <CallView
          messages={messages}
          onSend={send}
          onHangUp={onHangUp}
          streaming={streaming}
          onStop={stop}
          emptyTitle={anchor.emptyTitle}
          placeholder={anchor.placeholder}
          voice={voice}
          onCardAction={onCardAction}
        />
      </div>
      {pipCards && (
        <div className="absolute right-3 top-3 z-50">
          <ReadingPipCard
            title={position.title}
            badge={
              position.sourceName ? (
                <Badge className="shrink-0">{position.sourceName}</Badge>
              ) : undefined
            }
            body={
              position.line ? (
                <span className="line-clamp-3 text-[12px] leading-snug text-neutral-500">{position.line}</span>
              ) : undefined
            }
            onClick={() => setSwapped(true)}
          />
        </div>
      )}
    </>
  );
}
