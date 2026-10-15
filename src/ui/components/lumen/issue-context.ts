// The brief open in the reader, as Lumen's conversation sees it (docs/info/88
// 「简报的对话」). Whichever reader holds an issue publishes it here, the way a
// screen publishes what a voice call would be about (voice-context.ts), and the
// corner and the door read it: the door comes up when an issue is opened, the
// door's turn lays the issue on the desk and notes where the reader is, a
// citation tapped in the door takes the reader to the passage, and an Ask on a
// selection in the issue lands in the door with the passage above the composer.
//
// The store and the decisions are here; the readers publish and the corner
// renders.

import { useEffect, useState } from "react";

import type { DeskRef } from "../../../desk";
import type { Fulltext } from "../../../fulltext/types";
import type { Annotation } from "../../../platform/app/reader-contract";
import type { Citation } from "../../../reading/prep/anchors";
import { issueHighlights, issueTurnNote, pageOfQuote } from "../../../reading/issue";
import { ISSUE_DESK_KIND, type IssueDeskRef } from "../../../reading/issue-desk";
import { splitQuotedQuestion } from "../chat/quoted-question";

export interface OpenIssue {
  bookId: string;
  title: string;
  /** Where the reader is, 1-based, read when a turn is assembled; null before the view reports. */
  where(): { page: number | null; pageCount: number | null };
  /** The issue's extracted text. */
  fulltext(): Promise<Fulltext | null>;
  /** Every mark on the issue now. */
  marks(): readonly Annotation[];
  /** Take the reader to a page (0-based), marking the quote on it when there is one. */
  jump(pageIndex: number, quote?: string): void;
}

/** A passage the reader selected in the issue and asked about. */
export interface IssueQuote {
  text: string;
}

let current: OpenIssue | null = null;
const listeners = new Set<() => void>();
const askers = new Set<(quote: IssueQuote) => void>();

/** Publish the issue a reader has open. Returns the undo. */
export function publishOpenIssue(issue: OpenIssue): () => void {
  current = issue;
  for (const listener of [...listeners]) listener();
  return () => {
    if (current !== issue) return;
    current = null;
    for (const listener of [...listeners]) listener();
  };
}

export function getOpenIssue(): OpenIssue | null {
  return current;
}

export function subscribeOpenIssue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The issue open now, re-read whenever one is published or put away. */
export function useOpenIssue(): OpenIssue | null {
  const [issue, setIssue] = useState<OpenIssue | null>(getOpenIssue);
  useEffect(() => {
    setIssue(getOpenIssue());
    return subscribeOpenIssue(() => setIssue(getOpenIssue()));
  }, []);
  return issue;
}

/** An Ask on a selection in the issue: the passage goes to Lumen's conversation. */
export function askLumen(quote: IssueQuote): void {
  const text = quote.text.replace(/\s+/g, " ").trim();
  if (!text) return;
  for (const asker of [...askers]) asker({ text });
}

export function subscribeAskLumen(asker: (quote: IssueQuote) => void): () => void {
  askers.add(asker);
  return () => {
    askers.delete(asker);
  };
}

/** Test seam: the module is a singleton and a test is not. */
export function resetIssueContext(): void {
  current = null;
  listeners.clear();
  askers.clear();
}

/**
 * Whether a publish is an issue being opened, which brings the door up: a new
 * issue, not the same one published again. `shownFor` is the issue the door
 * last came up for, cleared when the issue is put away.
 */
export function opensDoor(shownFor: string | null, issue: OpenIssue | null): boolean {
  return issue !== null && issue.bookId !== shownFor;
}

/**
 * What the door's turn lays on the desk and notes on the reader's line while an
 * issue is open: the issue as material, and where the reader is in it. Nothing
 * of either with no issue open.
 */
export async function issueDoorTurn(
  issue: OpenIssue | null,
  line: string,
): Promise<{ desk: DeskRef<string, IssueDeskRef>[]; note: string }> {
  if (!issue) return { desk: [], note: "" };
  const fulltext = await issue.fulltext().catch(() => null);
  const { page, pageCount } = issue.where();
  const { quote } = splitQuotedQuestion(line);
  return {
    desk: [{ kind: ISSUE_DESK_KIND, ref: { bookId: issue.bookId, title: issue.title, fulltext } }],
    note: issueTurnNote({
      title: issue.title,
      page,
      pageCount,
      highlights: issueHighlights(issue.marks()),
      quotes: quote !== null,
      quotePage: quote !== null ? pageOfQuote(fulltext, quote) : null,
    }),
  };
}

/**
 * The conversation as the model is handed it: the app's note put on the end of
 * the reader's last line. Only this copy carries it; the rows on screen and
 * the thread file keep the line as it was said.
 */
export function noteOnLastLine<T extends { role: string; text: string }>(history: readonly T[], note: string): T[] {
  const latest = history[history.length - 1];
  if (!note || !latest || latest.role !== "user") return [...history];
  return [...history.slice(0, -1), { ...latest, text: latest.text + note }];
}

/**
 * What a citation tapped in the door does: with an issue open, a page citation
 * puts the door away and takes the reader to the passage. Anything else, or no
 * issue open, does nothing.
 */
export function doorCitationJump(
  c: Citation,
  issueOpen: boolean,
): { pageIndex: number; quote?: string } | null {
  if (!issueOpen || c.kind !== "page") return null;
  return c.quote ? { pageIndex: c.page - 1, quote: c.quote } : { pageIndex: c.page - 1 };
}
