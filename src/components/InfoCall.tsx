// The info call over the briefing / article (docs/16), on the call model (docs/03).
// It reuses the reader call's main-screen path (the top-bar AI button's
// "直接进主画面态,不经过气泡"): clicking "ask" opens the full chat window with the
// article/briefing shrunk to a corner position card. Tapping the card swaps
// (content main, chat becomes the corner pip); ✕ hangs up. No bubble, no
// auto-started take — the composer is ready and the user types.
//
// Context comes from the host (article full text + overview, or the whole
// briefing); the AI call reuses streamChat. Threads persist under a pseudo-book
// id "info-<date>" so a day's chats survive a reopen and ride the normal thread
// sync.

import { useEffect, useRef, useState } from "react";
import { streamChat } from "../ai/providers";
import { loadSettings, toReasoning } from "../settings";
import { appendMessage, createThread, getThread, loadThreads } from "../threads";
import CallView from "./CallView";
import ChatPipCard from "./ChatPipCard";
import ReadingPipCard from "./ReadingPipCard";
import type { ChatMessage } from "../ai/providers";
import type { InfoSource } from "../info/types";
import type { ThreadMessage as UiMessage } from "./types";

const SOURCE_TAG: Record<InfoSource, string> = {
  jiqizhixin: "机器之心",
  qbitai: "量子位",
};

export interface InfoCallAnchor {
  // "briefing" for the briefing-level thread, or the item id for an article.
  threadId: string;
  // The chat window's empty-state heading and composer placeholder.
  emptyTitle: string;
  placeholder: string;
  systemPrompt: string;
  // The corner position card: the article/briefing shrunk to a title, an
  // optional source tag, and a one-line reason/overview.
  position: { title: string; source?: InfoSource; line: string | null };
}

function bookIdFor(dateKey: string): string {
  return `info-${dateKey}`;
}

export function InfoCall({
  anchor,
  dateKey,
  onHangUp,
}: {
  anchor: InfoCallAnchor;
  dateKey: string;
  onHangUp: () => void;
}) {
  // Two of the three call views (docs/03): the chat window main-screen, and the
  // corner chat pip when the briefing/article is main. No bubble (the info entry
  // goes straight to main, like the reader's top-bar AI button).
  const [view, setView] = useState<"chat-main" | "chat-pip">("chat-main");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bookId = bookIdFor(dateKey);

  // Load (or start) the anchor's thread whenever the anchor changes. A new
  // anchor opens the chat window.
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
    })();
    return () => {
      live = false;
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
    };
  }, [bookId, anchor.threadId]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const now = Date.now();
    const userMsg: UiMessage = { role: "user", text, ts: now };
    // History for the model is the visible turns plus this one.
    const history: ChatMessage[] = [...messages, userMsg].map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, userMsg, { role: "ai", text: "", ts: now + 1, streaming: true }]);
    appendMessage(bookId, anchor.threadId, { role: "user", text, ts: now });

    const settings = await loadSettings();
    if (!settings.defaultProviderId || !settings.defaultModelId) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "ai", text: "No AI provider configured (Settings).", ts: now + 1, failed: true };
        return next;
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    let full = "";
    const setLast = (patch: Partial<UiMessage>) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    streamChat({
      providerId: settings.defaultProviderId as "anthropic" | "openai" | "deepseek",
      modelId: settings.defaultModelId,
      systemPrompt: anchor.systemPrompt,
      messages: history,
      signal: controller.signal,
      reasoning: toReasoning(settings.chatThinking),
      onDelta: (t) => {
        full += t;
        setLast({ text: full, streaming: true });
      },
      onDone: (text) => {
        const finalText = text || full;
        setLast({ text: finalText, streaming: false });
        setStreaming(false);
        abortRef.current = null;
        if (finalText.trim()) appendMessage(bookId, anchor.threadId, { role: "ai", text: finalText, ts: Date.now() });
      },
      onError: (m) => {
        // A user stop keeps the partial reply; a real error is a muted notice.
        if (controller.signal.aborted) {
          setLast({ streaming: false });
          if (full.trim()) appendMessage(bookId, anchor.threadId, { role: "ai", text: full, ts: Date.now() });
        } else {
          setLast({ text: m || "The reply failed.", failed: true, streaming: false });
        }
        setStreaming(false);
        abortRef.current = null;
      },
    });
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
        />
      </div>
      <div className="absolute right-3 top-3 z-50">
        <ReadingPipCard
          title={position.title}
          badge={
            position.source ? (
              <span className="shrink-0 rounded-full bg-[#f0eefb] px-2 py-0.5 text-[11px] font-medium text-[#6d5ae0]">
                {SOURCE_TAG[position.source]}
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
