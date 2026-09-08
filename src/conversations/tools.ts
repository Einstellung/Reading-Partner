// The two tools that let the AI look back at what it and the reader have
// already said, wherever they said it (docs/61). They ride every turn, on every
// desk, because a conversation is not about the material it happened over: what
// the reader told a briefing about how they read is the answer to a question a
// book asks three weeks later.
//
// Two tools rather than one because a search that returned bodies would spend
// the window on twelve conversations to answer with one. The search hands back
// pointers — a file key, a thread id, a stamp — and the read takes them back.
//
// AgentTool is the one thing imported from outside palace and platform/app, and
// it is a type: src/desk does the same, for the same reason. Nothing here calls
// a model.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import type { ConversationIo } from "./io";
import {
  readConversation,
  searchConversations,
  type ConversationExcerpt,
  type ConversationHit,
} from "./search";

// What the desk this turn is laid for is scoped to. The topic the reader is in
// is where a search starts; nothing else about the desk matters here.
export interface ConversationScope {
  topicId: string | null;
}

const ROLE: Record<"user" | "ai", string> = { user: "reader", ai: "you" };

function stamp(ts: number): string {
  const iso = new Date(ts).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function hitLine(hit: ConversationHit, n: number): string {
  const topic = hit.topicId ? `topic "${hit.topicId}"` : "no topic";
  return (
    `[${n}] ${hit.kind} fileKey="${hit.fileKey}" threadId="${hit.threadId}" ts=${hit.ts} ` +
    `(${ROLE[hit.role]}, ${topic}, ${stamp(hit.ts)})\n    ${hit.snippet}`
  );
}

function excerptText(excerpt: ConversationExcerpt): string {
  const topic = excerpt.topicId ? `topic "${excerpt.topicId}"` : "no topic";
  const around = [
    excerpt.before > 0 ? `${excerpt.before} earlier` : "",
    excerpt.after > 0 ? `${excerpt.after} later` : "",
  ].filter((s) => s !== "");
  const head =
    `${excerpt.kind}, fileKey="${excerpt.fileKey}", threadId="${excerpt.threadId}", ${topic}.` +
    (around.length ? ` ${around.join(", ")} message(s) not shown.` : "");
  const body = excerpt.lines.map((l) => `${ROLE[l.role]} (${stamp(l.ts)}): ${l.text}`).join("\n\n");
  return body === "" ? `${head}\n\nThis conversation is empty.` : `${head}\n\n${body}`;
}

/**
 * The conversation tools for one turn. `scope` is where a search starts; a
 * search that finds nothing there widens to every conversation there is, and
 * says so in what it returns.
 */
export function buildConversationTools(
  scope: ConversationScope,
  io?: ConversationIo,
): AgentTool[] {
  return [
    {
      name: "search_conversations",
      description:
        "Keyword-search everything you and this reader have already said to each other — " +
        "conversations over books, over retells and talks, and over the daily briefing. " +
        "Starts in the topic at hand and, finding nothing there, searches all of them; the " +
        "answer says which. Returns a pointer per hit — a file key, a thread id, a stamp — " +
        "that read_conversation takes back to read the passage in full. Search this before " +
        "telling the reader you have no idea what they are referring to.",
      parameters: Type.Object({
        query: Type.String({ description: "Search terms." }),
        widen: Type.Optional(
          Type.Boolean({
            description:
              "Whether to fall back to every conversation when the current topic holds " +
              "nothing. Defaults to true; set it false to stay inside this topic.",
          }),
        ),
      }),
      execute: async (args) => {
        const query = String(args.query ?? "");
        const widen = args.widen === undefined ? true : Boolean(args.widen);
        const { hits, widened } = await searchConversations(
          query,
          { topicId: scope.topicId, widen },
          io,
        );
        if (hits.length === 0) {
          const where = scope.topicId && !widen ? " in this topic" : "";
          return `No conversation${where} matches "${query}".`;
        }
        const head = widened
          ? "Nothing in the current topic matched. These are from the reader's other " +
            "topics — each is about other material, so name what it was about before you " +
            "lean on it:"
          : "";
        const list = hits.map(hitLine).join("\n\n");
        return head === "" ? list : `${head}\n\n${list}`;
      },
    },
    {
      name: "read_conversation",
      description:
        "Read a stretch of one past conversation in full, by the fileKey and threadId a " +
        "search_conversations hit gave you. A thread id alone is not enough: the same id " +
        "exists in more than one file.",
      parameters: Type.Object({
        fileKey: Type.String({ description: 'The fileKey from a hit, e.g. "info-2026-07-21".' }),
        threadId: Type.String({ description: "The threadId from the same hit." }),
        aroundTs: Type.Optional(
          Type.Number({
            description:
              "The ts from the hit, to centre the excerpt on it. Omitted reads the end of " +
              "the conversation.",
          }),
        ),
        span: Type.Optional(
          Type.Number({ description: "How many messages to return. Default 8, at most 40." }),
        ),
      }),
      execute: async (args) => {
        const fileKey = String(args.fileKey ?? "");
        const threadId = String(args.threadId ?? "");
        const excerpt = await readConversation(
          {
            fileKey,
            threadId,
            aroundTs: typeof args.aroundTs === "number" ? args.aroundTs : undefined,
            span: typeof args.span === "number" ? args.span : undefined,
          },
          io,
        );
        if (!excerpt) {
          return (
            `No conversation "${threadId}" in "${fileKey}". Use the fileKey and threadId ` +
            `exactly as search_conversations printed them.`
          );
        }
        return excerptText(excerpt);
      },
    },
  ];
}
