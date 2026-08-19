// The open AI call (docs/03) as a value: which thread is on screen, where it is
// anchored, how big it is drawn, and the rows in it. One book has at most one
// call open; a turn can outlive it (reading/live-turns.ts owns that side).
//
// The row type is a parameter. What a reading row holds beyond text — staged
// images, the durable card parts a reopened thread carries — is the render
// layer's protocol (ui/components/chat/chatParts.ts), which a domain must not
// import, so the state is generic over it the same way live-turns.ts is. What is
// pinned here is only what the session itself reads and writes.

import type { CompressedImage } from "../ai/image-utils";
import type { AsideAnchor } from "../platform/app/threads";
import {
  appendRunningTool,
  relabelRunningTool,
  resolveToolStatus,
  type ToolStatus,
} from "../ai/tool-status";
import { holdsNoAnswer, refusalRow } from "../ai/turn-rows";

// Picture-in-picture (docs/03): the bubble by the mark, chat taking the whole
// window with reading shrunk to a corner card, and reading back with chat
// shrunk to a corner card.
export type CallView = "bubble" | "chat-main" | "chat-pip";

// The part of a chat row the session itself writes. A surface's row type extends
// this with whatever else it draws.
export interface CallRow {
  role: "user" | "ai";
  text: string;
  ts: number;
  // Display-form image bytes on a user row (persistence keeps filenames).
  images?: CompressedImage[];
  // The AI row currently being written, and the one whose turn failed.
  streaming?: boolean;
  failed?: boolean;
  // The transient tool-call trace above a streaming reply (M6). Never persisted.
  tools?: ToolStatus[];
  // What the turn left out to fit the context window (src/budget) — the app's
  // remark about the turn, not model output. Display-only, like the trace.
  notice?: string;
}

export interface CallState<M extends CallRow> {
  threadId: string;
  // The AI-pen mark hosting this call. Empty string for the book-level thread
  // (docs/03: top-bar AI button), flagged by `isBook`, and for a side
  // conversation pulled out of a chat message.
  annotationId: string;
  isBook?: boolean;
  // This conversation is a side one off another (docs/03), which the slot below
  // holds instead of it: what it was opened on, and where going back leads.
  // Never set together with `isBook` — an aside is never the lesson — and its
  // presence is what says the affordance that opens one must not be offered
  // again, which is how one level deep is enforced.
  aside?: {
    parentThreadId: string;
    // "chat" is a span pulled out of a reply, "mark" one drawn on the page while
    // the lesson ran (reading/aside.ts).
    from: "chat" | "mark";
    span: string;
    // The reply the span came out of. Held here rather than read back off the
    // record because a chat-span aside has no record until the reader asks
    // something in it — opening one has to cost nothing.
    anchor?: AsideAnchor;
    // The view the conversation this came off was in. Going back restores it: a
    // lesson left as the corner card while the reader read the page must not
    // come back as chat over that page.
    parentView?: CallView;
  };
  view: CallView;
  anchor: { x: number; y: number };
  messages: M[];
  // The last turn failed, so the surface offers a retry.
  error?: boolean;
}


// What a running turn does to the row it is writing. It is data rather than a
// closure because the same change is applied to two mirrors of that row: the one
// the live-turns registry holds (which keeps being written after the bubble is
// closed) and the one on screen. One function applies it, so the two cannot
// drift.
export type RowChange =
  // A chunk of the reply arrived.
  | { kind: "delta"; chunk: string }
  // A tool started. Any partial text goes with it: it is inter-round preamble,
  // and only the final answer is shown (M6).
  | { kind: "tool-start"; name: string; label: string }
  | { kind: "tool-end"; name: string; isError: boolean }
  // A running tool said something new about itself — one line, rewritten in
  // place (docs/25).
  | { kind: "tool-label"; name: string; label: string }
  // The answer landed. The trace goes except for the calls that failed, and the
  // budget notice rides the displayed row only (never persisted).
  | { kind: "answer"; text: string; notice?: string }
  // The model could not be reached: the words stand in for the reply, and Retry
  // is worth offering (ai/turn-rows.ts).
  | { kind: "error"; text: string }
  // The loop declined. The sentence is the app's, so it goes in `notice` and
  // never in `text`.
  | { kind: "refusal"; text: string }
  // The stop button: the half sentence stays, as a finished row.
  | { kind: "stopped"; text: string };

export function applyRowChange<M extends CallRow>(row: M, change: RowChange): M {
  switch (change.kind) {
    case "delta":
      return { ...row, text: row.text + change.chunk };
    case "tool-start":
      return {
        ...row,
        text: "",
        tools: appendRunningTool(row.tools, change.name, change.label),
      };
    case "tool-end": {
      const tools = resolveToolStatus(row.tools, change.name, change.isError);
      return tools ? { ...row, tools } : row;
    }
    case "tool-label": {
      const tools = relabelRunningTool(row.tools, change.name, change.label);
      return tools ? { ...row, tools } : row;
    }
    case "answer":
      return {
        ...row,
        text: change.text,
        streaming: undefined,
        failed: undefined,
        notice: change.notice,
        tools: (row.tools ?? []).filter((t) => t.state === "error"),
      };
    case "error":
      return {
        ...row,
        text: change.text,
        failed: true,
        streaming: undefined,
        notice: undefined,
        tools: undefined,
      };
    case "refusal":
      return { ...row, ...refusalRow(row, change.text) };
    case "stopped":
      return {
        ...row,
        text: change.text,
        streaming: undefined,
        failed: undefined,
        notice: undefined,
        tools: undefined,
      };
  }
}

// Everything that moves the call. Each one is a thing that happened, not a
// setter: the guards below are the rules, and they used to exist only as the
// emergent result of nineteen spread-updates in App.tsx.
export type CallAction<M extends CallRow> =
  // A conversation opened: a fresh AI-pen mark, a mark tapped, a thread opened
  // from the trace list, or the book-level thread.
  | { type: "opened"; call: CallState<M> }
  // Every way out of a call: the ✕, Escape, touching the book, deleting the
  // thread, opening another book, closing the reader.
  | { type: "closed" }
  // A mark was deleted from the trace list. Only a call anchored on that mark
  // goes with it.
  | { type: "closed-with-mark"; annotationId: string }
  // Chat takes the whole window: expanding the bubble, or tapping the chat
  // corner card.
  | { type: "chat-opened" }
  // The reader is wanted back, so chat shrinks to the corner card.
  | { type: "reading-uncovered" }
  // A thread's stored images finished loading, keyed by the row they belong to.
  | { type: "images-loaded"; threadId: string; images: Map<number, CompressedImage[]> }
  // A turn started on this thread: the row it will write is appended, and the
  // rows a fresh attempt replaces go.
  | { type: "turn-started"; threadId: string; row: M }
  // The running turn wrote something. `error` is set when what it wrote was a
  // failure worth retrying, and left alone otherwise.
  | { type: "row-changed"; threadId: string; ts: number; change: RowChange; error?: boolean }
  // A row that is not a turn's: the reader's own message.
  | { type: "row-appended"; threadId: string; row: M }
  // A row that belongs above the one a turn is writing: a card the model raised
  // mid-turn, which is about the answer being written and so goes before it.
  | { type: "row-inserted-before-last"; threadId: string; row: M }
  // A finished row rewritten wholesale. What editing a card in place looks like
  // from here: the reducer does not know what a card is, only that the row it
  // sits on now reads differently.
  | { type: "row-replaced"; threadId: string; ts: number; row: M }
  // A turn stopped before writing anything, so its row is not a row.
  | { type: "row-dropped"; threadId: string; ts: number };

// The one place the open call changes. Pure: it starts no turn, writes no file
// and touches no engine — the session (reading/session/) does all of that around
// it.
//
// Rules that are easy to lose:
//   - a row action carries the thread it belongs to, and a call that has since
//     moved to another thread ignores it. Turns outlive the view they were
//     started from (docs/03), so a late callback from a closed conversation is
//     normal, not a bug.
//   - only the AI's row is ever rewritten by a turn; matching on `ts` alone
//     would let a reader's message with the same timestamp be overwritten.
//   - the reader is uncovered only from chat-main, which is the only view that
//     covers it. From the bubble there is nothing to uncover and the bubble
//     stays a bubble — this is what a citation tapped inside a bubble does.
//   - the state object is returned unchanged whenever nothing moved, so a
//     streaming reply does not re-render the surfaces that did not change.
export function callReducer<M extends CallRow>(
  state: CallState<M> | null,
  action: CallAction<M>,
): CallState<M> | null {
  switch (action.type) {
    case "opened":
      return action.call;
    case "closed":
      return null;
    case "closed-with-mark":
      return state && state.annotationId === action.annotationId ? null : state;
  }
  if (!state) return state;
  switch (action.type) {
    case "chat-opened":
      return state.view === "chat-main" ? state : { ...state, view: "chat-main" };
    case "reading-uncovered":
      return state.view === "chat-main" ? { ...state, view: "chat-pip" } : state;
  }
  if (state.threadId !== action.threadId) return state;
  switch (action.type) {
    case "images-loaded": {
      const { images } = action;
      return {
        ...state,
        messages: state.messages.map((m) => (images.has(m.ts) ? { ...m, images: images.get(m.ts) } : m)),
      };
    }
    case "turn-started":
      return {
        ...state,
        error: false,
        messages: [...state.messages.filter((m) => !holdsNoAnswer(m)), action.row],
      };
    case "row-changed":
      return {
        ...state,
        error: action.error ?? state.error,
        messages: state.messages.map((m) =>
          m.ts === action.ts && m.role === "ai" ? applyRowChange(m, action.change) : m,
        ),
      };
    case "row-appended":
      return { ...state, messages: [...state.messages, action.row] };
    case "row-inserted-before-last": {
      const rows = [...state.messages];
      rows.splice(Math.max(rows.length - 1, 0), 0, action.row);
      return { ...state, messages: rows };
    }
    case "row-replaced": {
      let hit = false;
      const rows = state.messages.map((m) => {
        if (m.ts !== action.ts || m.role !== "ai") return m;
        hit = true;
        return action.row;
      });
      return hit ? { ...state, messages: rows } : state;
    }
    case "row-dropped":
      return {
        ...state,
        messages: state.messages.filter((m) => !(m.ts === action.ts && m.role === "ai")),
      };
  }
}
