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
  isChatMark,
  isPageMark,
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
// document order, then what was drawn in the classroom, in the order it was
// saved. Interleaving them would put entries that jump nowhere — a chat mark has
// no page, and the conversation it was drawn in may since have been deleted —
// between entries that do.
export type TraceGroupKey = "page" | "chat";

export interface TraceGroup<T> {
  key: TraceGroupKey;
  marks: T[];
}

// sortIndex is the engine's document-order key (reading/engine/convert.ts) and
// lexicographic order is document order. A chat mark has none — it was drawn
// where there is no page — which is why the key alone cannot order the list:
// the empty string sorts before every page's. The two groups are separated
// first and only the page one is keyed.
function inDocOrder<T>(marks: T[]): T[] {
  const key = (m: T): string => {
    const raw = (m as { sortIndex?: unknown }).sortIndex;
    return typeof raw === "string" ? raw : "";
  };
  return marks.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// The list as it is shown, grouped. This is the one place its order is decided:
// the shell keeps a flat copy for everything else that reads marks, and the list
// component groups the same annotations through here, so the two cannot
// disagree. An empty group is not a group — it would be a heading over nothing.
// `id` is in the constraint so the parameter is not a weak type: an Annotation
// declares no `chatAnchor` of its own — files written before chat marks existed
// have none — and a constraint of nothing but optional fields would have TS
// reject every caller for sharing no property with it.
export function traceGroups<T extends { id: string; chatAnchor?: unknown }>(
  annotations: readonly T[],
): TraceGroup<T>[] {
  const groups: TraceGroup<T>[] = [
    { key: "page", marks: inDocOrder(annotations.filter(isPageMark)) },
    { key: "chat", marks: annotations.filter(isChatMark) },
  ];
  return groups.filter((g) => g.marks.length > 0);
}

export function orderTraceMarks(annotations: readonly Annotation[]): Annotation[] {
  return traceGroups(annotations).flatMap((g) => g.marks);
}

// The marks a set of conversations takes with it when it is deleted: the ids of
// the page marks hosting them, and only those. A mark drawn on a reply may carry
// an aiThreadId too — the AI pen opens a side conversation off a reply exactly
// as it does off a passage — but the mark itself is the reader's on the book
// continued (docs/09), so deleting that conversation leaves it in annotations
// and in the trace list, the same way the highlight pen's mark on the same reply
// is left. What it loses is its door.
export function hostMarkIds(
  annotations: Iterable<Annotation>,
  threadIds: readonly string[],
): string[] {
  const wanted = new Set(threadIds);
  const ids: string[] = [];
  for (const a of annotations) {
    if (isChatMark(a)) continue;
    if (typeof a.aiThreadId === "string" && wanted.has(a.aiThreadId)) ids.push(a.id);
  }
  return ids;
}

// Whether a mark's door still leads anywhere, and where. `hasThread` is the
// caller's lookup into the conversations this device holds.
//
// A mark carries the id of the conversation it opened; the conversations live in
// another file, and the two sync apart. So a device can hold a mark whose
// conversation another device deleted, and the id alone is not the door. Opening
// a call on it would make a conversation with no aside frame, no history and no
// way back — and the first message sent in it would be written down as a root of
// its own. What such a mark has left to show is the words it was drawn on.
// `id` is in the shape for the same reason traceGroups takes it: a parameter of
// nothing but optional fields is a weak type, and TS rejects every caller for
// sharing no property with it.
export function markDoorThread(
  ann: { id: string; aiThreadId?: unknown } | null | undefined,
  hasThread: (threadId: string) => boolean,
): string | null {
  const opened = ann?.aiThreadId;
  if (typeof opened !== "string" || opened === "") return null;
  return hasThread(opened) ? opened : null;
}

// What the door on a trace row does (docs/09): the sparkle button beside a mark
// that opened a conversation.
//
// `jump` is whether the engine may be pointed at the mark — it may not be
// pointed at one with no page, which it has never heard of and which would have
// it look for a page that does not exist. `threadId` is the conversation to
// open, null when this device no longer holds it, in which case the row still
// shows the words that were marked and there is nothing to open beside them.
export interface MarkOpen {
  jump: boolean;
  threadId: string | null;
}

export function markOpenAction(
  ann: Annotation | null | undefined,
  hasThread: (threadId: string) => boolean,
): MarkOpen {
  return { jump: isPageMark(ann), threadId: markDoorThread(ann, hasThread) };
}

// What pressing a row of the trace list does.
//
// A page mark jumps to its page, whether or not it also opened a conversation:
// the row is the jump and the sparkle button beside it is the door. A classroom
// mark is on no page — the engine has never heard of it, and asking it to
// navigate names a page that does not exist — so the row is a door instead: into
// the side conversation the mark made, or failing that into the lesson it was
// drawn in. With neither left, the row itself is the only place those words are
// shown, and the caller must leave the list open around it rather than close the
// drawer onto nothing.
export type TraceSelect =
  | { act: "page" }
  | { act: "thread"; threadId: string }
  | { act: "mark" };

export function traceSelectAction(
  ann: Annotation | null | undefined,
  hasThread: (threadId: string) => boolean,
): TraceSelect {
  // An id the shell no longer has an entry for reads as a page mark here, which
  // is what it did before there were two kinds: the engine answers it or does
  // nothing.
  if (isPageMark(ann)) return { act: "page" };
  const opened = markDoorThread(ann, hasThread);
  if (opened) return { act: "thread", threadId: opened };
  const room = chatAnchorOf(ann)?.threadId;
  if (room && hasThread(room)) return { act: "thread", threadId: room };
  return { act: "mark" };
}

// A stroke the reader has just made, as the surface reports it: which reply,
// which words, and which copy of them. Everything else about the mark — its id,
// its color, the conversation it may open — is the shell's to decide.
export interface ChatMarkDraw {
  messageTs: number;
  // Verbatim out of the rendering, and the same string `occurrence` was counted
  // against.
  text: string;
  // The same words for a person to read: the rendering runs one block's words
  // straight into the next one's, which is right for finding a mark again and
  // wrong everywhere the words are shown (chat-mark-dom.ts: spacedSlice).
  // Absent when the stroke stayed inside one block, which is most of them.
  display?: string;
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
    // The readable string, and the verbatim one under chatAnchor: `text` is what
    // the trace list draws, what read_annotations reports and what the note
    // quotes back, and none of those may show two blocks run together.
    text: input.display?.trim() ? input.display : input.text,
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

// A drag that a pen took as a stroke ends pointerup → mouseup → click, with the
// mark already written and painted by the time the click lands — so the click
// falls on words that now carry a mark and reads as a press on one. Nothing
// else tells the two apart: the pen drops the selection as it commits, which is
// what keeps WebKit's callout bar off the marked words, and an empty selection
// is what a plain tap has too.
//
// So the stroke says it happened, and the one click that follows is spent on
// saying so. A gesture beginning clears whatever the last one left, because a
// touch that never produces a click — the reader draws and lifts, and the
// browser sends none — must not leave the next tap swallowed.
export interface StrokeGate {
  // A pointer went down: a new gesture, and the last one's tail is not coming.
  began(): void;
  // A stroke was taken as the pointer came up.
  drew(): void;
  // Whether the click arriving now is that stroke's own tail. Asking spends it:
  // one stroke swallows one click.
  closesAStroke(): boolean;
}

export function createStrokeGate(): StrokeGate {
  let armed = false;
  return {
    began: () => {
      armed = false;
    },
    drew: () => {
      armed = true;
    },
    closesAStroke: () => {
      const was = armed;
      armed = false;
      return was;
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
    // The mark's own words as they read, falling back to the anchor's for an
    // entry written before the two were told apart.
    const shown = typeof mark.text === "string" && mark.text.trim() !== "" ? mark.text : anchor.text;
    const text = shown.replace(/\s+/g, " ").trim();
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
