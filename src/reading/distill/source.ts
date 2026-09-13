// What reading gives distillation to read (docs/58).
//
// The conversations held over a book, the marks left in it, the retells, the
// talks and the transcripts of rehearsing one: every kind reading writes that
// says something about the reader. Each is registered as a source, so the sweep
// applies one cursor rule and one threshold to all of them and memory never has
// to know what a book or a retell is.
//
// The registration is the direction the layering requires: memory is a
// capability and may not import reading, so reading hands its material over at
// startup (bootDomains), exactly as info does with its briefings.
//
// A directory of its own because it reads every corner of reading — the shelf,
// the retells, the talks, the rehearsals — and those corners reach back into
// reading/ for the desk. Sitting in reading/ itself would be a cycle
// (tests/layering.test.ts); nothing imports this but the shell.

import {
  distillUnits,
  pagelessMarkIds,
  registerDistillSource,
  toDistillAnnotations,
  type DistillMessage,
  type SourceUnit,
} from "../../memory";
import { peekAnnotations } from "../../platform/app/annotations";
import { peekThreads } from "../../platform/app/threads";
import { listTopics } from "../../platform/app/topics";
import { listAllRehearsals, loadRehearsalRuns, loadRunPages } from "../rehearsal/store";
import { listAllRetells, retellThreadKey } from "../retell/store";
import { listAllTalkOutlines, talkThreadKey } from "../talk/store";

// One book on a topic's shelf: the id its files and cursors are keyed by, the
// name a pass calls it, and the topic it sits under.
interface Shelved {
  bookId: string;
  bookName: string;
  topicId: string;
}

// Every book the topics list, deduplicated. A book listed on two topics is read
// once per topic: its marks and its conversations are the same file, but what a
// pass writes is filed under the topic it was swept for.
async function shelved(): Promise<Shelved[]> {
  const out: Shelved[] = [];
  for (const topic of await listTopics()) {
    const seen = new Set<string>();
    for (const file of topic.files) {
      const bookId = file.hash;
      // A book the topic lists but has never opened has no id yet, so there is
      // nothing on disk for it to owe.
      if (!bookId || seen.has(bookId)) continue;
      seen.add(bookId);
      out.push({ bookId, bookName: file.name, topicId: topic.id });
    }
  }
  return out;
}

/** Every conversation held over a book, as the units a pass runs on. */
export async function listReadingUnits(): Promise<SourceUnit[]> {
  const units: SourceUnit[] = [];
  for (const { bookId, bookName, topicId } of await shelved()) {
    const marks = toDistillAnnotations(await peekAnnotations(bookId).catch(() => []));
    const byId = new Map(marks.map((m) => [m.id, m]));
    // By unit, not by thread: a chat-span aside's transcript is part of its
    // parent's (distillUnits), so it is neither offered as a pass of its own nor
    // left out of what the parent owes.
    const stored = await peekThreads(bookId).catch(() => []);
    for (const unit of distillUnits(stored, pagelessMarkIds(marks))) {
      const anchor = byId.get(unit.annotationId);
      units.push({
        cursor: "distilledMessages",
        id: unit.threadId,
        topicId,
        label: bookName,
        bookId,
        annotationId: unit.annotationId,
        // The book-level thread has no mark and so no page of its own; the sweep
        // has no current page to stand in for it either.
        page: anchor?.page ?? null,
        markedText: anchor?.text ?? "",
        messages: unit.messages,
        parts: unit.parts,
        // The book's marks travel with the conversation so the transcript pass
        // can fold in the silent ones on the way past (docs/02 part 2).
        marks,
      });
    }
  }
  return units;
}

/** Every book's marks, as one unit per book. */
export async function listMarkUnits(): Promise<SourceUnit[]> {
  const units: SourceUnit[] = [];
  for (const { bookId, bookName, topicId } of await shelved()) {
    const marks = toDistillAnnotations(await peekAnnotations(bookId).catch(() => []));
    if (marks.length === 0) continue;
    units.push({ cursor: "distilledMarks", id: bookId, topicId, label: bookName, marks });
  }
  return units;
}

function plain(
  messages: readonly { id?: string; role: "user" | "ai"; text: string; ts: number }[],
): DistillMessage[] {
  return messages.map(({ id, role, text, ts }) => ({ ...(id ? { id } : {}), role, text, ts }));
}

/**
 * Every retell conversation. It carries its own pass (docs/31): the retell asks
 * a different question of the same shape of transcript, and the source is where
 * docs/58 puts that choice.
 */
export async function listRetellUnits(): Promise<SourceUnit[]> {
  const units: SourceUnit[] = [];
  for (const retell of await listAllRetells()) {
    const materials = retell.materials.map((m) => m.title);
    for (const thread of await peekThreads(retellThreadKey(retell.id)).catch(() => [])) {
      if (thread.messages.length === 0) continue;
      units.push({
        cursor: "distilledMessages",
        id: thread.id,
        topicId: retell.topicId,
        label: retell.name,
        messages: plain(thread.messages),
        retell: { retellId: retell.id, retellName: retell.name, materials },
      });
    }
  }
  return units;
}

/** Every conversation held over a talk's outline. */
export async function listTalkUnits(): Promise<SourceUnit[]> {
  const units: SourceUnit[] = [];
  for (const outline of await listAllTalkOutlines()) {
    for (const thread of await peekThreads(talkThreadKey(outline.id)).catch(() => [])) {
      if (thread.messages.length === 0) continue;
      units.push({
        cursor: "distilledMessages",
        id: thread.id,
        topicId: outline.topicId,
        label: outline.name,
        messages: plain(thread.messages),
      });
    }
  }
  return units;
}

/**
 * Every rehearsal transcript, one unit per pass.
 *
 * The reader speaking is the whole material, so a page becomes one message in
 * their own voice, timed by when they reached it. A pass with nothing said is
 * left out rather than distilled into nothing. The unit id is the run's, which
 * is a UUID (RehearsalView) and so keys distilledMessages safely.
 */
export async function listRehearsalUnits(): Promise<SourceUnit[]> {
  const units: SourceUnit[] = [];
  for (const rehearsal of await listAllRehearsals()) {
    const log = await loadRehearsalRuns(rehearsal.id).catch(() => null);
    for (const entry of log?.runs ?? []) {
      if (entry.wordsSpoken === 0) continue;
      const pages = await loadRunPages(entry).catch(() => []);
      const messages: DistillMessage[] = [];
      for (const page of pages) {
        const said = page.transcript.trim();
        if (said === "") continue;
        messages.push({ role: "user", text: said, ts: page.enteredAt });
      }
      if (messages.length === 0) continue;
      units.push({
        cursor: "distilledMessages",
        id: entry.id,
        topicId: rehearsal.topicId,
        label: rehearsal.name,
        messages,
      });
    }
  }
  return units;
}

/**
 * Register everything reading writes that distillation reads. Called by the
 * shell on the way up (useShellBootstrap's bootDomains); the undo is for tests.
 */
export function registerReadingDistillSources(): () => void {
  const undo = [
    registerDistillSource({
      kind: "reading-thread",
      listUnits: listReadingUnits,
      cursor: "distilledMessages",
      // Nothing is reclaimed: the reader reopens any of these from the shelf
      // (docs/58).
      afterEnd: "keep",
    }),
    registerDistillSource({
      kind: "annotations",
      listUnits: listMarkUnits,
      cursor: "distilledMarks",
      afterEnd: "keep",
    }),
    registerDistillSource({
      kind: "retell-thread",
      listUnits: listRetellUnits,
      cursor: "distilledMessages",
      afterEnd: "keep",
    }),
    registerDistillSource({
      kind: "talk-thread",
      listUnits: listTalkUnits,
      cursor: "distilledMessages",
      afterEnd: "keep",
    }),
    registerDistillSource({
      kind: "rehearsal-run",
      listUnits: listRehearsalUnits,
      cursor: "distilledMessages",
      // docs/58 has the transcript going to a cold layer once it is distilled.
      // Recorded only: nothing moves anything yet.
      afterEnd: "cold",
    }),
  ];
  return () => {
    for (const u of undo) u();
  };
}
