// Giving a run's answer back inside the book it was asked in (docs/68,
// docs/soul/87).
//
// The soul rings the bell and this lays the desk the question was asked over:
// the same book, the same thread, the same assembly a reading turn uses. What it
// is not is the reader's own turn — there is no page open and no rendered
// picture of one, so the ref is what can be read off disk and nothing else. The
// bell is the turn's input on the durable runtime and is never written to the
// thread (reading/desk.ts: `trailing`).
//
// A thread runs one turn at a time. A bell for a busy thread waits until that
// turn has landed and then starts its own. The bell's turn is registered on the
// thread like the session's own, so a reader looking at it watches it stream,
// can stop it and can talk into it.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { loadAnnotations } from "../../platform/app/annotations";
import { getLibraryEntry } from "../../platform/app/library";
import { appendMessage, flushThreads, getThread, loadThreads } from "../../platform/app/threads";
import { listSupplements } from "../../platform/app/supplements";
import { listTopics } from "../../platform/app/topics";
import { toReasoning } from "../../platform/app/settings";
import { modelIdFor } from "../../ai/model-tier";
import { getFulltext } from "../../fulltext/store";
import { toolLabel } from "../../legion/execute/tool-result";
import { bellTurn, TurnBusy, type WithdrawnSteer } from "../../legion/durable/turn";
import {
  registerDelivery,
  registerTurnDelivery,
  type Delivery,
  type DeliveryInput,
  type TurnDelivery,
  type TurnDeliveryOutcome,
} from "../../soul";
import { driveBookTurn, type BookTurnEnd } from "./book-turn-rows";
import type { CallRow } from "./call-state";
import { bookThreadKey, bookThreadOrigin, splitAssembled, type BookOrigin, type BookThreads } from "./durable-book";
import { readingDurable, type ReadingDurable } from "./durable-runtime";
import { readingTurns, type LiveTurns } from "./live-turns";
import { buildReadingTurn } from "./turn";
import { watchingNow } from "./turn-box";


/**
 * Assemble the turn that answers a bell inside a book. Null when there is no
 * such book any more, or the turn could not be assembled — the bell then falls
 * back to the door, which is where a conversation with nowhere else to go goes.
 */
export async function openBookDelivery(input: DeliveryInput): Promise<Delivery | null> {
  const { origin } = input;
  if (origin.place !== "book") return null;
  const { bookId, threadId } = origin;
  const entry = await getLibraryEntry(bookId).catch(() => null);
  if (!entry) return null;
  // The thread file has to be in memory before the desk reads the conversation
  // off it: nothing on this path went through the reader's session.
  await loadThreads(bookId).catch(() => ({}));
  const annotations = await loadAnnotations(bookId).catch(() => []);
  const fulltext = await getFulltext(bookId).catch(() => null);
  const topics = await listTopics().catch(() => []);
  const topic = topics.find((t) => t.files.some((f) => f.hash === bookId)) ?? null;
  const turn = await buildReadingTurn({
    settings: input.settings,
    bookId,
    // Nobody is looking at a supplement on this path: there is no reader.
    docId: bookId,
    viewing: null,
    supplements: await listSupplements(bookId).catch(() => []),
    threadId,
    annotationId: origin.annotationId ?? "",
    annotation: annotations.find((a) => a.id === origin.annotationId),
    annotations,
    fulltext,
    figures: [],
    // No canvas and no loaded engine on this path: a figure the answer names is
    // a figure the reader opens for themselves.
    buffer: null,
    context: {
      topicId: topic?.id ?? null,
      topicName: topic?.name ?? "",
      fileName: entry.title,
      pageLabel: origin.page === undefined ? null : String(origin.page),
      pageIndex: origin.page === undefined ? null : origin.page - 1,
      files: [],
    },
    getPipeline: () => null,
    distillAnnotations: () => [],
    trailing: { role: "user", text: input.bell },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!turn) return null;
  return {
    key: bookId,
    threadId,
    turn: {
      systemPrompt: turn.systemPrompt,
      tools: turn.tools,
      messages: turn.messages,
      refusal: turn.refusal,
    },
    // Asked when the reply lands, not now: the reader may open this very thread
    // while the turn is running, and then they read the answer as it arrives and
    // there is nothing to put in the box.
    watching: () => watchingNow({ threadId, bookId }),
  };
}

export interface BookBellDeps {
  durable(): Promise<ReadingDurable> | undefined;
  open(input: DeliveryInput): Promise<Delivery | null>;
  turns: LiveTurns<CallRow>;
  threads: BookThreads;
  watching(origin: BookOrigin): boolean;
  now(): number;
  drive?: typeof driveBookTurn;
}

function appBellDeps(): BookBellDeps {
  return {
    durable: readingDurable,
    open: openBookDelivery,
    turns: readingTurns<CallRow>(),
    threads: {
      messages: (home, threadId) => getThread(home, threadId)?.messages,
      append: (home, threadId, message) => appendMessage(home, threadId, message),
      flush: () => flushThreads(),
    },
    watching: (origin) => watchingNow(origin),
    now: Date.now,
  };
}

/** Resolves once no turn is registered on the thread. */
function whenFree(turns: LiveTurns<CallRow>, threadId: string): Promise<void> {
  if (!turns.has(threadId)) return Promise.resolve();
  return new Promise((resolve) => {
    const off = turns.listen((id) => {
      if (id !== threadId || turns.has(threadId)) return;
      off();
      resolve();
    });
  });
}

/** What the soul last said to this run in the thread, for the card's cover. */
function replyTo(threads: BookThreads, origin: BookOrigin, runId: string): string {
  const said = (threads.messages(origin.home, origin.threadId) ?? []).filter(
    (m) => m.role === "ai" && m.origin?.runId === runId,
  );
  return said[said.length - 1]?.text ?? "";
}

/** A stopped or failed turn keeps what it produced; a row that says nothing is not a row. */
function kept(rows: readonly CallRow[]): CallRow[] {
  return rows.filter((r) => r.role === "user" || r.text !== "" || (r.tools?.length ?? 0) > 0);
}

/**
 * Answer a bell in the book thread it came from, on the durable runtime. A
 * turn this bell started before a restart is waited for and never started
 * twice. A thread busy with another turn is waited for, and the bell's turn
 * starts once that one has landed. Null when the book is gone.
 */
export async function deliverBookBell(
  input: TurnDelivery,
  deps: BookBellDeps = appBellDeps(),
): Promise<TurnDeliveryOutcome | null> {
  const { origin } = input;
  if (origin.place !== "book") return null;
  const durable = await deps.durable();
  if (!durable) return { status: "failed", reason: "the turn runtime has not started" };
  const book: BookOrigin = { ...origin, home: origin.bookId };
  const { threadId, bookId, home } = book;
  const { runtime } = durable;
  const answered = (reply: string): TurnDeliveryOutcome => ({ status: "answered", reply, watching: deps.watching(book) });

  const conversation = await runtime.conversationFor(bookThreadKey(book), bookThreadOrigin(book), BACKGROUND_CONTEXT);
  const earlier = await bellTurn(runtime, conversation.id, input.bellId, BACKGROUND_CONTEXT);
  if (earlier) {
    input.onWait?.();
    const result = await earlier;
    if (result?.status === "done" || (result?.reason === "aborted" && result.landed)) {
      return answered(replyTo(deps.threads, book, input.runId));
    }
  }

  const drive = deps.drive ?? driveBookTurn;
  const s = input.settings;
  const providerId = s.defaultProviderId;
  const modelId = modelIdFor(s, "talk");
  if (!providerId || !modelId) return { status: "failed", reason: "no model is configured" };
  for (;;) {
    if (deps.turns.has(threadId)) input.onWait?.();
    await whenFree(deps.turns, threadId);
    const stored = deps.threads.messages(home, threadId) ?? [];
    const after = Math.max(deps.now(), ...stored.map((m) => m.ts));
    const placeholder: CallRow = { role: "ai", text: "", ts: after + 1, streaming: true };
    const controller = new AbortController();
    deps.turns.start({ threadId, bookId, home, controller, message: placeholder, rows: [placeholder], visiting: { after } });
    const show = (rows: CallRow[]) => {
      const live = deps.turns.get(threadId);
      if (live?.controller !== controller) return;
      const unsent = (live.unsent ?? []).filter((u) => !rows.some((r) => r.role === "user" && r.ts === u.ts));
      live.rows = [...(rows.length > 0 ? rows : [placeholder]), ...unsent];
      live.message = live.rows[live.rows.length - 1]!;
      deps.turns.touch(threadId);
    };
    // The reader's lines no run took go into the file where they were said. No
    // turn is started on them, as after a turn that was stopped.
    const end = async (rows: CallRow[], steers: readonly WithdrawnSteer[]) => {
      const live = deps.turns.get(threadId);
      const unsent = live?.controller === controller ? (live.unsent ?? []) : [];
      const said = steers.map((steer) => ({ text: steer.text, ts: steer.ts ?? deps.now() }));
      const owed = [...said, ...unsent.filter((u) => !said.some((x) => x.ts === u.ts))]
        .filter((line) => !rows.some((r) => r.role === "user" && r.ts === line.ts))
        .sort((a, b) => a.ts - b.ts);
      for (const line of owed) deps.threads.append(home, threadId, { role: "user", text: line.text, ts: line.ts });
      if (owed.length > 0) await deps.threads.flush();
      if (live?.controller === controller) {
        live.rows = [...rows, ...owed.map((line): CallRow => ({ role: "user", text: line.text, ts: line.ts }))];
        deps.turns.touch(threadId);
      }
      deps.turns.settle(threadId, controller)?.onSettled?.();
    };

    const placed = await deps.open({ origin, settings: s, bell: input.bell, signal: controller.signal });
    if (!placed) {
      await end([], []);
      return null;
    }
    if (controller.signal.aborted || placed.turn.refusal) {
      await end([], []);
      return { status: "failed", reason: placed.turn.refusal ?? "stopped" };
    }
    const { history } = splitAssembled(placed.turn.messages);
    const byName = new Map(placed.turn.tools.map((tool) => [tool.name, tool]));
    const thinkingLevel = toReasoning(s.chatThinking);
    // Subscribed before the turn is tried, so a busy turn that lands meanwhile is not missed.
    let landedHere!: () => void;
    const landed = new Promise<void>((resolve) => (landedHere = resolve));
    const off = durable.onTurnSettled((event) => {
      if (event.conversationId === conversation.id) landedHere();
    });
    let finished: BookTurnEnd;
    try {
      const driven = await drive(
        durable,
        {
          origin: book,
          line: { text: input.bell },
          bell: { id: input.bellId, runId: input.runId },
          systemPrompt: placed.turn.systemPrompt,
          history,
          tools: placed.turn.tools,
          model: { provider: providerId, modelId },
          ...(thinkingLevel ? { thinkingLevel } : {}),
          telemetry: { surface: "bell" },
          describe: (name, args) => {
            const tool = byName.get(name);
            if (!tool) return { label: name };
            return { label: toolLabel(tool, args as Record<string, unknown>), ...(tool.quiet ? { quiet: true as const } : {}) };
          },
        },
        show,
      );
      const live = deps.turns.get(threadId);
      if (live?.controller !== controller) {
        driven.stop();
      } else {
        live.durable = { steer: driven.steer, stop: driven.stop };
        // Lines said while the turn was being assembled go in now.
        for (const row of live.unsent ?? []) {
          void driven.steer(row.text, row.ts).then(
            (taken) => {
              if (taken) live.unsent = (live.unsent ?? []).filter((u) => u !== row);
            },
            () => {},
          );
        }
      }
      finished = await driven.ended;
    } catch (e) {
      await end([], []);
      if (!(e instanceof TurnBusy)) {
        off();
        return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
      }
      // A turn resumed after a restart is running or landing here with no row of anyone's.
      input.onWait?.();
      await landed;
      off();
      continue;
    }
    off();

    if (finished.kind === "stalled") {
      await end([], finished.steers);
      return { status: "failed", reason: "the answer stalled" };
    }
    const rows = kept(finished.rows);
    await end(rows, finished.kind === "stopped" ? finished.steers : []);
    const reply = [...rows].reverse().find((r) => r.role === "ai")?.text ?? "";
    if (finished.kind === "answered") return answered(reply);
    if (finished.kind === "stopped" && rows.some((r) => r.role === "ai")) return answered(reply);
    return { status: "failed", reason: finished.kind === "stopped" ? "stopped" : finished.message };
  }
}

/** Say that a run delegated from a book is answered in that book. The undo is for tests. */
export function registerBookDelivery(): () => void {
  const opener = registerDelivery("book", openBookDelivery);
  const turns = registerTurnDelivery("book", (input) => deliverBookBell(input));
  return () => {
    opener();
    turns();
  };
}
