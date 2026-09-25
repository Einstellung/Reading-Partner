// What shape of conversation a reading turn is taken on (reading/desk.ts):
// which of the three doors it came in by, which page it is about, the passage
// in the prompt's anchor slot and how a page is cited. Pure: the thread records
// are read by the caller.

import { annotationPage } from "./context";
import { isPageMark, type Annotation } from "../platform/app/reader-contract";
import { threadKind, type Thread, type ThreadKind } from "../platform/app/threads";

// As much of the open book as the frame is read from (reading/desk.ts's
// BookDeskRef satisfies it).
export interface FrameRef {
  // The AI-pen mark hosting this thread; empty for the book-level thread and a
  // chat-span aside.
  annotationId: string;
  annotation: Annotation | undefined;
  // The supplement on screen, when one is.
  viewing?: { title: string } | null;
  context: { pageIndex: number | null };
}

export interface ThreadFrame {
  kind: ThreadKind;
  isBook: boolean;
  // The classroom and everything opened off it: the reader has read none of this
  // book (docs/09). It decides the prompt's opening and how much the reading
  // position counts for; only a mark-anchored thread is outside it.
  bookLevel: boolean;
  // Anchored on a page: a mark thread, and an aside drawn on the page.
  onMark: boolean;
  aside: { from: "chat" | "mark" } | null;
  // The reader's own page, 1-based.
  currentPage: number | null;
  // The page the turn is about: the marked passage's on a mark thread, the
  // reader's otherwise.
  page: number | null;
  selectionText: string;
  selectionComment: string | undefined;
  // What one page of the document on screen is cited as.
  pageAnchor: (page: number) => string;
}

// Which of the three doors this conversation came in by
// (platform/app/threads.ts). Whether a mark is hosting it is the caller's to
// say — it opened the conversation — and whether it hangs off another one is
// only on the record, so the two are read together through the one derivation.
// A thread the store has not got yet answers exactly as it did before asides
// existed.
export function threadFrame(
  ref: FrameRef,
  thread: Pick<Thread, "annotationId" | "book" | "parentThreadId" | "asideAnchor"> | undefined,
): ThreadFrame {
  const { annotationId, annotation: ann, viewing = null } = ref;
  const { pageIndex } = ref.context;
  const kind: ThreadKind = threadKind({ ...thread, annotationId });
  // Anchored on a page: a mark thread, and an aside drawn on the page. The
  // book-level thread's position is wherever the reader currently is, and so is
  // a chat-span aside's — its span came out of a reply, not out of a page.
  //
  // A mark drawn on a reply is not a page anchor either (docs/09). It has an
  // annotation like a drawn one and no page like a selected one, so what tells
  // the two apart is the mark and not the presence of an id.
  const onMark = annotationId !== "" && isPageMark(ann as Annotation | undefined);
  const aside: { from: "chat" | "mark" } | null =
    kind === "aside" ? { from: onMark ? "mark" : "chat" } : null;
  const currentPage = pageIndex !== null ? pageIndex + 1 : null;
  const page = onMark
    ? annotationPage(ann as { position?: { pageIndex?: number } } | undefined)
    : currentPage;
  // The passage in the prompt's anchor slot. A chat-span aside has no mark, so
  // it is the span the reader selected out of the reply, stored verbatim on the
  // thread (platform/app/threads.ts: never an offset).
  const markText = typeof ann?.text === "string" ? ann.text : "";
  const selectionText =
    aside?.from === "chat" ? thread?.asideAnchor?.text ?? markText : markText;
  const selectionComment = typeof ann?.comment === "string" ? ann.comment : undefined;
  // What one page of the document on screen is cited as: [p.12] in the book,
  // [Some Article p.4] in a supplement (docs/67).
  const pageAnchor = (p: number) => (viewing ? `[${viewing.title} p.${p}]` : `[p.${p}]`);
  return {
    kind,
    isBook: kind === "book",
    bookLevel: kind !== "mark",
    onMark,
    aside,
    currentPage,
    page,
    selectionText,
    selectionComment,
    pageAnchor,
  };
}
