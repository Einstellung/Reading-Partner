// The open retell's live state: its file, its materials, its conversation and the
// turn currently streaming (docs/31).
//
// It sits in the ui layer rather than in reading/retell because it is where the
// domain meets the chat rendering (chatParts): the decision the AI records is
// both a write to the retell file and a card in the conversation, and one of those
// two is a render concern. Everything decidable without React — the outline
// operations, the turn assembly, the list rows — is in the domain and tested
// there; the turns run on the device's durable runtime through the chat layer's
// usePlaceChat (docs/soul/87). What is left here is wiring.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createThread,
  getThread,
  loadThreads,
  type ThreadMessage as StoredMessage,
} from "../../../platform/app/threads";
import { loadSettings, type Settings } from "../../../platform/app/settings";
import { useT } from "../../../i18n";
import {
  editTalkOutline,
  talkOutlineForRetell,
  talkOutlineOfRetell,
} from "../../../reading/talk";
import {
  loadMaterials,
  loadRetell,
  prepareRetellTurn,
  recordRetellDecision,
  retellConversationKey,
  retellThreadKey,
  updateRetell,
  type LoadedMaterial,
  type Retell,
} from "../../../reading/retell";
import type { PlaceAssembled } from "../../../reading/turn/place-session";
import { distillRetell } from "../../../memory";
import type { ThreadMessage } from "../chat/types";
import { rehydrateMessage, type CardPayload } from "../chat/chatParts";
import { usePlaceChat } from "../chat/use-place-chat";

// A retell has exactly one conversation, so the thread id is the retell id. Nothing
// has to be looked up, and a thread file with a second thread in it could only
// come from a hand edit.
function threadIdOf(retellId: string): string {
  return retellId;
}

function toDisplay(msgs: StoredMessage[]): ThreadMessage[] {
  return msgs.map(rehydrateMessage);
}

export interface RetellController {
  retell: Retell | null;
  materials: LoadedMaterial[];
  messages: ThreadMessage[];
  loading: boolean;
  streaming: boolean;
  // A failure the reader has to see: no provider configured, a turn that could
  // not be assembled, a retell file that has gone.
  error: string | null;
  send(text: string): void;
  stop(): void;
  // Writes the retell file and is reflected immediately.
  rename(name: string): void;
}

export function useRetell(retellId: string, topicName: string): RetellController {
  const t = useT();
  const [retell, setRetell] = useState<Retell | null>(null);
  const [materials, setMaterials] = useState<LoadedMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read by the turn's assembly and tools, so a reply in flight always writes
  // against the retell as it is now rather than as it was when the turn started.
  const retellRef = useRef<Retell | null>(null);
  const materialsRef = useRef<LoadedMaterial[]>([]);
  const settingsRef = useRef<Settings | null>(null);

  useEffect(() => {
    retellRef.current = retell;
  }, [retell]);
  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

  const key = retellThreadKey(retellId);
  const threadId = threadIdOf(retellId);

  // Read by the exit capture and the assembly, which must not be rebuilt when
  // the topic is renamed.
  const topicNameRef = useRef(topicName);
  useEffect(() => {
    topicNameRef.current = topicName;
  }, [topicName]);

  const raiseCardRef = useRef<(prefix: string, payload: CardPayload) => void>(() => {});

  // One turn. Assembles from the retell as it stands; the place session streams
  // it into the rows and the runtime lands it. A decision recorded mid-turn
  // writes the file and drops a card in above the reply being written.
  const assemble = useCallback(
    async (_signal: AbortSignal): Promise<PlaceAssembled> => {
      const current = retellRef.current;
      const s = settingsRef.current;
      if (!current || !s?.defaultProviderId || !s.defaultModelId) {
        return { kind: "failed", message: t("study.retell.needProvider", { settings: t("settings.title") }) };
      }
      // The card rows are persisted with no text of their own (the payload is
      // in `parts`), and an empty message is one some providers reject
      // outright. What the decision cards say is in the record the prompt
      // carries anyway, so they are left out of the replay.
      const spoken = (getThread(key, threadId)?.messages ?? []).filter((m) => m.text.trim() !== "");
      // The reader's line in the file; the opening turn has none, its line is the kickoff.
      const last = spoken[spoken.length - 1];
      return prepareRetellTurn({
        retell: current,
        materials: materialsRef.current,
        topicName: topicNameRef.current,
        settings: { ...s, defaultProviderId: s.defaultProviderId, defaultModelId: s.defaultModelId },
        ...(last ? { lineTs: last.ts } : {}),
        history: spoken.map((m) => ({ role: m.role, text: m.text })),
        record: async (decision) => {
          const next = await recordRetellDecision(retellId, decision);
          if (next) {
            retellRef.current = next;
            setRetell(next);
          }
        },
        // The ref, not the snapshot the turn was assembled from: read_retell_outline
        // has to answer with the entry recorded a moment ago in this same turn,
        // and with the one the reader just moved in the outline pane.
        readRetell: () => retellRef.current,
        // The talk this retell arranges at the end (docs/44). `read` does not
        // make one, so a retell that never gets arranged leaves no empty talk
        // behind; the first write makes it, through the same find-or-create the
        // rehearsal uses, so the two doors cannot leave two outlines.
        talk: {
          read: () => talkOutlineOfRetell(retellId),
          edit: async (change) => {
            const owner = retellRef.current ?? current;
            const outline = await talkOutlineForRetell({
              topicId: owner.topicId,
              retellId,
              name: owner.name,
            });
            return editTalkOutline(outline.id, change);
          },
        },
        onDecisionCard: (payload) => raiseCardRef.current("retell", payload),
        onArrangeCard: (payload) => raiseCardRef.current("talk", payload),
      });
    },
    [retellId, key, threadId, t],
  );

  // Leaving the retell is this conversation's hangup (docs/31: the retell is
  // the most worth observing stretch of conversation there is, and it had no
  // distillation at all). Every way out of a retell — the Back button, switching
  // topic, opening a book, moving to another home screen — unmounts this hook,
  // so the one place that covers all of them is the chat's leave.
  //
  // Returns true when the pass was handed to a turn still streaming instead of
  // being run now: half a sentence is not what the reader said, and summarising
  // it would put a judgement about them on record over an answer they had not
  // finished giving. A deferred pass is also why the turn is then left running
  // rather than stopped — it has to land for there to be anything to read.
  //
  // A retell the reader never spoke in is not deferred and not distilled: an
  // opening question with no answer under it holds nothing that cannot be
  // re-derived, and leaving it alone keeps a retell opened and closed at once from
  // costing a model call.
  const exitRef = useRef<(() => void) | null>(null);
  const captureExit = useCallback(
    (running: boolean): boolean => {
      const current = retellRef.current;
      if (!current) return false;
      const stored = getThread(key, threadId)?.messages ?? [];
      const spoken = stored.filter((m) => m.text.trim() !== "");
      if (!spoken.some((m) => m.role === "user")) return false;
      const run = () =>
        void distillRetell({
          topicId: current.topicId,
          topicName: topicNameRef.current,
          retellId: current.id,
          retellName: current.name,
          materials: current.materials.map((m) => m.title),
          threadId,
          trigger: "talk-exit",
          // Read at the moment the pass starts, not now: a deferred pass runs
          // after the reply has landed, and that reply is part of the stretch
          // being distilled.
          messages: (getThread(key, threadId)?.messages ?? [])
            .filter((m) => m.text.trim() !== "")
            .map(({ id, role, text, ts }) => ({ ...(id ? { id } : {}), role, text, ts })),
        });
      if (running) {
        exitRef.current = run;
        return true;
      }
      run();
      return false;
    },
    [key, threadId],
  );

  const chat = usePlaceChat({
    storeKey: key,
    threadId,
    conversation: retellConversationKey(retellId),
    surface: "talk",
    canAsk: () => {
      const s = settingsRef.current;
      if (retellRef.current && s?.defaultProviderId && s.defaultModelId) return true;
      if (retellRef.current) setError(t("study.retell.needProvider", { settings: t("settings.title") }));
      return false;
    },
    assemble,
    keepOnLeave: captureExit,
    settledAway: () => {
      const pending = exitRef.current;
      exitRef.current = null;
      pending?.();
    },
  });
  raiseCardRef.current = chat.raiseCard;
  const { setMessages, resume, ask } = chat;

  // Open the retell: its file, its materials, its conversation. Runs once per
  // retell. A turn in flight on it — one a killed process left, resumed at
  // start — is followed. A retell opened with nothing in it starts itself:
  // stage one of the retell is the AI laying out the skeleton and asking which
  // thread the retell should follow (docs/31), and making the reader type "go
  // on" first would be a step that says nothing. Reopening a retell with
  // history does not fire another turn.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const loaded = await loadRetell(retellId);
      if (cancelled) return;
      if (!loaded) {
        setError(t("study.retell.notReadable"));
        setLoading(false);
        return;
      }
      setRetell(loaded);
      retellRef.current = loaded;
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
      if (await resume().catch((e: unknown) => (console.warn("retell turn could not be resumed", e), false))) return;
      if (cancelled) return;
      if ((getThread(key, threadId)?.messages.length ?? 0) === 0) ask();
    })();
    return () => {
      cancelled = true;
    };
  }, [retellId, key, threadId, resume, ask, setMessages, t]);

  const send = useCallback((text: string) => void chat.send(text), [chat]);

  // The outline edits. Each writes the file and takes what came back, so what is
  // on screen is what a reload would show.
  const edit = useCallback(
    (patch: (retell: Retell) => Retell) => {
      void (async () => {
        const next = await updateRetell(retellId, patch);
        if (next) {
          retellRef.current = next;
          setRetell(next);
        }
      })();
    },
    [retellId],
  );

  const rename = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed) edit((t) => ({ ...t, name: trimmed }));
    },
    [edit],
  );

  return {
    retell,
    materials,
    messages: chat.messages,
    loading,
    streaming: chat.streaming,
    error,
    send,
    stop: chat.stop,
    rename,
  };
}
