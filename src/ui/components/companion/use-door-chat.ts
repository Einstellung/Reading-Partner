// The conversation typed to the companion: the day's conversation at the door (docs/61,
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
import { doorTools, doorToolsPrompt } from "./door-tools";
import { getOpenIssue, issueDoorTurn, noteOnLastLine, type IssueQuote } from "./issue-context";
import { listenToThread, withArrivedRow } from "./door-arrivals";
import { quotedQuestion } from "../chat/quoted-question";
import { speakIssueOpening } from "../../../info/issue/opening";
import {
  ISSUE_ANSWER_OP,
  ISSUE_LABEL_OP,
  ISSUE_OWN_OP,
  ISSUE_SKIP_OP,
  LABEL_ANSWERS,
  cardAwaitingWords,
  cardLabelled,
  cardWithWords,
  issueAnswerNote,
  labelWords,
  recordLabelAnswer,
  type IssueQuestionCard,
  type LabelAnswer,
} from "../../../info/issue/question-card";
import { headingPage } from "../../../reading/issue";
import {
  seedVerdictNote,
  STUDY_LINE_EDIT_OP,
  STUDY_LINE_VERDICT_OP,
  STUDY_LINES_SEND_OP,
  STUDY_MOVE_LATER_OP,
  STUDY_MOVE_OP,
  STUDY_SEED_VERDICT_OP,
  TOPIC_SEARCH_APPLY_OP,
  topicSearchAppliedNote,
  withSeedVerdict,
  type StudyLinesCardData,
  type StudyMoveCardData,
  type StudySeedsCardData,
} from "../../../info/topic-search/cards";
import type { ApplyResult } from "../../../info/topic-search/apply";
import { applyTopicSearchCard, loadTopicSearchGuidance, sendStudyLinesCard } from "../../../info/topic-search/live";
import { parseMoveTarget, withLineEdit, withLineVerdict, type SendResult } from "../../../info/topic-search/study-lines";
import type { DraftQuery } from "../../../info/topic-search/topic-searches";
import { endStudyLive, liveStudyBook } from "./study-end";
import { BACKGROUND_STATUS_RULE } from "../../../legion/status/tool";
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
   * The day whose conversation to open: a card in the companion's box goes back to the
   * conversation it came from, which may be an earlier day's. Today otherwise.
   */
  date?: string;
  /** Open a document an intake card filed (its 「打开阅读」), in this shell's reader. */
  onOpenDocument?: (doc: IntakeOpenDocument) => void;
  /**
   * The brief whose opening brought the conversation up (docs/info/88): the companion's
   * first words about it go in once the day's conversation is loaded. Read once.
   */
  openedFor?: string;
}

const isCardRow = (m: UiMessage) => m.parts?.some((part) => part.type === "card") ?? false;

// The seed cards find_seed_paper drew (docs/info/91), in the order they stand.
const seedCards = (rows: readonly UiMessage[]): StudySeedsCardData[] =>
  rows.flatMap((m) => (m.parts ?? []).flatMap((part) => (part.type === "card" && part.card.kind === "study-seeds" ? [part.card] : [])));

// The questions the companion asked when a brief opened, in the order they stand.
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
  // The confirm-lines card's button, for update_study_brief in a turn assembled earlier.
  const sendLinesRef = useRef<(cardId: string, queries: readonly DraftQuery[]) => Promise<SendResult>>(async () => ({
    ok: false,
    why: "ended",
  }));

  useEffect(() => {
    let live = true;
    let unwatch: (() => void) | undefined;
    void openDoorThread(date).then((thread) => {
      if (!live) return;
      const id = thread.id;
      const origin = doorOrigin(date, id);
      setThreadId(id);
      setMessages(thread.messages.map(rehydrateMessage));
      // Every append through the store is announced, this view's own and the
      // runtime's landing included; a row already on screen under that role and
      // timestamp is skipped. Heard from here on (door-arrivals.ts).
      const unlisten = listenToThread(key, id, (message) => {
        const row = rehydrateMessage(message);
        setMessages((prev) => withArrivedRow(prev, row));
      });
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
        // The door's own tools, beside the soul's (door-tools.ts).
        const tools = doorTools({
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
          // Read when called: a verdict pressed while the turn runs counts.
          seedCards: () => seedCards(messagesRef.current),
          // Read when called: the marks pressed while the turn runs count.
          latestLinesCard: () => {
            const found = latestCardOf(messagesRef.current, "study-lines");
            return found ? { cardId: found.cardId, card: found.payload } : null;
          },
          sendLines: (cardId, queries) => sendLinesRef.current(cardId, queries),
          studyBook: liveStudyBook,
        });
        const prepared = await prepareDoorTurn({
          threadId: id,
          date,
          history: replayableHistory(sent),
          ...(issue.desk.length > 0 ? { desk: issue.desk } : {}),
          signal,
          tools,
          topic: { onCard: (payload) => raiseCardRef.current("topic", payload) },
          // How a topic search is drafted, and the ones the reader has (docs/info/88); asking how background
          // work is going; when to search the web.
          prompt: `${await loadTopicSearchGuidance()}\n\n${BACKGROUND_STATUS_RULE}\n\n${doorToolsPrompt(tools)}`,
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
        unlisten();
        closed();
        unwatchDoor();
      };
      lookingRef.current = session.resume().catch((e: unknown) => console.warn("door turn could not be resumed", e));
      // An issue just opened: the companion speaks first about it (info/issue/opening.ts),
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

  const note = useCallback(
    (text: string, role: "user" | "ai" = "user") => {
      if (!threadId) return;
      const ts = stamp();
      setMessages((prev) => [...prev, { role, text, ts }]);
      appendMessage(key, threadId, { role, text, ts });
    },
    [key, threadId, setMessages, stamp],
  );

  // A question card redrawn, on screen and in the thread file.
  const putIssueCard = useCallback(
    (cardId: string, rowTs: number, next: IssueQuestionCard) => {
      if (!threadId) return;
      setMessages((prev) => patchCardPayload(prev, cardId, { ...next }));
      patchThreadMessage(key, threadId, rowTs, { parts: [toPersistedCardPart(cardId, next)] });
    },
    [key, threadId, setMessages],
  );

  // A question of the brief's answered by the line said at `ts`: the card shows
  // the answer. A label question's reason is written into the topic's labels;
  // its own words wait on the card to be filed (info/issue/question-card.ts).
  const markAnswered = useCallback(
    (cardId: string, answer: string, ts: number) => {
      if (!threadId) return;
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "issue-question") return;
      const card = found.payload;
      if (card.label) {
        const next = cardWithWords(card, answer, ts);
        if (!next) return;
        putIssueCard(cardId, found.ts, next);
        if (card.phase === "reason") {
          void recordLabelAnswer(card, "no", answer, { ts, threadId }, Date.now()).catch((e: unknown) =>
            console.warn("the label's reason could not be written", e),
          );
        }
        return;
      }
      putIssueCard(cardId, found.ts, { ...card, phase: "answered", answer, answerTs: ts });
    },
    [threadId, putIssueCard],
  );

  // A label question's answer pressed (docs/info/91 「攒着问」): written into the
  // topic's labels by the app, no turn. On an open card the pressed words are
  // said as the reader's line; on a card holding own words, those are filed.
  const labelAnswer = useCallback(
    (cardId: string, label: LabelAnswer) => {
      if (!threadId) return;
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "issue-question") return;
      const card = found.payload;
      const held = card.phase === "file" ? card.label?.said : undefined;
      const heldTs = card.label?.saidTs;
      const ts = held !== undefined && heldTs !== undefined ? heldTs : stamp();
      const next = cardLabelled(card, label, ts);
      if (!next) return;
      const reason = held ?? labelWords(label);
      if (held === undefined) {
        setMessages((prev) => [...prev, { role: "user", text: reason, ts }]);
        appendMessage(key, threadId, { role: "user", text: reason, ts });
      }
      putIssueCard(cardId, found.ts, next);
      void recordLabelAnswer(card, label, reason, { ts, threadId }, Date.now()).catch((e: unknown) =>
        console.warn("the label could not be written", e),
      );
    },
    [key, threadId, setMessages, stamp, putIssueCard],
  );

  // No reason given for an item off the mark: the label written already stands.
  const skipReason = useCallback(
    (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "issue-question" || found.payload.phase !== "reason") return;
      putIssueCard(cardId, found.ts, { ...found.payload, phase: "answered" });
    },
    [putIssueCard],
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
      if (!found || found.payload.kind !== "issue-question" || found.payload.phase !== "open") return;
      putIssueCard(cardId, found.ts, { ...found.payload, phase: "own" });
    },
    [threadId, putIssueCard],
  );

  // A seed card's 「是这篇」/「不是」: the card keeps the verdict, on screen and in the
  // thread file, and a line says it so the next turn knows (docs/info/91).
  const markSeed = useCallback(
    (cardId: string, arg: string) => {
      if (!threadId) return;
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "study-seeds") return;
      const next = withSeedVerdict(found.payload, arg);
      if (next === found.payload) return;
      setMessages((prev) => patchCardPayload(prev, cardId, { candidates: next.candidates }));
      patchThreadMessage(key, threadId, found.ts, { parts: [toPersistedCardPart(cardId, next)] });
      const line = seedVerdictNote(found.payload, arg);
      if (line) note(line);
    },
    [key, threadId, setMessages, note],
  );

  // A study card redrawn, on screen and in the thread file (docs/info/91).
  const putStudyCard = useCallback(
    (cardId: string, rowTs: number, next: StudyLinesCardData | StudyMoveCardData) => {
      if (!threadId) return;
      setMessages((prev) => patchCardPayload(prev, cardId, { ...next }));
      patchThreadMessage(key, threadId, rowTs, { parts: [toPersistedCardPart(cardId, next)] });
    },
    [key, threadId, setMessages],
  );

  // A confirm card's 对 / 别记, or a line reworded: kept on the card only; nothing is written until the send.
  const markLine = useCallback(
    (cardId: string, arg: string, edit: boolean) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "study-lines") return;
      const next = edit ? withLineEdit(found.payload, arg) : withLineVerdict(found.payload, arg);
      if (next !== found.payload) putStudyCard(cardId, found.ts, next);
    },
    [putStudyCard],
  );

  // 「按这几条更新简报」, the button and update_study_brief alike: the lines written,
  // then the update asked (info/topic-search/study-lines.ts). A second press while
  // one is in flight waits for it instead of writing the lines twice.
  const sendingRef = useRef(new Map<string, Promise<SendResult>>());
  const sendLines = useCallback(
    (cardId: string, queries: readonly DraftQuery[]): Promise<SendResult> => {
      const inFlight = sendingRef.current.get(cardId);
      if (inFlight) return inFlight;
      const run = async (): Promise<SendResult> => {
        const found = findCardPart(messagesRef.current, cardId);
        if (!found || found.payload.kind !== "study-lines") return { ok: false, why: "ended" };
        const result = await sendStudyLinesCard(found.payload, queries);
        if (result.ok) putStudyCard(cardId, found.ts, result.card);
        return result;
      };
      const pending = run().finally(() => sendingRef.current.delete(cardId));
      sendingRef.current.set(cardId, pending);
      return pending;
    },
    [putStudyCard],
  );
  sendLinesRef.current = sendLines;

  // The button leaves a line in the conversation; update_study_brief's receipt stands for it.
  const pressSend = useCallback(
    async (cardId: string) => {
      const result = await sendLines(cardId, []);
      if (result.ok) note(t("info.call.note.studyLinesSent"));
    },
    [sendLines, note],
  );

  // The move card's 「移进阅读，结束调研」 (study-end.ts), and its 「再看看」.
  const movingRef = useRef(new Set<string>());
  const moveStudy = useCallback(
    async (cardId: string, arg: string | undefined) => {
      const found = findCardPart(messagesRef.current, cardId);
      const target = parseMoveTarget(arg);
      if (!found || found.payload.kind !== "study-move" || !target || movingRef.current.has(cardId)) return;
      movingRef.current.add(cardId);
      try {
        const moved = await endStudyLive(found.payload, target);
        putStudyCard(cardId, found.ts, moved ?? { ...found.payload, failed: true });
        if (moved?.moved) note(t("info.call.note.studyMoved", { name: moved.name, topic: moved.moved.topic }));
      } finally {
        movingRef.current.delete(cardId);
      }
    },
    [putStudyCard, note],
  );
  const studyLater = useCallback(
    (cardId: string) => {
      const found = findCardPart(messagesRef.current, cardId);
      if (!found || found.payload.kind !== "study-move" || found.payload.phase === "moved") return;
      putStudyCard(cardId, found.ts, { ...found.payload, phase: "later" });
      note(t("info.call.note.studyMoveLater"));
    },
    [putStudyCard, note],
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
          else if (action.op === ISSUE_LABEL_OP && LABEL_ANSWERS.includes(action.arg as LabelAnswer)) labelAnswer(cardId, action.arg as LabelAnswer);
          else if (action.op === ISSUE_SKIP_OP) skipReason(cardId);
          else if (action.op === STUDY_SEED_VERDICT_OP && action.arg) markSeed(cardId, action.arg);
          else if (action.op === STUDY_LINE_VERDICT_OP && action.arg) markLine(cardId, action.arg, false);
          else if (action.op === STUDY_LINE_EDIT_OP && action.arg) markLine(cardId, action.arg, true);
          else if (action.op === STUDY_LINES_SEND_OP) void pressSend(cardId);
          else if (action.op === STUDY_MOVE_OP) void moveStudy(cardId, action.arg);
          else if (action.op === STUDY_MOVE_LATER_OP) studyLater(cardId);
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
    [
      applyTopic,
      followTopicSearch,
      pickIntakeTopic,
      openIntakeDocument,
      note,
      setMessages,
      say,
      awaitWords,
      labelAnswer,
      skipReason,
      markSeed,
      markLine,
      pressSend,
      moveStudy,
      studyLater,
    ],
  );

  return { messages, stickKey, ready: threadId !== null, streaming, send, stop, onCardAction };
}
