// The three observation agent tools (docs/02 part 2), registered in the same
// tool loop as the M6 reading tools. All writes go through the adapter; the
// optional onWrite hook lets the distiller count what changed and the app
// refresh the observations panel.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import type { ObservationAdapter } from "./adapter";
import { coveredDays, transcriptAnchors, type TranscriptLine } from "./transcript";
import { OBSERVATION_TYPES, isObservationType, type Observation } from "./types";

export type ObservationWriteAction = "create" | "update" | "delete";

export interface ObservationToolOptions {
  onWrite?(action: ObservationWriteAction): void;
  // The book the session is on, stamped onto anything created through these
  // tools (record/types.ts). Not a tool parameter: the model does not know the
  // content hash and would invent one. Absent where there is no one book.
  bookId?: string;
  // The transcript this pass rendered, line by line (transcript.ts): position i
  // holds the line the prompt printed as [i + 1], carrying both the
  // "<threadId>:<ts>" anchor that lands on disk and the day that line happened.
  // The model cites the number; the id and the date are read off this table.
  //
  // Neither is asked of the model — the same rule as bookId above, and for the
  // same measured reason: 76 of 298 model-written message anchors on one real
  // store resolved against no message. Absent means this mount has no
  // transcript behind it (a live conversation, the silent-marks pass), and then
  // the parameter is not offered at all rather than offered with nothing to
  // resolve against.
  messageLines?: readonly TranscriptLine[];
  // The day each mark listed in this pass's prompt was made, by annotation id,
  // on the reader's own clock. The other half of the dating: the silent-marks
  // pass cites annotation ids and nothing else, so without this an observation
  // made of marks would have nothing to date it but the clock — and a mark is
  // read by the sweep even longer after the fact than a conversation is.
  annotationDates?: ReadonlyMap<string, string>;
  // Whether creating an observation must cite at least one anchor — an
  // annotation id or a transcript line. On for the three distillation passes,
  // each of which prints everything it may cite; off for the tools mounted in a
  // live conversation, where the model is answering the reader rather than
  // reading a listing and has nothing to point at.
  //
  // 14 of 142 observations on one real store carry no anchor of any kind, and
  // the most valuable broken link there is one of them: the reader gave back,
  // under examination, the exact wrong answer an earlier observation had
  // recorded as an open question, and nothing connects the two.
  requireAnchor?: boolean;
}

function describeEntry(e: Observation): string {
  const anchors: string[] = [];
  if (e.anchors.annotationIds.length) anchors.push(`annotations: ${e.anchors.annotationIds.join(", ")}`);
  if (e.anchors.messageIds.length) anchors.push(`messages: ${e.anchors.messageIds.join(", ")}`);
  return [
    `id: ${e.id}`,
    `type: ${e.type}`,
    `created: ${e.created}, updated: ${e.updated}`,
    ...anchors,
    "",
    e.body || e.summary,
  ].join("\n");
}

const TYPE_LIST = OBSERVATION_TYPES.join(" | ");

export function buildObservationTools(adapter: ObservationAdapter, opts: ObservationToolOptions = {}): AgentTool[] {
  const lines = opts.messageLines ?? [];
  const anchors = transcriptAnchors(lines);
  const annotationDates = opts.annotationDates;
  // What this pass's evidence covers as a whole — every line it printed and
  // every mark it listed. The fallback for a write that cites nothing datable,
  // which in practice means an update: the model may rewrite an observation
  // without restating its anchors, and the day the sweep happens to run is
  // still not the day the reader was here.
  const passDays = coveredDays([
    ...lines.map((l) => l.date),
    ...(annotationDates ? [...annotationDates.values()] : []),
  ]);
  return [
    {
      name: "observation_search",
      description:
        "Keyword-search your observations of this reader (this topic only). " +
        "Returns ranked snippets with observation ids. If the first search doesn't " +
        "answer the question, try different terms before giving up.",
      parameters: Type.Object({
        query: Type.String({ description: "Search terms." }),
      }),
      execute: async (args) => {
        const hits = await adapter.recall(String(args.query));
        if (hits.length === 0) return `No observation matches "${args.query}".`;
        return hits
          .map((h) => `[${h.entry.id}] (${h.entry.type}, updated ${h.entry.updated}) ${h.snippet}`)
          .join("\n\n");
      },
    },
    {
      name: "observation_read",
      description: "Read one observation in full by its id (as returned by observation_search or the index).",
      parameters: Type.Object({
        id: Type.String({ description: "The observation id, e.g. m-1a2b3c4d." }),
      }),
      execute: async (args) => {
        const id = String(args.id);
        const entry = (await adapter.listObservations()).find((e) => e.id === id);
        return entry ? describeEntry(entry) : `No observation with id "${id}".`;
      },
    },
    {
      name: "observation_update",
      description:
        "Create, update, or delete one observation about this reader. Update an " +
        "existing observation instead of creating a near-duplicate; delete one that " +
        "turned out wrong. When a new fact contradicts an existing observation, " +
        "rewrite it as an evolution (keep the old state and add the resolution with " +
        "its date) — never silently drop the old state. Write absolute dates, one " +
        "fact per observation." +
        (opts.requireAnchor
          ? " Every observation you create must cite its evidence: the annotationIds" +
            (anchors.length > 0 ? " and/or the messageIndices" : "") +
            " it came from."
          : ""),
      parameters: Type.Object({
        action: Type.String({ description: 'One of "create" | "update" | "delete".' }),
        id: Type.Optional(Type.String({ description: "Observation id (required for update/delete)." })),
        type: Type.Optional(Type.String({ description: `Observation type: ${TYPE_LIST} (required for create).` })),
        summary: Type.Optional(Type.String({ description: "One-line summary (required for create)." })),
        body: Type.Optional(Type.String({ description: "Full markdown body (required for create; replaces on update)." })),
        annotationIds: Type.Optional(Type.Array(Type.String(), { description: "Evidence: annotation ids this observation came from." })),
        // Bounded by the schema so an out-of-range or invented line is refused
        // by validation before execute ever sees it (ai/agent.ts turns that
        // into a tool-result error the model can react to), rather than being
        // stored as an anchor that resolves to nothing.
        ...(anchors.length > 0
          ? {
              messageIndices: Type.Optional(
                Type.Array(Type.Integer({ minimum: 1, maximum: anchors.length }), {
                  description:
                    `Evidence: the transcript line numbers this observation came from — the [n] ` +
                    `printed in front of each line, 1 to ${anchors.length}.`,
                }),
              ),
            }
          : {}),
      }),
      execute: async (args) => {
        const action = String(args.action);
        const indices = args.messageIndices as number[] | undefined;
        // Sorted and de-duplicated: the same line cited twice is one piece of
        // evidence, and the stored list reads as the transcript reads.
        const messageIds =
          indices === undefined
            ? undefined
            : [...new Set(indices)].sort((a, b) => a - b).map((i) => {
                const anchor = anchors[i - 1];
                // The schema already bounds this; a provider that ships an
                // argument past validation must still not write a dead anchor.
                if (anchor === undefined) {
                  throw new Error(
                    `messageIndices: ${i} is not a transcript line (1-${anchors.length}).`,
                  );
                }
                return anchor;
              });
        const evidence =
          args.annotationIds !== undefined || messageIds !== undefined
            ? {
                annotationIds: (args.annotationIds as string[] | undefined) ?? [],
                messageIds: messageIds ?? [],
              }
            : undefined;
        const anchorCount =
          evidence === undefined ? 0 : evidence.annotationIds.length + evidence.messageIds.length;
        // When this observation's evidence happened, from the evidence itself.
        // The cited lines and marks are the finest answer there is; the pass's
        // own span stands in when the call cites nothing that carries a day,
        // and only a mount with no evidence at all behind it (a live turn,
        // where the conversation is happening now) falls through to the clock
        // in store.ts.
        const observed =
          coveredDays([
            ...(indices ?? []).map((i) => lines[i - 1]?.date ?? null),
            ...((args.annotationIds as string[] | undefined) ?? []).map(
              (id) => annotationDates?.get(id) ?? null,
            ),
          ]) ?? passDays;

        if (action === "create") {
          if (opts.requireAnchor && anchorCount === 0) {
            throw new Error(
              "create requires evidence: pass annotationIds" +
                (anchors.length > 0 ? " and/or messageIndices" : "") +
                ". An observation nothing points back to cannot be checked later.",
            );
          }
          const type = String(args.type ?? "");
          if (!isObservationType(type)) throw new Error(`type must be one of: ${TYPE_LIST}`);
          const summary = String(args.summary ?? "").trim();
          const body = String(args.body ?? "").trim();
          if (!summary || !body) throw new Error("create requires summary and body");
          const entry = await adapter.retain({
            type,
            summary,
            body,
            anchors: evidence,
            ...(opts.bookId ? { bookId: opts.bookId } : {}),
            ...(observed ? { observed } : {}),
          });
          opts.onWrite?.("create");
          return `Created ${entry.id}.`;
        }

        const id = String(args.id ?? "").trim();
        if (!id) throw new Error(`${action} requires id`);

        if (action === "delete") {
          await adapter.correct(id, null);
          opts.onWrite?.("delete");
          return `Deleted ${id}.`;
        }

        if (action === "update") {
          const type = args.type === undefined ? undefined : String(args.type);
          if (type !== undefined && !isObservationType(type)) {
            throw new Error(`type must be one of: ${TYPE_LIST}`);
          }
          const entry = await adapter.correct(id, {
            type,
            summary: args.summary === undefined ? undefined : String(args.summary),
            body: args.body === undefined ? undefined : String(args.body),
            anchors: evidence,
            ...(observed ? { observed } : {}),
          });
          if (!entry) return `No observation with id "${id}".`;
          opts.onWrite?.("update");
          return `Updated ${entry.id}.`;
        }

        throw new Error('action must be one of "create" | "update" | "delete"');
      },
    },
  ];
}
