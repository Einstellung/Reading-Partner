// The conversation typed to Lumen: the day's conversation at the door (docs/61,
// soul/door.ts), as the chat surface holds it. Loaded and replayed when it
// opens, every line written to the day's thread file as it is said, and the
// turns run on the device's durable runtime (docs/soul/87): assembled by
// soul/door-chat.ts prepareDoorTurn, driven by reading/turn/place-session.ts,
// landed into the day's file by the door's place (soul/door-durable.ts).
//
// The reader can talk into a running turn (docs/72); Stop keeps the half
// sentence and the receipts; a turn in flight when the conversation opens —
// one a killed process left, resumed at start — is drawn, stoppable and
// steerable like one started here. Closing the conversation does not stop its
// turn: it runs on and lands, with a box card if nobody has the conversation
// open by then, and the conversation opened again follows it.
//
// What lands in the conversation while it is open without this view writing it
// — a bell answering a delegated run at the door (soul/bell.ts), a turn's rows
// as the runtime lands them — is appended as it arrives unless a row with that
// role and timestamp is on screen already.

import { useCallback, useEffect, useRef, useState } from "react";

import { applyTopicProposal } from "../../../memory";
import { doorDate, doorKey, doorOrigin, doorThreadKey, openDoorThread, prepareDoorTurn, setDoorWatching } from "../../../soul";
import { t } from "../../../i18n";
import { topicFiledNote } from "../../../info/briefer/call";
import { replayableHistory } from "../../../ai/turn-view/turn-rows";
import { createTopic, listTopics } from "../../../platform/app/topics";
import { loadSettings } from "../../../platform/app/settings";
import { doorTurnNote, extractLinks, linksToTake } from "../../../reading/ingest/take-link-tool";
import { chooseIntakeTopic, readIntake } from "../../../reading/ingest/topic-intake";
import { readingDurable } from "../../../reading/turn/durable-runtime";
import type { CallRow } from "../../../reading/turn/call-state";
import { createPlaceSession, registerOpenSession, withPlaceTurnRows, type PlaceAssembled, type PlaceSession } from "../../../reading/turn/place-session";
import {
  appendMessage,
  onThreadMessage,
  patchThreadMessage,
  setThreadTopic,
} from "../../../platform/app/threads";
import {
  cardRow,
  findCardPart,
  latestCardOf,
  nextCardId,
  patchCardPayload,
  rehydrateMessage,
  toPersistedCardPart,
  type CardAction,
  type CardPayload,
} from "../chat/chatParts";
import type { ThreadMessage as UiMessage } from "../chat/types";
import { forgetScroll } from "../common/scroll-memory";
import { doorTools } from "./door-tools";
import { getOpenIssue, issueDoorTurn, noteOnLastLine, type IssueQuote } from "./issue-context";
import { quotedQuestion } from "../chat/quoted-question";
import { speakIssueOpening } from "../../../info/issue/opening";
import {
  ISSUE_ANSWER_OP,
  ISSUE_OWN_OP,
  cardAwaitingWords,
  issueAnswerNote,
  type IssueQuestionCard,
} from "../../../info/issue/question-card";
import { headingPage } from "../../../reading/issue";
import { TOPIC_SEARCH_APPLY_OP, topicSearchAppliedNote } from "../../../info/topic-search/cards";
import type { ApplyResult } from "../../../info/topic-search/apply";
import { applyTopicSearchCard, loadTopicSearchGuidance } from "../../../info/topic-search/live";
import {
  INTAKE_CHOOSE_OP,
  INTAKE_NEW_TOPIC_OP,
  INTAKE_OPEN_TARGET,
  documentToOpen,
  type IntakeOpenDocument,
} from "./intake-view";

export interface DoorChat {
  messages: UiMessage[];
  /** This conversation's key in the transcript's scroll memory. */
  stickKey: string;
  /** The day's thread is loaded and a line can be sent. */
  ready: boolean;
  streaming: boolean;
  /** Say a line; with a quote, a question about that passage of the open brief. */
  send(text: string, quote?: IssueQuote): Promise<void>;
  stop(): void;
  onCardAction(cardId: string, action: CardAction): void;
}

export interface DoorChatOptions {
  /**
   * The day whose conversation to open: a card in Lumen's box goes back to the
   * conversation it came from, which may be an earlier day's. Today otherwise.
   */
  date?: string;
  /** Open a document an intake card filed (its 「打开阅读」), in this shell's reader. */
  onOpenDocument?: (doc: IntakeOpenDocument) => void;
  /**
   * The brief whose opening brought the conversation up (docs/info/88): Lumen's
   * first words about it go in once the day's conversation is loaded. Read once.
   */
  openedFor?: string;
}

const isCardRow = (m: UiMessage) => m.parts?.some((part) => part.type === "card") ?? false;

// The questions Lumen asked when a brief opened, in the order they stand.
const issueCards = (rows: readonly UiMessage[]): { cardId: string; card: IssueQuestionCard }[] =>
  rows.flatMap((m) =>
    (m.parts ?? []).flatMap((part) =>
      part.type === "card" && part.card.kind === "issue-question" ? [{ cardId: part.id, card: part.card }] : [],
    ),
  );

export function useDoorChat(options: DoorChatOptions = {}): DoorChat {
  // The day the chat was opened on. A conversation left open over midnight
  // stays in the day it began, the way a call does.
  const [date] = useState(() => options.date ?? doorDate());
  const [openedFor] = useState(() => options.openedFor ?? null);
  const openDocumentRef = useRef(options.onOpenDocument);
  openDocumentRef.current = options.onOpenDocument;
  const key = doorKey(date);
  const stickKey = `door:${date}`;
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setRendered] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const sessionRef = useRef<PlaceSession | null>(null);
  // The conversation was just opened and the runtime has not yet said whether
  // a turn is in flight on it; a line said meanwhile waits for the answer.
  const lookingRef = useRef<Promise<unknown> | null>(null);

  // Every change lands on the mirror at once, so a turn started in the same
  // tick reads the conversation it is answering.
  const messagesRef = useRef<UiMessage[]>([]);
  const setMessages = useCallback<React.Dispatch<React.SetStateAction<UiMessage[]>>>((action) => {
    messagesRef.current = typeof action === "function" ? action(messagesRef.current) : action;
    setRendered(messagesRef.current);
  }, []);

  // Rows the reader's lines and the cards open are keyed by when they were
  // made; kept strictly increasing so two in one millisecond stay two rows.
  const lastTsRef = useRef(0);
  const stamp = useCallback(() => {
    const at = Math.max(Date.now(), lastTsRef.current + 1);
    lastTsRef.current = at;
    return at;
  }, []);

  // A receipt for something the AI just wrote, shown above the turn's rows and
  // persisted, so a reopened conversation still shows what landed.
  const raiseCard = useCallback(
    (prefix: string, payload: CardPayload) => {
      if (!threadId) return;
      const cardId = nextCardId(prefix);
      const cardTs = stamp();
      setMessages((prev) => {
        const card = cardRow(cardId, payload, cardTs);
        const at = prev.findIndex((m) => m.ts > cardTs || m.streaming === true);
        return at === -1 ? [...prev, card] : [...prev.slice(0, at), card, ...prev.slice(at)];
      });
      appendMessage(key, threadId, { role: "ai", text: "", ts: cardTs, parts: [toPersistedCardPart(cardId, payload)] });
    },
    [key, threadId, setMessages, stamp],
  );
  const raiseCardRef = useRef(raiseCard);
  raiseCardRef.current = raiseCard;
  // The drafting card's Apply, for confirm_topic_search in a turn assembled earlier.
  const applyTopicSearchRef = useRef<(cardId: string) => Promise<ApplyResult>>(async () => ({ ok: false }));

  useEffect(() => {
    let live = true;
    let unwatch: (() => void) | undefined;
    void openDoorThread(date).then((thread) => {
      if (!live) return;
      const id = thread.id;
      const origin = doorOrigin(date, id);
      setThreadId(id);
      setMessages(thread.messages.map(rehydrateMessage));
      const assemble = async (signal: AbortSignal): Promise<PlaceAssembled> => {
        const history = messagesRef.current.filter((m) => !m.streaming && !m.queued);
        // A message carrying links goes to the model with an app note that
        // numbers them and the topics, which is what take_link is called with.
        // One without links, in a conversation that holds an intake card, goes
        // with the note that the card, not the model, knows where it stands.
        const latest = history[history.length - 1];
        const latestLinks = latest?.role === "user" ? extractLinks(latest.text) : [];
        const holdsIntake = history.some((m) =>
          m.parts?.some((part) => part.type === "card" && part.card.kind === "link-intake"),
        );
        const topics = latestLinks.length > 0 ? await listTopics().catch(() => []) : [];
        // With a brief open, the brief is on the desk and where the reader is
        // in it rides the same note (issue-context.ts, docs/info/88).
        const issue = await issueDoorTurn(getOpenIssue(), latest?.role === "user" ? latest.text : "");
        // A line answering one of the brief's questions says which (info/issue/question-card.ts).
        const answers = latest?.role === "user" ? issueAnswerNote(issueCards(history).map((c) => c.card), latest.ts) : "";
        const note = latest?.role === "user" ? doorTurnNote(latestLinks, topics, holdsIntake) + issue.note + answers : "";
        const sent = noteOnLastLine(history, note);
        const prepared = await prepareDoorTurn({
          threadId: id,
          date,
          history: replayableHistory(sent),
          ...(issue.desk.length > 0 ? { desk: issue.desk } : {}),
          signal,
          // The door's own tools, beside the soul's (door-tools.ts).
          tools: doorTools({
            threadId: id,
            date,
            raiseCard: (prefix, payload) => raiseCardRef.current(prefix, payload),
            links: linksToTake(history),
            settings: await loadSettings(),
            readerLines: () =>
              history
                .filter((m) => m.role === "user")
                .map((m) => ({ ...(m.id ? { id: m.id } : {}), ts: m.ts, text: m.text })),
            // Read when called: a card drawn earlier in the same turn counts.
            latestTopicSearchCard: () => {
              const found = latestCardOf(messagesRef.current, "topic-search-proposal");
              return found ? { cardId: found.cardId, card: found.payload } : null;
            },
            applyTopicSearchCard: (cardId) => applyTopicSearchRef.current(cardId),
          }),
          topic: { onCard: (payload) => raiseCardRef.current("topic", payload) },
          // How a topic search is drafted, and the ones the reader has (docs/info/88).
          prompt: await loadTopicSearchGuidance(),
        });
        if (prepared.kind === "no-provider") return { kind: "failed", message: t("info.errors.noProvider") };
        if (prepared.kind === "refused") return { kind: "refused", message: prepared.text };
        if (prepared.kind === "aborted") return { kind: "aborted" };
        return {
          kind: "turn",
          request: {
            key: prepared.key,
            origin: prepared.origin,
            conversation: id,
            surface: "door",
            line: { text: prepared.line, ...(latest ? { ts: latest.ts } : {}) },
            systemPrompt: prepared.systemPrompt,
            tools: prepared.tools,
            model: prepared.model,
            ...(prepared.thinkingLevel ? { thinkingLevel: prepared.thinkingLevel } : {}),
          },
          ...(prepared.notice ? { notice: prepared.notice } : {}),
        };
      };
      const session = createPlaceSession({
        durable: readingDurable,
        key: doorThreadKey(origin),
        surface: "door",
        assemble,
        lastLine: () => {
          let ts = 0;
          for (const m of messagesRef.current) if (m.role === "user" && !m.queued) ts = m.ts;
          return ts;
        },
        draw: (after, rows) =>
          setMessages((prev) => withPlaceTurnRows<CallRow & UiMessage>(prev, after, rows as (CallRow & UiMessage)[], isCardRow)),
        file: (lines) => {
          for (const line of lines) appendMessage(key, id, { role: "user", text: line.text, ts: line.ts });
        },
        streaming: setStreaming,
      });
      sessionRef.current = session;
      // A bell rung for this conversation while it is open runs in this session (place-bell.ts).
      const closed = registerOpenSession(doorThreadKey(origin), session);
      const unwatchDoor = setDoorWatching((o) => o.date === date && o.threadId === id);
      unwatch = () => {
        closed();
        unwatchDoor();
      };
      lookingRef.current = session.resume().catch((e: unknown) => console.warn("door turn could not be resumed", e));
      // An issue just opened: Lumen speaks first about it (info/issue/opening.ts),
      // its items cited by the page they stand on in the book that is open.
      if (openedFor) {
        void lookingRef.current
          .then(async () => {
            const open = getOpenIssue();
            const text = open?.bookId === openedFor ? await open.fulltext().catch(() => null) : null;
            await speakIssueOpening({ bookId: openedFor, date, threadId: id, pageOf: (heading) => headingPage(text, heading) });
          })
          .catch((e: unknown) => console.warn("the brief's opening could not be said", e));
      }
    });
    return () => {
      live = false;
      sessionRef.current?.detach();
      sessionRef.current = null;
      unwatch?.();
      forgetScroll(stickKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Every append through the store is announced, this view's own and the
  // runtime's landing included; a row already on screen under that role and
  // timestamp is skipped.
  useEffect(() => {
    if (!threadId) return;
    return onThreadMessage((append) => {
      if (append.key !== key || append.threadId !== threadId) return;
      const row = rehydrateMessage(append.message);
      setMessages((prev) => (prev.some((m) => m.ts === row.ts && m.role === row.role) ? prev : [...prev, row]));
    });
  }, [key, threadId, setMessages]);

  const note = useCallback(
    (text: string, role: "user" | "ai" = "user") => {
      if (!threadId) return;
      const ts = stamp();
      setMessages((prev) => [...prev, { role, text, ts }]);
      appendMessage(key, threadId, { role, text, ts });
    },
    [key, threadId, setMessages, stamp],
  );

  // A question of the brief's answered by the line said at `ts`: the card shows
  // the answer, on screen and in the thread file.
  const markAnswered = useCallback(
    (cardId: string, answer: string, ts: number) => {
      if (!threadId) return;
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "issue-question") return;
      const patch = { phase: "answered" as const, answer, answerTs: ts };
      setMessages((prev) => patchCardPayload(prev, cardId, patch));
      patchThreadMessage(key, threadId, found.ts, { parts: [toPersistedCardPart(cardId, { ...found.payload, ...patch })] });
    },
    [key, threadId, setMessages],
  );

  const say = useCallback(
    async (typed: string, quote?: IssueQuote, answering?: string) => {
      if (!typed.trim() || !threadId) return;
      // A question about a passage carries the passage above it (quoted-question.ts).
      const text = quote ? quotedQuestion(quote.text, typed) : typed;
      await lookingRef.current;
      const session = sessionRef.current;
      if (!session) return;
      const ts = stamp();
      // A quick answer, or the words a question was left waiting for.
      const card = answering ?? cardAwaitingWords(issueCards(messagesRef.current));
      if (card) markAnswered(card, typed, ts);
      // Into the turn that is running (docs/72); otherwise a turn of its own.
      if (session.say(text, ts)) return;
      setMessages((prev) => [...prev, { role: "user", text, ts }]);
      appendMessage(key, threadId, { role: "user", text, ts });
      session.ask();
    },
    [key, threadId, setMessages, stamp, markAnswered],
  );
  const send = useCallback((typed: string, quote?: IssueQuote) => say(typed, quote), [say]);

  // "In my own words": the card waits for the next line typed.
  const awaitWords = useCallback(
    (cardId: string) => {
      if (!threadId) return;
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "issue-question" || found.payload.phase === "answered") return;
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "own" }));
      patchThreadMessage(key, threadId, found.ts, { parts: [toPersistedCardPart(cardId, { ...found.payload, phase: "own" })] });
    },
    [key, threadId, setMessages],
  );

  const stop = useCallback(() => sessionRef.current?.stop(), []);

  // Filing the conversation under a topic is what lets it be distilled at all:
  // a day at the door has no material to say what it is about (soul/door.ts).
  const applyTopic = useCallback(
    async (cardId: string) => {
      if (!threadId) return;
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "topic-proposal") return;
      const card = found.payload;
      const { ok } = await applyTopicProposal(card, {
        createTopic,
        fileThread: (id, topicId) => setThreadTopic(key, id, topicId),
        settled: [],
        topicsChanged: () => {},
      });
      if (!ok) return;
      setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
      patchThreadMessage(key, threadId, found.ts, {
        parts: [toPersistedCardPart(cardId, { ...card, phase: "applied" })],
      });
      note(topicFiledNote(card));
    },
    [key, threadId, note, setMessages],
  );

  // The drafting card's Apply (docs/info/88): the config, the concern, and the
  // first run handed off, all in info/topic-search/apply.ts. The Follow button
  // and confirm_topic_search both land here; a second call while one is in
  // flight waits for it instead of filing the search twice.
  const applyingRef = useRef(new Map<string, Promise<ApplyResult>>());
  const applyTopicSearch = useCallback(
    (cardId: string): Promise<ApplyResult> => {
      const inFlight = applyingRef.current.get(cardId);
      if (inFlight) return inFlight;
      const run = async (): Promise<ApplyResult> => {
        if (!threadId) return { ok: false };
        const found = findCardPart(messagesRef.current, cardId);
        if (!found || found.payload.kind !== "topic-search-proposal") return { ok: false };
        const card = found.payload;
        const result = await applyTopicSearchCard(card);
        if (!result.ok) return result;
        setMessages((prev) => patchCardPayload(prev, cardId, { phase: "applied" }));
        patchThreadMessage(key, threadId, found.ts, {
          parts: [toPersistedCardPart(cardId, { ...card, phase: "applied" })],
        });
        return result;
      };
      const pending = run().finally(() => applyingRef.current.delete(cardId));
      applyingRef.current.set(cardId, pending);
      return pending;
    },
    [key, threadId, setMessages],
  );
  applyTopicSearchRef.current = applyTopicSearch;

  // The Follow button leaves a line in the conversation; confirm_topic_search's receipt stands for it.
  const followTopicSearch = useCallback(
    async (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      const result = await applyTopicSearch(cardId);
      if (result.ok && found?.payload.kind === "topic-search-proposal") note(topicSearchAppliedNote(found.payload));
    },
    [applyTopicSearch, note],
  );

  // The intake card's pick: a topic on the shelf, or one made on the card first.
  // The card redraws off the intake record, so nothing is patched here.
  const intakeOf = useCallback((cardId: string): string | null => {
    const found = findCardPart(messagesRef.current, cardId);
    return found && found.payload.kind === "link-intake" ? found.payload.intakeId : null;
  }, []);
  const pickIntakeTopic = useCallback(
    async (cardId: string, topic: { id?: string; name?: string }) => {
      const intakeId = intakeOf(cardId);
      if (!intakeId) return;
      try {
        const topicId = topic.id ?? (topic.name ? (await createTopic(topic.name)).id : null);
        if (topicId) await chooseIntakeTopic(intakeId, topicId);
      } catch (e) {
        console.warn("the intake's topic could not be picked", e);
      }
    },
    [intakeOf],
  );
  const openIntakeDocument = useCallback(
    async (cardId: string, hash: string) => {
      const intakeId = intakeOf(cardId);
      const doc = intakeId ? documentToOpen(await readIntake(intakeId), hash) : null;
      if (doc) openDocumentRef.current?.(doc);
    },
    [intakeOf],
  );

  // A card's gestures. A door tool's card adds its own `mutate` op here.
  const onCardAction = useCallback(
    (cardId: string, action: CardAction) => {
      switch (action.kind) {
        case "mutate":
          if (action.op === "apply-topic") void applyTopic(cardId);
          else if (action.op === TOPIC_SEARCH_APPLY_OP) void followTopicSearch(cardId);
          else if (action.op === INTAKE_CHOOSE_OP && action.arg) void pickIntakeTopic(cardId, { id: action.arg });
          else if (action.op === INTAKE_NEW_TOPIC_OP && action.arg) void pickIntakeTopic(cardId, { name: action.arg });
          else if (action.op === ISSUE_ANSWER_OP && action.arg) void say(action.arg, undefined, cardId);
          else if (action.op === ISSUE_OWN_OP) awaitWords(cardId);
          break;
        case "local":
          setMessages((prev) => patchCardPayload(prev, cardId, action.patch));
          break;
        case "reply":
          note(action.text, action.role);
          break;
        case "navigate":
          if (action.to === INTAKE_OPEN_TARGET && action.arg) void openIntakeDocument(cardId, action.arg);
          break;
        case "resolve":
          break;
      }
    },
    [applyTopic, followTopicSearch, pickIntakeTopic, openIntakeDocument, note, setMessages, say, awaitWords],
  );

  return { messages, stickKey, ready: threadId !== null, streaming, send, stop, onCardAction };
}
