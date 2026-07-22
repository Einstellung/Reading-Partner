// The info call over the briefing / article (docs/16), on the call model (docs/03).
// It reuses the reader call's main-screen path (the top-bar AI button's
// "直接进主画面态,不经过气泡"): clicking "ask" opens the full chat window with the
// article/briefing shrunk to a corner position card. Tapping the card swaps
// (content main, chat becomes the corner pip); ✕ hangs up. No bubble, no
// auto-started take — the composer is ready and the user types.
//
// Two modes. "chat" (default): the briefing/article companion, a tool-less
// streamChat. "add-source" (docs/17): the add-source skill — an agent loop with
// probe/trial/add tools, inline confirm cards, and, on the first source added,
// a background first-briefing whose progress and readiness show as a card.

import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat } from "../ai/providers";
import { runAgentTurn } from "../ai/agent";
import { loadSettings, toReasoning } from "../settings";
import { appendMessage, createThread, getThread, loadThreads } from "../threads";
import { buildLiveSourceTools } from "../info/source-live";
import { sourceToolStatusLabel } from "../info/source-tools";
import { addSource, hasSources } from "../info/source-store";
import { getInfoPipeline } from "../info/live";
import CallView from "./CallView";
import ChatPipCard from "./ChatPipCard";
import ReadingPipCard from "./ReadingPipCard";
import { BriefingFailedCard, BriefingReadyCard, ProbeConfirmCard } from "./InfoCards";
import type { ComposerVoice } from "./chat";
import type { ChatMessage } from "../ai/providers";
import type { InfoPipeline } from "../info/pipeline";
import type { InfoCard, ProbeConfirmCardData } from "../info/cards";
import type { ThreadMessage as UiMessage } from "./types";

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
  // "add-source" wires the probe/trial/add tools + cards; default is the
  // tool-less briefing/article companion.
  mode?: "chat" | "add-source";
  // First-run onboarding: the AI opens the conversation itself.
  onboarding?: boolean;
}

function bookIdFor(dateKey: string): string {
  return `info-${dateKey}`;
}

const OPENING_KICKOFF = "(The user just opened onboarding — greet them and begin.)";

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
  const isAgent = anchor.mode === "add-source";

  // First-briefing tracking (add-source mode): the singleton pipeline, whether we
  // are waiting on a generation we kicked, and the ts of the status/card message.
  const pipelineRef = useRef<InfoPipeline | null>(null);
  const awaitingBriefing = useRef(false);
  const briefTsRef = useRef<number | null>(null);

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

  // Upsert a message identified by ts (the first-briefing status/card).
  const upsertByTs = useCallback((ts: number, patch: Partial<UiMessage>) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.ts === ts);
      if (i < 0) return [...prev, { role: "ai", text: "", ts, ...patch }];
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }, []);

  // Insert a card as its own row just before the currently streaming reply, so a
  // trial's confirm card appears above the AI's concluding text.
  const insertCardBeforeStreaming = useCallback((card: ProbeConfirmCardData) => {
    setMessages((prev) => {
      const row: UiMessage = { role: "ai", text: "", ts: Date.now(), card };
      if (!prev.length) return [row];
      const copy = [...prev];
      copy.splice(copy.length - 1, 0, row);
      return copy;
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
      setMessages(thread.messages.map((m) => ({ role: m.role, text: m.text, ts: m.ts })));
      // Onboarding: the AI opens the conversation itself when the thread is empty.
      // Gated on the on-disk thread being empty, so a reopened conversation never
      // re-greets.
      if (isAgent && anchor.onboarding && thread.messages.length === 0) {
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
  // pipeline's progress and drop in the ready/failed card when it finishes.
  useEffect(() => {
    if (!isAgent) return;
    const p = getInfoPipeline();
    pipelineRef.current = p;
    const unsub = p.subscribe(() => {
      if (!awaitingBriefing.current) return;
      const ts = briefTsRef.current;
      if (ts == null) return;
      const s = p.snapshot();
      if (s.running) {
        const label =
          s.phase === "fetching"
            ? "Building your first briefing — reading the sources"
            : "Building your first briefing — triaging";
        upsertByTs(ts, { tools: [{ name: "briefing", label, state: "running" }], card: undefined });
      } else {
        awaitingBriefing.current = false;
        if (s.briefing) {
          const b = s.briefing;
          upsertByTs(ts, {
            tools: undefined,
            card: {
              kind: "briefing-ready",
              date: b.date,
              worth: b.mustRead.length + b.outOfLane.length,
              oneLiners: b.oneLiners.length,
              filtered: b.filtered.length,
            },
          });
        } else {
          upsertByTs(ts, {
            tools: undefined,
            card: { kind: "briefing-failed", message: s.error || "The briefing could not be generated." },
          });
        }
      }
    });
    return unsub;
  }, [isAgent, upsertByTs]);

  function startFirstBriefing() {
    const p = pipelineRef.current;
    if (!p) return;
    awaitingBriefing.current = true;
    const ts = Date.now();
    briefTsRef.current = ts;
    upsertByTs(ts, {
      tools: [{ name: "briefing", label: "Building your first briefing — reading the sources", state: "running" }],
    });
    void p.generate();
  }

  // Add the trialed source when the user clicks the confirm card's button. This is
  // the local write path (not the AI's add_source); it also notes the add in the
  // thread so the AI knows, and starts the first briefing when it is the first.
  const handleAddFromCard = useCallback(
    async (card: ProbeConfirmCardData) => {
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
      setMessages((prev) =>
        prev.map((m) => (m.card === card ? { ...m, card: { ...card, added: true } } : m)),
      );
      onSourcesChanged?.();
      const note = `Added "${card.descriptor.name}" to my sources.`;
      const ts = Date.now();
      setMessages((prev) => [...prev, { role: "user", text: note, ts }]);
      appendMessage(bookId, anchor.threadId, { role: "user", text: note, ts });
      if (!had) startFirstBriefing();
    },
    [bookId, anchor.threadId, onSourcesChanged],
  );

  // Stable renderCard (memoized rows depend on its identity): dispatch through a
  // ref so the callback identity never changes across streaming deltas.
  const cardHandlers = useRef({
    add: (_c: ProbeConfirmCardData) => {},
    open: (_d: string) => {},
  });
  cardHandlers.current.add = (c) => void handleAddFromCard(c);
  cardHandlers.current.open = (date) => {
    onOpenBriefing?.(date);
    setView("chat-pip");
  };
  const renderCard = useCallback((card: InfoCard) => {
    switch (card.kind) {
      case "probe-confirm":
        return <ProbeConfirmCard card={card} onAdd={() => cardHandlers.current.add(card)} />;
      case "briefing-ready":
        return <BriefingReadyCard card={card} onOpen={() => cardHandlers.current.open(card.date)} />;
      case "briefing-failed":
        return <BriefingFailedCard card={card} />;
    }
  }, []);

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
    const tools = buildLiveSourceTools(insertCardBeforeStreaming);

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
            { name: info.name, label: sourceToolStatusLabel(info.name, info.args), state: "running" as const },
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

  // The tool-less briefing/article companion (unchanged behavior).
  async function runChat(history: ChatMessage[]) {
    const settings = await loadSettings();
    if (!settings.defaultProviderId || !settings.defaultModelId) {
      patchLast({ text: "No AI provider configured (Settings).", failed: true, streaming: false });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    let full = "";
    streamChat({
      providerId: settings.defaultProviderId as "anthropic" | "openai" | "deepseek",
      modelId: settings.defaultModelId,
      systemPrompt: anchor.systemPrompt,
      messages: history,
      signal: controller.signal,
      reasoning: toReasoning(settings.chatThinking),
      onDelta: (t) => {
        full += t;
        patchLast({ text: full, streaming: true });
      },
      onDone: (text) => {
        const finalText = text || full;
        patchLast({ text: finalText, streaming: false });
        setStreaming(false);
        abortRef.current = null;
        if (finalText.trim()) appendMessage(bookId, anchor.threadId, { role: "ai", text: finalText, ts: Date.now() });
      },
      onError: (m) => {
        if (controller.signal.aborted) {
          patchLast({ streaming: false });
          if (full.trim()) appendMessage(bookId, anchor.threadId, { role: "ai", text: full, ts: Date.now() });
        } else {
          patchLast({ text: m || "The reply failed.", failed: true, streaming: false });
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
    if (isAgent) await runAgent(history);
    else await runChat(history);
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
          renderCard={isAgent ? renderCard : undefined}
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
