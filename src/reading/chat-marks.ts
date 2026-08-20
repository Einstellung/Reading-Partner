// Marks drawn on the classroom's replies (docs/09). The AI's answers are the
// book continued, so the two pens work on them exactly as they do on a page,
// and what they leave behind is an ordinary entry in annotations-<bookId>.json
// — anchored on a message instead of a page (platform/app/reader-contract.ts:
// ChatAnchor), sharing the book's trace list and its distillation.
//
// Pure: where a mark's words land in a rendering, which marks belong to a
// message, the order the trace list shows them in, and the entry a pen creates.
// Nothing here goes near the engine — a chat mark must never reach it
// (reader-contract.ts: pageMarks).

import {
  chatAnchorOf,
  chatMarks,
  pageMarks,
  type Annotation,
  type ChatAnchor,
  type MarkPen,
} from "../platform/app/reader-contract";

// A mark's words located in a rendering: [start, end) in code units.
export interface ChatMarkSpan {
  start: number;
  end: number;
}

// The part of a chat row this decides on.
export interface MarkableRow {
  role: "user" | "ai";
  text: string;
  streaming?: boolean;
  failed?: boolean;
}

// Whether a pen may be drawn across this row.
//
// Only a settled reply. While one streams, every delta rebuilds the row and
// re-parses the partial Markdown, so a Range into it is dead within a frame —
// and an anchor taken against half a sentence names words the finished reply
// may not have. A failed row is the app's words standing in for a reply, not
// the model's, and the reader's own message is not the book continued.
//
// How deep the conversation is does not come into it: the two underlines and
// the highlight work on a reply wherever it is (docs/09). Which pens are on
// offer is the shell's — the AI pen is dark inside an aside, because that would
// be a third level — and by the time a draw reaches here it has been decided.
export function mayMarkReply(row: MarkableRow): boolean {
  if (row.role !== "ai") return false;
  if (row.streaming || row.failed) return false;
  return row.text.trim() !== "";
}

// Occurrences are counted overlapping (the scan steps one character, not one
// needle), so every position a reader can select from is reachable by some
// occurrence number. Non-overlapping counting cannot name the middle "aa" of
// "aaa", and a mark that cannot be named is a mark that cannot be redrawn.

// Where a chat mark's words sit in the message as it renders now.
//
// `rendered` is the text the reader actually dragged over — the message with
// its Markdown syntax gone and its citations rewritten — not message.text,
// which the anchor was never taken against.
//
// Null when the words are not there at all: the reply was regenerated, or an
// edit took the sentence out. The mark stays in the file either way — it is
// still what the reader marked — it just has nowhere to be drawn.
//
// When the words are there but the copy the anchor names is not (the reply used
// to say it three times and now says it twice), the last copy is used rather
// than nothing. A repeated phrase losing one copy is not the sentence going
// away.
export function locateChatMark(
  rendered: string,
  anchor: Pick<ChatAnchor, "text" | "occurrence">,
): ChatMarkSpan | null {
  const needle = anchor.text;
  if (needle === "" || rendered === "") return null;
  let found = rendered.indexOf(needle);
  if (found < 0) return null;
  const wanted = Math.max(0, Math.trunc(anchor.occurrence));
  for (let n = 0; n < wanted; n++) {
    const next = rendered.indexOf(needle, found + 1);
    if (next < 0) break;
    found = next;
  }
  return { start: found, end: found + needle.length };
}

// Which copy of `text` in `rendered` the one starting at `start` is, 0-based —
// what the pen stores in the anchor's `occurrence`. -1 when `start` does not
// begin those words at all, which is the caller's signal that it has read the
// selection off something other than this rendering.
export function occurrenceAt(rendered: string, text: string, start: number): number {
  if (text === "" || start < 0) return -1;
  if (rendered.slice(start, start + text.length) !== text) return -1;
  let n = 0;
  for (let at = rendered.indexOf(text); at >= 0 && at < start; at = rendered.indexOf(text, at + 1)) {
    n++;
  }
  return n;
}

// The marks drawn on one message, in the order they were saved. The prompt side
// wants this one: it needs to know which passages of a reply were marked, not
// where they are on screen.
export function chatMarksOn(
  annotations: readonly Annotation[],
  threadId: string,
  messageTs: number,
): Annotation[] {
  return annotations.filter((a) => {
    const anchor = chatAnchorOf(a);
    return anchor !== null && anchor.threadId === threadId && anchor.messageTs === messageTs;
  });
}

// A mark plus the anchor it was read from and where it landed.
export interface LocatedChatMark {
  annotation: Annotation;
  anchor: ChatAnchor;
  span: ChatMarkSpan;
}

// Every mark on one message that can still be found in the rendering, earliest
// first. The ones whose words are gone are dropped — they stay in the file, they
// just have nothing to sit on now.
export function locateChatMarks(
  rendered: string,
  annotations: readonly Annotation[],
  threadId: string,
  messageTs: number,
): LocatedChatMark[] {
  const out: LocatedChatMark[] = [];
  for (const annotation of chatMarksOn(annotations, threadId, messageTs)) {
    const anchor = chatAnchorOf(annotation);
    if (!anchor) continue;
    const span = locateChatMark(rendered, anchor);
    if (!span) continue;
    out.push({ annotation, anchor, span });
  }
  out.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
  return out;
}

// The trace list's two groups (docs/09): what was drawn on the page first, in
// the order it already had, then what was drawn in the classroom. Interleaving
// them would put entries that jump nowhere — a chat mark has no page, and the
// conversation it was drawn in may since have been deleted — between entries
// that do.
export function orderTraceMarks(annotations: readonly Annotation[]): Annotation[] {
  return [...pageMarks(annotations), ...chatMarks(annotations)];
}

// A stroke the reader has just made, as the surface reports it: which reply,
// which words, and which copy of them. Everything else about the mark — its id,
// its color, the conversation it may open — is the shell's to decide.
export interface ChatMarkDraw {
  messageTs: number;
  // Verbatim out of the rendering, and the same string `occurrence` was counted
  // against.
  text: string;
  occurrence: number;
  pen: MarkPen;
}

export interface NewChatMark extends ChatMarkDraw {
  // The caller's id, so the mark can be handed to the store and to the thread
  // it opens in the same breath.
  id: string;
  color: string;
  threadId: string;
  // Set when the AI pen drew it, exactly as the page path sets it: the mark
  // carries the conversation it opened.
  aiThreadId?: string;
  now?: number;
}

// The annotation a pen leaves on a reply. Shaped like the ones the engine writes
// — same id, type, text, color and dateCreated — because everything downstream
// (the trace list, distillation, read_annotations) reads those fields and none
// of them should have to care which surface the mark was drawn on.
//
// Null when there are no words to anchor to. A mark that cannot be located is
// one the reader can never see again, so it is not written.
export function buildChatMark(input: NewChatMark): Annotation | null {
  if (input.text.trim() === "") return null;
  const stamp = new Date(input.now ?? Date.now()).toISOString();
  return {
    id: input.id,
    // The AI pen is the underline tool in a fixed purple on the page, and the
    // same stroke here.
    type: input.pen === "highlight" ? "highlight" : "underline",
    color: input.color,
    text: input.text,
    dateCreated: stamp,
    dateModified: stamp,
    ...(input.aiThreadId ? { aiThreadId: input.aiThreadId } : {}),
    chatAnchor: {
      threadId: input.threadId,
      messageTs: input.messageTs,
      text: input.text,
      occurrence: Math.max(0, Math.trunc(input.occurrence)),
      pen: input.pen,
    },
  };
}

// What a reply the reader has drawn on carries when it is replayed next turn
// (docs/09). The model wrote those words; which of them the reader kept is
// something only this note can tell it.
//
// Appended as a bracketed block at the end, never woven through the sentences.
// Replayed assistant messages are the model's own words and double as the shape
// it writes the next ones in, so a delimiter wrapped around a marked phrase is a
// syntax it starts emitting. A block after the reply, in brackets and naming the
// reader as the one who did it, reads as a note on the reply rather than as part
// of it — the same register as the page-window marker
// (reading/figures/page-window.ts).
//
// Whitespace inside a passage is collapsed so each one is one line and a mark
// spanning two paragraphs cannot break the block's shape. Nothing is truncated:
// the note rides its message and falls out of context with it (turn.ts:
// HISTORY_KEEP), so it needs no budget of its own.
const MARKED_BY_READER = "marked by the reader in this reply:";

export function chatMarkNote(marks: readonly Annotation[]): string {
  const seen = new Set<string>();
  for (const mark of marks) {
    const anchor = chatAnchorOf(mark);
    if (!anchor) continue;
    const text = anchor.text.replace(/\s+/g, " ").trim();
    // Two pens on the same sentence — a highlight and then the AI pen — is two
    // marks and one passage. Saying it twice would read as two.
    if (text !== "") seen.add(text);
  }
  const passages = [...seen].map((t) => `“${t}”`);
  if (passages.length === 0) return "";
  if (passages.length === 1) return `[${MARKED_BY_READER} ${passages[0]}]`;
  return `[${MARKED_BY_READER}\n${passages.join("\n")}]`;
}

// One replayed row's text, with the note on it when the reader marked it.
//
// Only a reply carries one: the pens work on the AI's answers, and the reader's
// own messages are not the book continued. Marks are matched by thread and
// message stamp alone — no rendering is needed here, because the note quotes the
// anchor's own words rather than pointing at a position in the text.
export function markedReplyText(
  row: { role: "user" | "ai"; text: string; ts: number },
  annotations: readonly Annotation[],
  threadId: string,
): string {
  if (row.role !== "ai") return row.text;
  const note = chatMarkNote(chatMarksOn(annotations, threadId, row.ts));
  if (note === "") return row.text;
  return row.text ? `${row.text}\n\n${note}` : note;
}
