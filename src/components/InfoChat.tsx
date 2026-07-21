// Floating chat over the briefing / article (docs/16). Collapsed it is a small
// pill; expanded it is a chat panel. Anchored per item: the host supplies the
// thread id, a title, and the system prompt (article full text + overview, or
// the whole briefing). Reuses the shared MessageList/Composer and streamChat;
// threads persist under a pseudo-book id "info-<date>" so a day's chats survive
// a reopen and ride the normal thread sync.

import { useEffect, useRef, useState } from "react";
import { streamChat } from "../ai/providers";
import { loadSettings, toReasoning } from "../settings";
import {
  appendMessage,
  createThread,
  getThread,
  loadThreads,
} from "../threads";
import { Composer, MessageList } from "./chat";
import { IconClose, IconSparkle } from "./icons";
import type { ChatMessage } from "../ai/providers";
import type { ThreadMessage as UiMessage } from "./types";

export interface InfoChatAnchor {
  threadId: string;
  title: string;
  systemPrompt: string;
}

function bookIdFor(dateKey: string): string {
  return `info-${dateKey}`;
}

export function InfoChat({
  anchor,
  dateKey,
  configured,
  onClose,
  onOpenSettings,
}: {
  anchor: InfoChatAnchor;
  dateKey: string;
  configured: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bookId = bookIdFor(dateKey);

  // Load (or start) the anchor's thread whenever the anchor changes. A new
  // anchor opens expanded.
  useEffect(() => {
    let live = true;
    setExpanded(true);
    (async () => {
      try {
        await loadThreads(bookId);
      } catch {
        // A missing/corrupt thread file starts an empty conversation.
      }
      if (!live) return;
      let thread = getThread(bookId, anchor.threadId);
      if (!thread) thread = createThread(bookId, "info", anchor.threadId);
      setMessages(
        thread.messages.map((m) => ({ role: m.role, text: m.text, ts: m.ts })),
      );
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

  if (!expanded) {
    return (
      <button
        className="fixed bottom-5 right-5 z-[900] flex items-center gap-2 rounded-full border border-[#c9c2e8] bg-[#efecfb] px-4 py-2.5 text-[13px] font-medium text-[#4a3a9e] shadow-lg hover:bg-[#e7e3f7]"
        onClick={() => setExpanded(true)}
      >
        <IconSparkle size={16} /> Chat
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[900] flex h-[70vh] max-h-[640px] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_12px_48px_rgba(0,0,0,0.22)]">
      <div className="flex items-center gap-2 border-b border-[#eee] px-4 py-2.5">
        <IconSparkle size={16} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#333]">{anchor.title}</span>
        <button
          aria-label="Collapse"
          title="Collapse"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#999] hover:bg-[#f2f2f2]"
          onClick={() => setExpanded(false)}
        >
          –
        </button>
        <button
          aria-label="Close chat"
          title="Close"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#999] hover:bg-[#f2f2f2]"
          onClick={onClose}
        >
          <IconClose size={14} />
        </button>
      </div>

      {messages.length === 0 && (
        <div className="px-4 pt-4 text-[13px] text-[#999]">Ask anything about this.</div>
      )}
      <MessageList messages={messages} size="sm" className="flex-1 px-4 py-3" />

      <div className="border-t border-[#eee] p-3">
        {configured ? (
          <Composer
            onSend={send}
            placeholder="Ask…"
            pill
            streaming={streaming}
            onStop={stop}
          />
        ) : (
          <button
            className="w-full rounded-lg border border-[#dcdcdc] px-3 py-2 text-[13px] text-[#555] hover:bg-[#f4f4f4]"
            onClick={onOpenSettings}
          >
            Configure a provider in Settings to chat
          </button>
        )}
      </div>
    </div>
  );
}
