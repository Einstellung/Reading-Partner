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
import type { ToolStatus } from "../ai/tool-status";

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
  // (docs/03: top-bar AI button), flagged by `isBook`.
  annotationId: string;
  isBook?: boolean;
  view: CallView;
  anchor: { x: number; y: number };
  messages: M[];
  // The last turn failed, so the surface offers a retry.
  error?: boolean;
}

