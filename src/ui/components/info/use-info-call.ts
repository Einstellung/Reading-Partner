// The info call's live state (docs/16, docs/17): the anchor's thread, the turn
// currently streaming, the briefing job the one card is tracking, and what each
// card gesture fans out to.
//
// It sits in the ui layer rather than in info/companion because it is where the
// domain meets the chat rendering (chatParts): a card is both a payload the
// tools produced and a row in the conversation, and one of those two is a render
// concern. Everything decidable without React — which card a start attempt draws
// (companion/call.ts), what an Add or an Apply does in what order
// (companion/card-actions.ts) — is in the domain and tested there; what is left
// here is wiring and the effects it drives.

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
  askScope,
  askSentNote,
  briefingJobPlan,
  briefingJobUpdate,
  infoBookId,
  profileAppliedNote,
  sourceAddedNote,
  type BriefingJob,
} from "../../../info/companion/call";
import { addSourceFromCard, applyProfileUpdate } from "../../../info/companion/card-actions";
import type { InfoCallAnchor } from "../../../info/companion/anchors";
import { addSource, hasSources } from "../../../info/sources/source-store";
import { appendRunningTool, resolveToolStatus } from "../../../ai/tool-status";
import { navigateAway } from "../chat/call-layout";
import { refusalRow, replayableHistory } from "../../../ai/turn-rows";
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
import type { ChatMessage } from "../../../ai/providers";
import type { BriefingView, RequestOutcome } from "../../../info/briefing/reader";
import type { ProfileUpdateCardData } from "../../../info/briefing/cards";
import type { ProbeConfirmCardData } from "../../../info/sources/source-cards";
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
  onOpenBriefing?: (date: string) => void;
}

export interface InfoCallController {
  messages: UiMessage[];
  streaming: boolean;
  // Whether the reader has tapped the call out of the way.
  swapped: boolean;
  setSwapped: (swapped: boolean) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  onCardAction: (cardId: string, action: CardAction) => void;
}

export function useInfoCall(opts: InfoCallOptions): InfoCallController {
  const { anchor, dateKey, view, collecting, pipCards, onHangUp, onSourcesChanged, onOpenBriefing } = opts;
  const [swapped, setSwapped] = useState(false);
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
  // the note the outcome injects, and whether either is durable is decided in
  // info/companion/call.
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

  // Insert a card as its own row just before the streaming reply, and persist it
  // — probe-confirm and profile-update are both durable. The tools hand back a
  // structured payload; this closure is the one place that turns a payload into a
  // card part.
  function insertCard(prefix: string, payload: ProbeConfirmCardData | ProfileUpdateCardData) {
    const cardId = nextCardId(prefix);
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
  // reply (note the add in the thread so the AI knows). The order and the guards
  // are in info/companion/card-actions.
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

  // Apply a drafted profile change when the user clicks a card's Apply: save the
  // new profile, flip the card to its applied state (in the UI and on disk), and
  // note the change so the AI knows. The applied card then offers a re-triage
  // where one can be run. Apply is the only write — the tool never saves.
  const handleApplyProfile = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "profile-update") return;
      const card = found.payload;
      if (card.phase === "applied") return;
      const { ok, canRetriage } = await applyProfileUpdate(card.profile, {
        collecting,
        hasBriefing: !!view.snapshot().briefing,
      });
      if (!ok) return;
      const applied: ProfileUpdateCardData = { ...card, phase: "applied", canRetriage };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied", canRetriage }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      noteTurn(profileAppliedNote(card));
    },
    [bookId, anchor.threadId, noteTurn, collecting, view],
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

  // The companion's agent turn: probe/trial/add tools, tool trace, confirm cards.
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
    // The briefing controller for generate_briefing: a background job through the
    // one card's lifecycle, answering with which of the three things happened —
    // a run started here, a run was already going here, or the request was left
    // for the machine that collects — so the companion reports the right one.
    //
    // Built before the turn is marked streaming: it awaits the readable
    // extractor's chunk, and a failure there has to land where a failed
    // loadSettings() lands rather than leaving the chat stuck mid-send.
    const tools = await buildLiveCompanionTools(
      (payload) => insertCard("probe", payload),
      (payload) => insertCard("profile", payload),
      { start: (scope) => runBriefingJob(scope) },
      { collecting },
    );
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    let full = "";

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
      // The loop declined mid-turn rather than failing to reach the model. It is
      // not an error and there is nothing to retry, so it is not dressed as one
      // (turn-rows.ts; App and useTalk pass this too).
      onRefusal: (m) => {
        patchLast((prev) => refusalRow(prev, m));
        setStreaming(false);
        abortRef.current = null;
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
    const history: ChatMessage[] = replayableHistory([...messages, userMsg]);
    setMessages((prev) => [...prev, userMsg, { role: "ai", text: "", ts: now + 1, streaming: true }]);
    appendMessage(bookId, anchor.threadId, { role: "user", text, ts: now });
    await runAgent(history);
  }

  function stop() {
    abortRef.current?.abort();
  }

  return { messages, streaming, swapped, setSwapped, send, stop, onCardAction };
}
