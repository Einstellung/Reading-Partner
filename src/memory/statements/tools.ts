// The one statement tool the reader's own words go through (docs/48, "读者自己写"):
// mounted in the reading conversation, called when the reader says something
// about themselves that is worth keeping past this turn.
//
// Reading only. How a person reads is visible in the reading conversation and
// nowhere else, so the info side does not mount this.
//
// Everything except `text` is the program's: `author` is always "reader" here —
// this tool exists to record what they said, and what the model concluded on its
// own is an observation — and the evidence is the message they just sent,
// anchored by the turn the tool is mounted in rather than named by the model.
// The measured reason is in memory/observations/tools.ts: 76 of 298 model-written
// message anchors on one real store resolved against no message at all.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import { messageAnchor, type AnchoredMessage } from "../observations/anchors";
import { anchorSpan } from "./dates";
import type { StatementStore } from "./store";
import { isStatementKind, STATEMENT_KINDS, type CreateStatementInput } from "./types";

// The message this turn is answering, in the shape an anchor is made of.
export type ReaderMessage = Pick<AnchoredMessage, "id" | "ts" | "threadId"> & { role: "user" | "ai" };

export interface StatementToolContext {
  // Only the three operations this tool performs, so a caller can hand it a
  // narrower object than the whole store and a test needs no file behind it.
  store: Pick<StatementStore, "getStatement" | "createStatement" | "supersede">;
  // The message the reader sent this turn, already appended to the thread and so
  // already carrying its id (platform/app/threads.ts mints one in `append`).
  // Null where the turn is not answering anything the reader typed — a kickoff,
  // a replay — and then the tool is not mounted at all rather than mounted with
  // nothing to point at.
  message?: ReaderMessage | null;
  // The thread the message is stored in, for the half of the anchor that is the
  // "<threadId>:<ts>" pair (anchors.ts).
  threadId?: string;
}

// The reader's message for this turn: the last one they sent. Exported so the
// caller assembling a turn picks it the same way this tool would, and so the
// choice is testable without a turn.
export function latestReaderMessage<T extends { role: "user" | "ai" }>(
  messages: readonly T[],
): T | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

const KIND_LIST = STATEMENT_KINDS.join(" | ");

export function buildStatementTools(ctx: StatementToolContext): AgentTool[] {
  const message = ctx.message ?? null;
  if (!message || message.role !== "user") return [];
  const anchor = messageAnchor(message, ctx.threadId);
  // A statement is dated by its evidence and refuses to be dated by the clock
  // (store.ts), so an anchor that carries no timestamp would make every call to
  // this tool throw. Not mounting it is the honest form of that.
  if (!anchor || !anchorSpan(anchor)) return [];

  return [
    {
      name: "statement_write",
      description:
        "Write down something the reader has just told you about themselves, in their own " +
        "words. Call it when they say how they want to be taught (\"stop drawing diagrams\", " +
        "\"give me an example first\"), what they have understood or are still stuck on, or " +
        "what they are keeping an eye on at the moment. " +
        "Only what they said: your own conclusions about this reader are observations and " +
        "go through observation_update, never through here. " +
        "Keep their wording — this is their claim about themselves, not your summary of it. " +
        "When what they now say overturns something already written down, pass that " +
        "statement's id as `supersedes`; the old one is kept, not deleted. " +
        "The message they just sent is attached as the evidence automatically; there is no " +
        "parameter for it, and nothing else about them is recorded by this call.",
      parameters: Type.Object({
        kind: Type.String({
          description:
            `One of: ${KIND_LIST}. "profile" is how they read and how to teach them — the ` +
            `way they want things explained, what they have understood, what they are stuck ` +
            `on. "concern" is one thing they are watching at the moment; it is about now, ` +
            `not about who they are.`,
        }),
        text: Type.String({
          description:
            "The statement itself, one sentence, written as a claim about the reader " +
            "(\"Wants the derivation in full and no diagrams\"). Their wording wherever it " +
            "carries; do not generalise it into something they did not say.",
        }),
        supersedes: Type.Optional(
          Type.String({
            description:
              "The id (s-…) of the statement this one replaces, when the reader has just " +
              "overturned it. Leave it out for anything new.",
          }),
        ),
        expectedIntervalDays: Type.Optional(
          Type.Integer({
            minimum: 1,
            description:
              "concern only, and only when they said so: how often this is expected to come " +
              "up again, in days. Ignored on a profile statement.",
          }),
        ),
      }),
      execute: async (args) => {
        const kind = String(args.kind ?? "").trim();
        if (!isStatementKind(kind)) throw new Error(`kind must be one of: ${KIND_LIST}`);
        const text = String(args.text ?? "").trim();
        if (!text) throw new Error("statement_write requires text: what the reader said about themselves");
        const interval = args.expectedIntervalDays;
        const input: CreateStatementInput = {
          kind,
          text,
          author: "reader",
          evidence: [anchor],
          // Carried only where something reads it: a profile statement has no
          // expected interval, and storing one would be a field about recurrence
          // on a claim that does not recur (types.ts).
          ...(kind === "concern" && typeof interval === "number" ? { expectedIntervalDays: interval } : {}),
        };

        const supersedes = args.supersedes === undefined ? "" : String(args.supersedes).trim();
        if (!supersedes) {
          const written = await ctx.store.createStatement(input);
          return `Wrote ${written.id} (${written.kind}, in the reader's own words): ${written.text}`;
        }

        // Checked before writing, and the reason handed back rather than
        // thrown away: a supersedes that names nothing would otherwise write a
        // second statement saying the same thing as the first, with nothing
        // linking the two.
        const old = await ctx.store.getStatement(supersedes);
        if (!old) {
          return `No statement with id "${supersedes}", so nothing was written. Check the id, or leave supersedes out to write this as a new statement.`;
        }
        if (old.supersededBy) {
          return `${supersedes} was already superseded by ${old.supersededBy}, so nothing was written. Supersede ${old.supersededBy} instead if it is what the reader has now overturned.`;
        }
        const written = await ctx.store.supersede(supersedes, input);
        if (!written) return `No statement with id "${supersedes}", so nothing was written.`;
        return `Wrote ${written.id} (${written.kind}, in the reader's own words): ${written.text}\nIt supersedes ${supersedes}, which is kept.`;
      },
    },
  ];
}
