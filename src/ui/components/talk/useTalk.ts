// The open talk's live state: its file, its materials, its conversation and the
// turn currently streaming (docs/31).
//
// It sits in the ui layer rather than in reading/talks because it is where the
// domain meets the chat rendering (chatParts): the decision the AI records is
// both a write to the talk file and a card in the conversation, and one of those
// two is a render concern. Everything decidable without React — the outline
// operations, the turn assembly, the list rows — is in the domain and tested
// there; what is left here is wiring.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendMessage,
  createThread,
  getThread,
  loadThreads,
  type ThreadMessage as StoredMessage,
} from "../../../platform/app/threads";
import { loadSettings, toReasoning, type Settings } from "../../../platform/app/settings";
import { runAgentTurn, type ProviderId } from "../../../ai/aiClient";
import { toolStatusLabel } from "../../../reading/context";
import type { RehearsalDecisionCardData } from "../../../reading/rehearsal";
import {
  buildTalkTurn,
  loadMaterials,
  loadTalk,
  moveDecision,
  recordTalkDecision,
  removeDecision,
  setIncluded,
  talkThreadKey,
  updateTalk,
  type LoadedMaterial,
  type Talk,
} from "../../../reading/talks";
import { distillRehearsal } from "../../../observation";
import { appendRunningTool, resolveToolStatus } from "../common/toolTrace";
import type { ThreadMessage } from "../common/types";
import {
  cardRow,
  insertBeforeLast,
  nextCardId,
  rehydrateParts,
  toPersistedCardPart,
} from "../chat/chatParts";

// A talk has exactly one conversation, so the thread id is the talk id. Nothing
// has to be looked up, and a thread file with a second thread in it could only
// come from a hand edit.
function threadIdOf(talkId: string): string {
  return talkId;
}

function toDisplay(msgs: StoredMessage[]): ThreadMessage[] {
  return msgs.map((m) => ({
    role: m.role,
    text: m.text,
    ts: m.ts,
    ...(m.parts && m.parts.length ? { parts: rehydrateParts(m.parts) } : {}),
  }));
}

export interface TalkController {
  talk: Talk | null;
  materials: LoadedMaterial[];
  messages: ThreadMessage[];
  loading: boolean;
  streaming: boolean;
  // A failure the reader has to see: no provider configured, a turn that could
  // not be assembled, a talk file that has gone.
  error: string | null;
  send(text: string): void;
  stop(): void;
  // Outline edits. Each one writes the talk file and is reflected immediately.
  moveEntry(index: number, delta: number): void;
  cutEntry(bookId: string, chapter: number, include: boolean): void;
  removeEntry(bookId: string, chapter: number): void;
  rename(name: string): void;
}

export function useTalk(talkId: string, topicName: string): TalkController {
  const [talk, setTalk] = useState<Talk | null>(null);
  const [materials, setMaterials] = useState<LoadedMaterial[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read by the stable turn callback, so a reply in flight always writes against
  // the talk as it is now rather than as it was when the turn started.
  const talkRef = useRef<Talk | null>(null);
  const materialsRef = useRef<LoadedMaterial[]>([]);
  const settingsRef = useRef<Settings | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const partialRef = useRef<{ ts: number; text: string } | null>(null);

  useEffect(() => {
    talkRef.current = talk;
  }, [talk]);
  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

  const key = talkThreadKey(talkId);
  const threadId = threadIdOf(talkId);

  // Read by the exit capture, which must not be rebuilt when the topic is
  // renamed: it is a dependency of the effect that opens the talk.
  const topicNameRef = useRef(topicName);
  useEffect(() => {
    topicNameRef.current = topicName;
  }, [topicName]);

  // Work handed to the moment the turn in flight lands (the counterpart of
  // liveTurns.whenSettled in the reader). Only the exit capture uses it.
  const onSettledRef = useRef<(() => void) | null>(null);
  const settleExit = useCallback(() => {
    const pending = onSettledRef.current;
    onSettledRef.current = null;
    pending?.();
  }, []);

  // Leaving the talk is this conversation's hangup (docs/31: the rehearsal is
  // the most worth observing stretch of conversation there is, and it had no
  // distillation at all). Every way out of a talk — the Back button, switching
  // topic, opening a book, moving to another home screen — unmounts this hook,
  // so the one place that covers all of them is the cleanup below.
  //
  // Returns true when the pass was handed to a turn still streaming instead of
  // being run now: half a sentence is not what the reader said, and summarising
  // it would put a judgement about them on record over an answer they had not
  // finished giving. A deferred pass is also why the turn is then left running
  // rather than aborted — it has to land for there to be anything to read.
  //
  // A rehearsal the reader never spoke in is not deferred and not distilled: an
  // opening question with no answer under it holds nothing that cannot be
  // re-derived, and leaving it alone keeps a talk opened and closed at once from
  // costing a model call.
  const captureExit = useCallback((): boolean => {
    const current = talkRef.current;
    if (!current) return false;
    const stored = getThread(key, threadId)?.messages ?? [];
    const spoken = stored.filter((m) => m.text.trim() !== "");
    if (!spoken.some((m) => m.role === "user")) return false;
    const run = () =>
      void distillRehearsal({
        topicId: current.topicId,
        topicName: topicNameRef.current,
        talkId: current.id,
        talkName: current.name,
        materials: current.materials.map((m) => m.title),
        threadId,
        // Read at the moment the pass starts, not now: a deferred pass runs
        // after the reply has been appended, and that reply is part of the
        // stretch being distilled.
        messages: (getThread(key, threadId)?.messages ?? [])
          .filter((m) => m.text.trim() !== "")
          .map(({ role, text, ts }) => ({ role, text, ts })),
      });
    if (abortRef.current) {
      onSettledRef.current = run;
      return true;
    }
    run();
    return false;
  }, [key, threadId]);

  // Open the talk: its file, its materials, its conversation. Runs once per
  // talk; leaving the view unmounts the hook, distils what was said and stops
  // any turn that is not owed to the distillation.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const loaded = await loadTalk(talkId);
      if (cancelled) return;
      if (!loaded) {
        setError("This talk could not be read.");
        setLoading(false);
        return;
      }
      setTalk(loaded);
      talkRef.current = loaded;
      settingsRef.current = await loadSettings().catch(() => null);
      const [mats] = await Promise.all([
        loadMaterials(loaded.materials),
        loadThreads(key).catch(() => ({})),
      ]);
      if (cancelled) return;
      setMaterials(mats);
      materialsRef.current = mats;
      const thread = getThread(key, threadId) ?? createThread(key, "", threadId);
      setMessages(toDisplay(thread.messages));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      // The distillation first: it decides whether the turn in flight is still
      // wanted. Aborting one it is waiting for would leave the pass hanging on a
      // reply that is never coming.
      if (captureExit()) return;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [talkId, key, threadId, captureExit]);

  const patchRow = useCallback((ts: number, fn: (m: ThreadMessage) => ThreadMessage) => {
    setMessages((rows) => rows.map((m) => (m.ts === ts && m.role === "ai" ? fn(m) : m)));
  }, []);

  // One turn. Assembles from the talk as it stands, streams into the last row,
  // persists on done. A decision recorded mid-turn writes the file and drops a
  // card in above the reply being written.
  const runTurn = useCallback(() => {
    const current = talkRef.current;
    const s = settingsRef.current;
    if (!current) return;
    if (!s?.defaultProviderId || !s?.defaultModelId) {
      setError("Configure a provider in Settings to start the rehearsal.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const ts = Date.now();
    partialRef.current = { ts, text: "" };
    setError(null);
    setStreaming(true);
    setMessages((rows) => [
      ...rows.filter((m) => !(m.role === "ai" && (m.failed || m.streaming))),
      { role: "ai", text: "", ts, streaming: true },
    ]);

    const finish = () => {
      if (abortRef.current === controller) abortRef.current = null;
      partialRef.current = null;
      setStreaming(false);
    };

    const fail = (text: string) => {
      finish();
      patchRow(ts, () => ({ role: "ai", text, ts, failed: true }));
      // The turn is over, however it ended. A distillation waiting on it takes
      // the conversation as it stands: the reader's half is on disk either way,
      // and a failed reply is no reason to lose what they said.
      settleExit();
    };

    const onDecisionCard = (payload: RehearsalDecisionCardData) => {
      const cardId = nextCardId("rehearsal");
      const cardTs = Date.now();
      setMessages((rows) => insertBeforeLast(rows, cardRow(cardId, payload, cardTs)));
      appendMessage(key, threadId, {
        role: "ai",
        text: "",
        ts: cardTs,
        parts: [toPersistedCardPart(cardId, payload)],
      });
    };

    void (async () => {
      const turn = await buildTalkTurn({
        talk: talkRef.current ?? current,
        materials: materialsRef.current,
        topicName,
        settings: s,
        // The card rows are persisted with no text of their own (the payload is
        // in `parts`), and an empty message is one some providers reject
        // outright. What the decision cards say is in the record the prompt
        // carries anyway, so they are left out of the replay.
        history: (getThread(key, threadId)?.messages ?? [])
          .filter((m) => m.text.trim() !== "")
          .map((m) => ({ role: m.role, text: m.text })),
        record: async (decision) => {
          const next = await recordTalkDecision(talkId, decision);
          if (next) {
            talkRef.current = next;
            setTalk(next);
          }
        },
        // The ref, not the snapshot the turn was assembled from: read_talk_outline
        // has to answer with the entry recorded a moment ago in this same turn,
        // and with the one the reader just moved in the outline pane.
        readTalk: () => talkRef.current,
        onDecisionCard,
      });
      if (controller.signal.aborted) return;
      // Declined before sending: the same inputs assemble the same call, so
      // there is nothing a second press would change (docs/pitfall/65).
      if (turn.refusal) {
        fail(turn.refusal);
        return;
      }
      void runAgentTurn({
        providerId: s.defaultProviderId as ProviderId,
        modelId: s.defaultModelId as string,
        systemPrompt: turn.systemPrompt,
        messages: turn.messages,
        tools: turn.tools,
        signal: controller.signal,
        reasoning: toReasoning(s.chatThinking),
        onDelta: (chunk) => {
          const p = partialRef.current;
          if (p) p.text += chunk;
          patchRow(ts, (m) => ({ ...m, text: m.text + chunk }));
        },
        onToolStart: (info) =>
          patchRow(ts, (m) => ({
            ...m,
            text: "",
            tools: appendRunningTool(m.tools, info.name, toolStatusLabel(info.name, info.args)),
          })),
        onToolEnd: (info) =>
          patchRow(ts, (m) => {
            const tools = resolveToolStatus(m.tools, info.name, info.isError);
            return tools ? { ...m, tools } : m;
          }),
        onDone: (full) => {
          if (controller.signal.aborted) return; // stop() already kept the partial
          finish();
          patchRow(ts, (m) => ({
            role: "ai",
            text: full,
            ts,
            tools: (m.tools ?? []).filter((t) => t.state === "error"),
            ...(turn.notice ? { notice: turn.notice } : {}),
          }));
          appendMessage(key, threadId, { role: "ai", text: full, ts });
          // After the append, never before: a distillation deferred by an exit
          // mid-answer reads the thread file, which only now holds the reply.
          settleExit();
        },
        onError: (message) => fail(`⚠️ Couldn't reach the model. ${message}`),
        onRefusal: (message) => fail(message),
      });
    })();
  }, [talkId, key, threadId, topicName, patchRow, settleExit]);

  // A talk opened with nothing in it starts itself: stage one of the rehearsal is
  // the AI laying out the skeleton and asking which thread the talk should
  // follow (docs/31), and making the reader type "go on" first would be a step
  // that says nothing. Once per talk — reopening a talk with history does not
  // fire another turn.
  const startedRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !talk || error) return;
    if (messages.length > 0 || startedRef.current === talk.id) return;
    startedRef.current = talk.id;
    runTurn();
  }, [loading, talk, error, messages.length, runTurn]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const ts = Date.now();
      appendMessage(key, threadId, { role: "user", text: trimmed, ts });
      setMessages((rows) => [...rows, { role: "user", text: trimmed, ts }]);
      runTurn();
    },
    [key, threadId, runTurn],
  );

  // Stop keeps the half sentence: the abort silences the agent, so persisting it
  // here is the only way it survives.
  const stop = useCallback(() => {
    const controller = abortRef.current;
    const partial = partialRef.current;
    if (!controller) return;
    controller.abort();
    abortRef.current = null;
    setStreaming(false);
    const text = (partial?.text ?? "").trim();
    if (partial && text) {
      appendMessage(key, threadId, { role: "ai", text, ts: partial.ts });
      patchRow(partial.ts, () => ({ role: "ai", text, ts: partial.ts }));
    } else if (partial) {
      setMessages((rows) => rows.filter((m) => !(m.ts === partial.ts && m.role === "ai")));
    }
    partialRef.current = null;
  }, [key, threadId, patchRow]);

  // The outline edits. Each writes the file and takes what came back, so what is
  // on screen is what a reload would show.
  const edit = useCallback(
    (patch: (talk: Talk) => Talk) => {
      void (async () => {
        const next = await updateTalk(talkId, patch);
        if (next) {
          talkRef.current = next;
          setTalk(next);
        }
      })();
    },
    [talkId],
  );

  const moveEntry = useCallback(
    (index: number, delta: number) =>
      edit((t) => ({ ...t, decisions: moveDecision(t.decisions, index, delta) })),
    [edit],
  );
  const cutEntry = useCallback(
    (bookId: string, chapter: number, include: boolean) =>
      edit((t) => ({
        ...t,
        decisions: setIncluded(t.decisions, bookId, chapter, include, Date.now()),
      })),
    [edit],
  );
  const removeEntry = useCallback(
    (bookId: string, chapter: number) =>
      edit((t) => ({ ...t, decisions: removeDecision(t.decisions, bookId, chapter) })),
    [edit],
  );
  const rename = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed) edit((t) => ({ ...t, name: trimmed }));
    },
    [edit],
  );

  return {
    talk,
    materials,
    messages,
    loading,
    streaming,
    error,
    send,
    stop,
    moveEntry,
    cutEntry,
    removeEntry,
    rename,
  };
}
