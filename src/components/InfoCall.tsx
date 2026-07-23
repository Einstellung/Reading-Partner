// The info call over the briefing / article (docs/16), on the call model (docs/03).
// It reuses the reader call's main-screen path (the top-bar AI button's
// "直接进主画面态,不经过气泡"): clicking "ask" opens the full chat window with the
// article/briefing shrunk to a corner position card. Tapping the card swaps
// (content main, chat becomes the corner pip); ✕ hangs up. No bubble, no
// auto-started take — the composer is ready and the user types.
//
// Every info thread runs the same agent loop with the shared companion tool set
// (docs/16/17): probe/trial/add_source plus update_profile, surfacing inline
// confirm cards. The anchors differ only in context: the briefing/article
// companion, or the onboarding add-source flow (the AI opens, and on the first
// source added a background first-briefing shows its progress/readiness as a
// card). update_profile drafts a profile change the user Applies; applying it
// offers a re-triage of today's cached items through the same progress card.

import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentTurn } from "../ai/agent";
import { loadSettings, toReasoning } from "../settings";
import { appendMessage, createThread, getThread, loadThreads, patchThreadMessage } from "../threads";
import { buildLiveCompanionTools } from "../info/source-live";
import { companionToolStatusLabel } from "../info/companion-tools";
import { addSource, hasSources } from "../info/source-store";
import { saveProfile } from "../info/profile";
import { getInfoPipeline } from "../info/live";
import CallView from "./CallView";
import ChatPipCard from "./ChatPipCard";
import ReadingPipCard from "./ReadingPipCard";
import {
  cardRow,
  findCardPart,
  insertBeforeLast,
  nextCardId,
  patchCardPayload,
  rehydrateParts,
  toPersistedCardPart,
  upsertCardRow,
  type CardAction,
} from "./chatParts";
import type { ComposerVoice } from "./chat";
import type { ChatMessage } from "../ai/providers";
import type { InfoPipeline } from "../info/pipeline";
import type { ProbeConfirmCardData, ProfileUpdateCardData } from "../info/cards";
import type { ThreadMessage as UiMessage } from "./types";
import type { ThreadMessage as StoredMessage } from "../threads";

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

function bookIdFor(dateKey: string): string {
  return `info-${dateKey}`;
}

const OPENING_KICKOFF = "(The user just opened onboarding — greet them and begin.)";

// The one first-briefing card's stable id: the progress card, then in place the
// ready or failed card, all address this id through upsertCardRow.
const BRIEFING_CARD_ID = "briefing";

// Persisted thread message -> live UI message on reopen. A stored card message
// rehydrates its parts (re-rendered through the registry by kind); an old plain
// message (no parts) stays text-only.
function rehydrateUiMessage(m: StoredMessage): UiMessage {
  if (m.parts && m.parts.length) {
    return { role: m.role, text: m.text, ts: m.ts, parts: rehydrateParts(m.parts) };
  }
  return { role: m.role, text: m.text, ts: m.ts };
}

export function InfoCall({
  anchor,
  dateKey,
  onHangUp,
  voice,
  onSourcesChanged,
  onOpenBriefing,
}: {
  anchor: InfoCallAnchor;
  dateKey: string;
  onHangUp: () => void;
  voice?: ComposerVoice | false;
  // Called after the source list changes (add), so the host refreshes hasSources.
  onSourcesChanged?: () => void;
  // Clicking the briefing-ready card: open the briefing as the main screen.
  onOpenBriefing?: (date: string) => void;
}) {
  const [view, setView] = useState<"chat-main" | "chat-pip">("chat-main");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bookId = bookIdFor(dateKey);

  // Latest messages, mirrored to a ref so the (id-keyed) card dispatcher can look
  // up a card's payload without being torn down and rebuilt on every delta.
  const messagesRef = useRef<UiMessage[]>(messages);
  messagesRef.current = messages;

  // First-briefing tracking (add-source mode): the singleton pipeline and whether
  // we are waiting on a generation we kicked. The progress -> ready/failed card
  // rides a single stable card id, so no per-run ts bookkeeping is needed.
  const pipelineRef = useRef<InfoPipeline | null>(null);
  const awaitingBriefing = useRef(false);
  // Which briefing job the progress/ready/failed card is tracking, so the ready
  // copy and the failed-card retry both address the right run.
  const lastJobRef = useRef<"first" | "retriage">("first");

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

  // Load (or start) the anchor's thread whenever it changes; open the chat
  // window. In onboarding, kick the AI's opening turn once the empty thread loads.
  useEffect(() => {
    let live = true;
    setView("chat-main");
    (async () => {
      try {
        await loadThreads(bookId);
      } catch {
        // A missing/corrupt thread file starts an empty conversation.
      }
      if (!live) return;
      let thread = getThread(bookId, anchor.threadId);
      if (!thread) thread = createThread(bookId, "info", anchor.threadId);
      setMessages(thread.messages.map(rehydrateUiMessage));
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

  // First-briefing generation status (add-source mode): reflect the singleton
  // pipeline's progress and drop in the ready/failed card when it finishes. The
  // one briefing card is addressed by BRIEFING_CARD_ID through the patchPart
  // channel (upsertCardRow) across its whole progress -> ready/failed lifecycle.
  useEffect(() => {
    const p = getInfoPipeline();
    pipelineRef.current = p;
    const unsub = p.subscribe(() => {
      if (!awaitingBriefing.current) return;
      const s = p.snapshot();
      const isRetriage = lastJobRef.current === "retriage";
      if (s.running) {
        setMessages((prev) =>
          upsertCardRow(prev, BRIEFING_CARD_ID, {
            kind: "briefing-progress",
            phase: s.phase === "fetching" ? "fetching" : "triaging",
            collect: s.collect,
            triage: s.activity
              ? {
                  startedAt: s.activity.startedAt,
                  chars: s.activity.chars,
                  attempt: s.activity.attempt,
                  attempts: s.activity.attempts,
                }
              : null,
            title: isRetriage ? "Re-running today's triage" : undefined,
          }),
        );
      } else {
        awaitingBriefing.current = false;
        if (s.briefing) {
          const b = s.briefing;
          const ready = {
            kind: "briefing-ready" as const,
            date: b.date,
            worth: b.mustRead.length + b.outOfLane.length,
            oneLiners: b.oneLiners.length,
            filtered: b.filtered.length,
            title: isRetriage ? "Briefing updated" : undefined,
            note: isRetriage ? "Re-triaged today's items with your updated profile." : undefined,
          };
          setMessages((prev) => upsertCardRow(prev, BRIEFING_CARD_ID, ready));
          // Ready is a durable outcome: persist it so a reopen shows the briefing
          // exists (the progress card it replaced was never persisted).
          appendMessage(bookId, anchor.threadId, {
            role: "ai",
            text: "",
            ts: Date.now(),
            parts: [toPersistedCardPart(BRIEFING_CARD_ID, ready)],
          });
        } else {
          // Failure is in-session only (retry needs the live pipeline); not persisted.
          setMessages((prev) =>
            upsertCardRow(prev, BRIEFING_CARD_ID, {
              kind: "briefing-failed",
              message: s.error || "The briefing could not be generated.",
            }),
          );
        }
      }
    });
    return unsub;
  }, [bookId, anchor.threadId]);

  // Start (or retry) a briefing job through the one BRIEFING_CARD_ID card: "first"
  // collects + triages (onboarding); "retriage" re-triages today's cached items
  // with the applied profile (no collection). Retry reuses the same card row so
  // progress/error updates in place rather than appending a new row.
  function runBriefingJob(job: "first" | "retriage") {
    const p = pipelineRef.current ?? getInfoPipeline();
    pipelineRef.current = p;
    lastJobRef.current = job;
    awaitingBriefing.current = true;
    setMessages((prev) =>
      upsertCardRow(prev, BRIEFING_CARD_ID, {
        kind: "briefing-progress",
        phase: job === "retriage" ? "triaging" : "fetching",
        collect: null,
        triage: null,
        title: job === "retriage" ? "Re-running today's triage" : undefined,
      }),
    );
    if (job === "retriage") void p.retriage();
    else void p.generate();
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
      const note = `Added "${card.descriptor.name}" to my sources.`;
      const ts = Date.now();
      setMessages((prev) => [...prev, { role: "user", text: note, ts }]);
      appendMessage(bookId, anchor.threadId, { role: "user", text: note, ts });
      if (!had) runBriefingJob("first");
    },
    // runBriefingJob reads only refs, so its per-render identity is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId, anchor.threadId, onSourcesChanged],
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
        await saveProfile(card.profile);
      } catch {
        return;
      }
      const canRetriage = !!getInfoPipeline().snapshot().briefing;
      const applied: ProfileUpdateCardData = { ...card, phase: "applied", canRetriage };
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied", canRetriage }));
      patchThreadMessage(bookId, anchor.threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, applied)],
      });
      const note = `Applied the profile update: ${card.summary}.`;
      const ts = Date.now();
      setMessages((prev) => [...prev, { role: "user", text: note, ts }]);
      appendMessage(bookId, anchor.threadId, { role: "user", text: note, ts });
    },
    [bookId, anchor.threadId],
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
            setView("chat-pip");
          }
          break;
        case "local":
          setMessages((prev) => patchCardPayload(prev, cardId, action.patch));
          break;
        case "reply": {
          const role = action.role ?? "user";
          const ts = Date.now();
          setMessages((prev) => [...prev, { role, text: action.text, ts }]);
          appendMessage(bookId, anchor.threadId, { role, text: action.text, ts });
          break;
        }
        case "resolve":
          // Reserved for future human-in-the-loop cards; no card dispatches it yet.
          break;
      }
    },
    // handleAddFromCard/handleApplyProfile are stable; runBriefingJob reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleAddFromCard, handleApplyProfile, onOpenBriefing, bookId, anchor.threadId],
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
    const tools = buildLiveCompanionTools(insertProbeCard, insertProfileCard);

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
          tools: [
            ...(m.tools ?? []),
            { name: info.name, label: companionToolStatusLabel(info.name, info.args), state: "running" as const },
          ],
        }));
      },
      onToolEnd: (info) =>
        patchLast((m) => {
          const tl = [...(m.tools ?? [])];
          let idx = -1;
          for (let i = 0; i < tl.length; i++) {
            if (tl[i].state === "running" && tl[i].name === info.name) idx = i;
          }
          if (idx < 0) return { tools: tl };
          if (info.isError) tl[idx] = { ...tl[idx], state: "error" };
          else tl.splice(idx, 1);
          return { tools: tl };
        }),
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

  if (view === "chat-pip") {
    return (
      <div className="absolute right-3 top-3 z-50">
        <ChatPipCard lastMessage={lastMessage} onClick={() => setView("chat-main")} onHangUp={onHangUp} />
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
      <div className="absolute right-3 top-3 z-50">
        <ReadingPipCard
          title={position.title}
          badge={
            position.sourceName ? (
              <span className="shrink-0 rounded-full bg-[#f0eefb] px-2 py-0.5 text-[11px] font-medium text-[#6d5ae0]">
                {position.sourceName}
              </span>
            ) : undefined
          }
          body={
            position.line ? (
              <span className="line-clamp-3 text-[12px] leading-snug text-neutral-500">{position.line}</span>
            ) : undefined
          }
          onClick={() => setView("chat-pip")}
        />
      </div>
    </>
  );
}
