// Lumen's first words when a brief is opened (docs/info/88 「简报的对话」): the
// program's line (the date, how many items), Lumen's judgement written when the
// issue was assembled (opening-record.ts) with its item numbers turned into
// page citations of the items' headings, and up to three questions saved up
// for the reader, each a card with quick answers (question-card.ts).
//
// Said once per issue, on any device: `info-issue-spoken.json` (synced,
// records-merged on the book id) is written before anything is said, so a
// second opening — here, or on another device once synced — finds it and says
// nothing. Losing the opening to a crash between the two is better than
// saying it twice.
//
// The door calls this once the day's conversation is loaded for an issue that
// was just opened (ui/components/companion/use-door-chat.ts); the rows land through
// the thread store, which the open conversation listens to.

import { formatDateTime, t } from "../../i18n";
import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { doorKey } from "../../soul";
import { appendMessage, type ThreadMessage } from "../../platform/app/threads";
import type { IssueOpeningRecord } from "./opening-record";
import { questionCard } from "./question-card";
import { INFO_SHELF_FILE, parseShelf, type IssueEntry } from "./types";

export const SPOKEN_FILE = "info-issue-spoken.json";

export interface IssueOpening {
  /** The issue opened. */
  bookId: string;
  /** The day's conversation at the door it speaks into (soul/door.ts). */
  date: string;
  threadId: string;
  /** The page (1-based) an item's heading is on in the open book; absent or null: not known. */
  pageOf?: (heading: string) => number | null;
}

export interface SpokenFile {
  version: 1;
  issues: Record<string, { at: number; date: string; threadId: string }>;
}

export function parseSpoken(text: string | null): SpokenFile {
  if (!text) return { version: 1, issues: {} };
  try {
    const v = JSON.parse(text) as Partial<SpokenFile>;
    return { version: 1, issues: v.issues && typeof v.issues === "object" ? v.issues : {} };
  } catch {
    return { version: 1, issues: {} };
  }
}

function citeOf(heading: string, page: number | null | undefined): string {
  return page ? `[p.${page} "${heading.replace(/"/g, "'")}"]` : `“${heading}”`;
}

/** The opening's words: the program's line, then Lumen's, items as page citations where the page is known. */
export function openingText(entry: Pick<IssueEntry, "date" | "items">, record: IssueOpeningRecord | undefined, pageOf?: (heading: string) => number | null): string {
  const day = formatDateTime(new Date(`${entry.date}T12:00:00`), { month: "short", day: "numeric" });
  const fact = t("info.issue.openingFact", { date: day, count: String(entry.items) });
  if (!record?.text) return fact;
  const heading = new Map(record.items.map((i) => [i.n, i.heading]));
  const said = record.text.replace(/\[(\d+)\]/g, (whole, n: string) => {
    const h = heading.get(Number(n));
    return h ? citeOf(h, pageOf?.(h)) : whole;
  });
  return `${fact} ${said}`;
}

/** The rows the opening adds to the day's conversation: Lumen's words, then a card per question. */
export function openingMessages(entry: IssueEntry, pageOf: IssueOpening["pageOf"], now: number): ThreadMessage[] {
  const words: ThreadMessage = { role: "ai", text: openingText(entry, entry.opening, pageOf), ts: now };
  const cards: ThreadMessage[] = (entry.opening?.questions ?? []).map((q, i) => ({
    role: "ai",
    text: "",
    ts: now + 1 + i,
    parts: [{ type: "card", id: `issue-q-${entry.bookId.slice(0, 8)}-${q.id}`, card: { ...questionCard(entry.bookId, q) } }],
  }));
  return [words, ...cards];
}

export interface OpeningDeps {
  readShelf(): Promise<string | null>;
  readSpoken(): Promise<string | null>;
  writeSpoken(text: string): Promise<void>;
  append(date: string, threadId: string, message: ThreadMessage): void;
  now(): number;
}

const speaking = new Set<string>();

/** Say the opening unless it was said already. True when it was said now. */
export async function speakOpening(deps: OpeningDeps, opening: IssueOpening): Promise<boolean> {
  if (speaking.has(opening.bookId)) return false;
  speaking.add(opening.bookId);
  try {
    const entry = parseShelf(await deps.readShelf()).issues.find((i) => i.bookId === opening.bookId);
    if (!entry) return false;
    const spoken = parseSpoken(await deps.readSpoken());
    if (spoken.issues[opening.bookId]) return false;
    const now = deps.now();
    spoken.issues[opening.bookId] = { at: now, date: opening.date, threadId: opening.threadId };
    await deps.writeSpoken(`${JSON.stringify(spoken, null, 2)}\n`);
    for (const m of openingMessages(entry, opening.pageOf, now)) deps.append(opening.date, opening.threadId, m);
    return true;
  } finally {
    speaking.delete(opening.bookId);
  }
}

const read = async (path: string) => ((await appData.exists(path)) ? await appData.readText(path) : null);

const liveDeps: OpeningDeps = {
  readShelf: () => read(INFO_SHELF_FILE),
  readSpoken: () => read(SPOKEN_FILE),
  writeSpoken: (text) => writeTextAtomic(SPOKEN_FILE, text),
  append: (date, threadId, message) => void appendMessage(doorKey(date), threadId, message),
  now: () => Date.now(),
};

export async function speakIssueOpening(opening: IssueOpening): Promise<void> {
  await speakOpening(liveDeps, opening);
}

/**
 * The headings of an issue's items, entries then Notes, as its opening record
 * names them; none for an issue made before the record, or not on the shelf.
 */
export function issueHeadingsIn(shelf: string | null, bookId: string): string[] {
  const entry = parseShelf(shelf).issues.find((i) => i.bookId === bookId);
  return entry?.opening?.items.map((i) => i.heading) ?? [];
}

/** The headings of the issue with this book id, read off the shelf on disk. */
export async function issueHeadings(bookId: string): Promise<string[]> {
  return issueHeadingsIn(await liveDeps.readShelf(), bookId);
}
