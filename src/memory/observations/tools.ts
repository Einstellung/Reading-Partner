// The three observation agent tools (docs/02 part 2), registered in the same
// tool loop as the M6 reading tools. All writes go through the adapter; the
// optional onWrite hook lets the distiller count what changed and the app
// refresh the observations panel.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import type { ObservationAdapter } from "./adapter";
import { anchorSiblings, buildAnchorIndex, resolveReferences } from "./links";
import {
  allEntries,
  otherTopicNames,
  searchOtherTopics,
  unionById,
  type ScopedHit,
  type TopicObservations,
} from "./recall";
import { coveredDays, transcriptAnchors, type TranscriptLine } from "./transcript";
import { OBSERVATION_TYPES, isObservationType, type Observation, type ObservationHit } from "./types";

export type ObservationWriteAction = "create" | "update" | "delete";

export interface ObservationToolOptions {
  onWrite?(action: ObservationWriteAction): void;
  // The book the session is on, stamped onto anything created through these
  // tools (record/types.ts). Not a tool parameter: the model does not know the
  // content hash and would invent one. Absent where there is no one book.
  bookId?: string;
  // The transcript this pass rendered, line by line (transcript.ts): position i
  // holds the line the prompt printed as [i + 1], carrying both the anchor that
  // lands on disk — the message's id joined to the "<threadId>:<ts>" pair, or
  // whichever half is known (anchors.ts) — and the day that line happened. The
  // model cites the number; the anchor and the date are read off this table.
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
  // The reader's other topics, so recall reaches past the one these tools are
  // mounted on (recall.ts). A thunk, not a list: a mount lives as long as a
  // conversation and the reader can start a topic inside one, so the peers are
  // read when a search runs, not when the tools are built. Reading all of them
  // measures well under a millisecond on the owner's store, which is why there
  // is no cache to go stale.
  //
  // Absent means same-topic only, and then every one of these tools behaves
  // exactly as it did before cross-topic recall existed — same output bytes,
  // same descriptions, same write path. That is what the distillation tests and
  // any mount with no topic list behind it get.
  otherTopics?: () => Promise<readonly TopicObservations[]>;
}

// How many neighbours one read prints per section. The widest body on one real
// store (2026-08-31) mentions 23 other observations and the widest
// shared-evidence fan-out is 9, so this bites on the mention list and never on
// the evidence list. Truncating the mention list costs the model nothing it
// cannot get back: the ids themselves are in the body it is already reading, so
// what the cap drops is the summary beside them, and one more observation_read
// fetches it.
const LINK_CAP = 12;

// `where` names the topic an entry lives in, and is empty for this topic's own
// — an unlabelled line is local, a labelled one is about another book.
function linkLine(e: Observation, where: ReadonlyMap<string, string>): string {
  const topic = where.get(e.id);
  return `- [${e.id}] (${topic ? `topic "${topic}", ` : ""}${e.type}, updated ${e.updated}) ${e.summary}`;
}

function linkSection(
  title: string,
  entries: readonly Observation[],
  overflow: string,
  where: ReadonlyMap<string, string>,
): string[] {
  if (entries.length === 0) return [];
  const shown = entries.slice(0, LINK_CAP);
  const lines = ["", title, ...shown.map((e) => linkLine(e, where))];
  if (entries.length > shown.length) lines.push(`(${entries.length - shown.length} more ${overflow})`);
  return lines;
}

// One observation in full, plus the two hops out of it that the stored data
// already supports but nothing rendered (links.ts): the observations this body
// mentions by id, and the ones built on the same marks and messages. Both are
// the neighbours the model would otherwise have to guess at — the mentions
// print as bare ids in the body, and the anchors print as bare ids above it —
// so this turns a read into a traversal it can chain inside the rounds it has.
//
// `all` and `others` are the same lists observation_read already fetched to
// find `e`; nothing here reads the disk again.
//
// Both hops resolve across topics when other topics are mounted. Mentions
// because the seam was already there — resolveReferences takes its known set as
// a parameter — and because the moment the distiller can see another topic's
// ids it starts writing them, so an id that resolves nowhere locally is now a
// link rather than a corpse. Anchor siblings because one book can sit in two
// topics, and then the same mark carries observations under both.
function describeEntry(
  e: Observation,
  all: readonly Observation[],
  others: readonly TopicObservations[],
): string {
  const anchors: string[] = [];
  if (e.anchors.annotationIds.length) anchors.push(`annotations: ${e.anchors.annotationIds.join(", ")}`);
  if (e.anchors.messageIds.length) anchors.push(`messages: ${e.anchors.messageIds.join(", ")}`);
  const where = otherTopicNames(all, others);
  const { resolved, dangling } = resolveReferences(e, unionById(all, others));
  const siblings = anchorSiblings(buildAnchorIndex(allEntries(all, others)), e);
  const foreign = where.get(e.id);
  return [
    `id: ${e.id}`,
    ...(foreign ? [`topic: ${foreign} — another topic, not the one you are in`] : []),
    `type: ${e.type}`,
    `created: ${e.created}, updated: ${e.updated}`,
    ...anchors,
    "",
    e.body || e.summary,
    ...linkSection("Observations this one mentions:", resolved, "mentioned in the body above", where),
    // Named so the model stops chasing them: an id it can read is worth a
    // call, an id observation_read would answer "no observation" for is not.
    // Phrased by where it looked rather than by what happened to it, because
    // even widened the set it resolves against is only the topics this mount
    // was given: a mention the distiller deleted and one stored in a topic
    // nobody handed us are the same silence from here. Neither exists on the
    // real store — all 278 mentions resolve, and none crosses a topic
    // directory, which is what per-topic recall made of them and not a
    // property of the text.
    ...(dangling.length
      ? ["", `Mentioned but not in the observations you can see: ${dangling.join(", ")}.`]
      : []),
    ...linkSection("Other observations from the same evidence:", siblings, "on the same evidence", where),
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
  // Cross-topic recall is on by default wherever a topic list is mounted, and
  // there is no "search wider" parameter for the model to set.
  //
  // The case against a default is that recall returns few hits and a union can
  // crowd out the book in hand; that is answered by ranking the two apart
  // (recall.ts) so the other topics add three lines and take none. What is left
  // is the case against an opt-in, and it is decisive: the model cannot ask for
  // what it cannot see is missing. Nothing in a reading turn says "this reader
  // has a second topic that answers this" — that fact lives only in the topic
  // it is being kept out of — so a widening it must request is a widening it
  // requests exactly when it already suspects the answer, which is never.
  const otherTopics = opts.otherTopics;
  const readOtherTopics = async (): Promise<readonly TopicObservations[]> =>
    otherTopics ? await otherTopics() : [];
  // A hit from another topic is about another book. It is labelled at the line,
  // not only under the section heading, because the model quotes lines.
  const hitLine = (h: ObservationHit | ScopedHit): string => {
    const topic = "topicName" in h ? `topic "${h.topicName}", ` : "";
    return `[${h.entry.id}] (${topic}${h.entry.type}, updated ${h.entry.updated}) ${h.snippet}`;
  };
  // The other topic an id lives in, or undefined when it is this topic's — or
  // nothing's, which the write path already has an answer for. Search now hands
  // the model ids it cannot write to, and adapter.correct would answer a
  // foreign id with the same "no observation" as a typo while delete would
  // answer it with a cheerful "Deleted".
  //
  // Reads nothing at all where no other topics are mounted, so a distillation
  // pass without them keeps exactly the write path it had.
  const otherTopicOwner = async (id: string): Promise<string | undefined> => {
    if (!otherTopics) return undefined;
    const owner = (await otherTopics()).find((t) => t.entries.some((e) => e.id === id));
    if (!owner) return undefined;
    // A local entry wins a collision — the same rule unionById follows, for the
    // same reason: the reader is in this topic.
    const local = await adapter.listObservations();
    return local.some((e) => e.id === id) ? undefined : owner.topicName;
  };
  const notYours = (id: string, topic: string): string =>
    `${id} is stored under topic "${topic}", not this one. Observations can only be ` +
    `changed in the topic they live in. If it matters here, write what you learned as ` +
    `an observation of this topic.`;
  return [
    {
      name: "observation_search",
      description:
        "Keyword-search your observations of this reader. " +
        (otherTopics
          ? "Searches this topic and, in a second pass of its own, the reader's other " +
            "topics — every hit from one of those is labelled with the topic it came " +
            "from and is about a different book, so name that book before you lean on " +
            "it, and never state it as something about the book in hand. "
          : "This topic only. ") +
        "Returns ranked snippets with observation ids" +
        (otherTopics ? "; observation_read takes any id returned here. " : ". ") +
        "If the first search doesn't answer the question, try different terms before giving up.",
      parameters: Type.Object({
        query: Type.String({ description: "Search terms." }),
      }),
      execute: async (args) => {
        const query = String(args.query);
        const hits = await adapter.recall(query);
        const cross = searchOtherTopics(await readOtherTopics(), query);
        if (hits.length === 0 && cross.length === 0) return `No observation matches "${query}".`;
        // With nothing found outside this topic the answer is byte for byte the
        // answer this tool has always given: no headings, no labels, nothing for
        // the model to read as a change of subject.
        if (cross.length === 0) return hits.map(hitLine).join("\n\n");
        return [
          hits.length
            ? ["This topic:", hits.map(hitLine).join("\n\n")].join("\n\n")
            : `Nothing in this topic matches "${query}".`,
          ["The reader's other topics (other books — say which):", cross.map(hitLine).join("\n\n")].join("\n\n"),
        ].join("\n\n");
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
        const all = await adapter.listObservations();
        // Searched here too, and not only in this topic's list, because a search
        // that hands back ids from another topic and a read that refuses them
        // would be one tool undoing the other.
        const others = await readOtherTopics();
        const entry =
          all.find((e) => e.id === id) ??
          others.flatMap((t) => [...t.entries]).find((e) => e.id === id);
        return entry ? describeEntry(entry, all, others) : `No observation with id "${id}".`;
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
        (otherTopics
          ? " Writes land in this topic only: a search can hand you an id from another " +
            "topic, and that observation can be read but not changed from here."
          : "") +
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
          const foreign = await otherTopicOwner(id);
          if (foreign) return notYours(id, foreign);
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
          if (!entry) {
            const foreign = await otherTopicOwner(id);
            return foreign ? notYours(id, foreign) : `No observation with id "${id}".`;
          }
          opts.onWrite?.("update");
          return `Updated ${entry.id}.`;
        }

        throw new Error('action must be one of "create" | "update" | "delete"');
      },
    },
  ];
}
