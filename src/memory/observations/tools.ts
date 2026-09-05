// The three observation agent tools (docs/02 part 2), registered in the same
// tool loop as the M6 reading tools. All writes go through the adapter; the
// optional onWrite hook lets the distiller count what changed and the app
// refresh the observations panel.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import type { ObservationAdapter } from "./adapter";
import { anchorSiblings, buildAnchorIndex, mentionedIds, resolveReferences } from "./links";
import {
  allEntries,
  otherTopicNames,
  searchOtherTopics,
  unionById,
  type ScopedHit,
  type TopicObservations,
} from "./recall";
import { coveredDays, transcriptAnchors, type TranscriptLine } from "./transcript";
import {
  OBSERVATION_TYPES,
  isObservationType,
  type EvidenceAnchors,
  type Observation,
  type ObservationHit,
} from "./types";

export type ObservationWriteAction = "create" | "update" | "delete" | "same-as";

// How a created observation stands to what is already held about the reader
// (docs/48). The judgement is made at write time, in the same call that drafts
// the observation: it is one hop from evidence the model is already holding,
// and nothing later can recover it — a night pass reading the observation
// afterwards no longer has the transcript that made it obvious.
export const WRITE_RELATIONS = ["new", "predicted-by", "contradicts"] as const;
export type WriteRelation = (typeof WRITE_RELATIONS)[number];

// What onWrite reports. "same-as" is not a relation to a statement — it is one
// to an observation — but it is the fourth thing a pass can do, and the counts
// are read together.
export type WriteRelationOutcome = WriteRelation | "same-as";

// Why a write was refused before anything reached the disk. Three, because they
// fail for three different reasons and only the first is the model miscounting:
// a number that names no row, an anchor that resolves to nothing, an id in the
// text that names no observation.
export type WriteRejection = "bad-index" | "unresolved-anchor" | "unresolved-mention";

// The immutable write path. Mounting this swaps `update` (which replaced a
// body) for `same-as` (which appends evidence and leaves the body alone), and
// makes `relation` required on every create.
//
// Mounted only where the prompt printed both numbered lists, because both
// halves are one numbering: the model cites a row number and this table turns
// it back into an id, the same discipline the transcript already follows
// (transcript.ts). A mount without it keeps exactly the tool it had.
export interface RelationMount {
  // Observation ids in the order the prompt numbered them; index i holds the
  // observation printed as [i + 1].
  observations: readonly string[];
  // Statement ids, likewise. Empty means there is nothing to be predicted by or
  // to contradict, and then neither relation is offered at all.
  statements: readonly string[];
  addEvidence(statementId: string, observationIds: readonly string[]): Promise<unknown>;
  addContradiction(statementId: string, observationId: string): Promise<unknown>;
}

// The half of the id gate that needs the outside world: whether a mark and a
// message anchor name anything real. Injected because the tools hold neither
// the book's annotations nor the topic's threads.
export interface AnchorVerifier {
  annotation(id: string): boolean | Promise<boolean>;
  message(anchor: string): boolean | Promise<boolean>;
}

export interface GateInput {
  annotationIds: readonly string[];
  messageIds: readonly string[];
  // Observation ids named in the text being written.
  mentions: readonly string[];
}

export interface GateResult {
  // Marks and message anchors that resolve to nothing, in the order given.
  anchors: string[];
  mentions: string[];
}

// The gate itself, as a function of what was handed in. Pure but for the
// verifier, and exported so the judgement is unit-tested apart from the tool
// loop around it.
//
// Only this call's own ids are checked. The stored anchors of the observation
// being added to are not: they were checked when they were written, and a mark
// deleted since would make every later write to that observation fail with an
// error naming something the model never mentioned (docs/48).
export async function unresolvedIds(
  input: GateInput,
  known: ReadonlySet<string>,
  verify?: AnchorVerifier,
): Promise<GateResult> {
  const anchors: string[] = [];
  if (verify) {
    for (const id of input.annotationIds) if (!(await verify.annotation(id))) anchors.push(id);
    for (const anchor of input.messageIds) if (!(await verify.message(anchor))) anchors.push(anchor);
  }
  const mentions = input.mentions.filter((id) => !known.has(id));
  return { anchors, mentions };
}

export interface ObservationToolOptions {
  onWrite?(action: ObservationWriteAction, relation?: WriteRelationOutcome): void;
  // Every write the gate refused, by why. Counted rather than logged here: a
  // refusal is handed back to the model and usually answered by a corrected
  // call, so what matters afterwards is how often that happened.
  onReject?(reason: WriteRejection): void;
  // The immutable write path (docs/48). Absent leaves the tool exactly as it
  // was: create / update / delete, no relation.
  relations?: RelationMount;
  // Resolves the anchors a write hands in. Absent means anchors are taken as
  // given — a live mount has no listing to check them against.
  verify?: AnchorVerifier;
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
  const relations = opts.relations;
  // Only the relations there is something to point at are offered. With no
  // statement on record "predicted-by" and "contradicts" have no possible
  // target, and naming them would be asking for a row number the prompt never
  // printed.
  const relationList =
    relations && relations.statements.length > 0
      ? WRITE_RELATIONS.map((r) => `"${r}"`).join(" | ")
      : '"new"';
  // A refusal the model has to answer, counted on the way out. Returned rather
  // than thrown from here so the call site reads as `throw reject(...)` and no
  // path can count a rejection it then fails to raise.
  const reject = (reason: WriteRejection, message: string): Error => {
    opts.onReject?.(reason);
    return new Error(message);
  };
  // One row number back to the id it was printed for. The schema bounds it
  // already; this catches the argument that got past validation and the row
  // that has been deleted since the prompt was built.
  const pickIndex = (ids: readonly string[], raw: unknown, what: string): string => {
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      throw reject("bad-index", `${what}: give the number printed in front of the row.`);
    }
    const id = ids[raw - 1];
    if (id === undefined) {
      throw reject("bad-index", `${what}: ${raw} is not a row you were shown (1-${ids.length}).`);
    }
    return id;
  };
  const readRelation = (
    mount: RelationMount,
    args: Record<string, unknown>,
  ): { kind: WriteRelation; statementId: string } | { kind: "new"; statementId?: undefined } => {
    const kind = String(args.relation ?? "");
    if (!(WRITE_RELATIONS as readonly string[]).includes(kind)) {
      throw new Error(`relation must be one of: ${relationList}`);
    }
    if (kind === "new") return { kind: "new" };
    if (mount.statements.length === 0) {
      throw new Error('there are no statements to relate to; use relation "new"');
    }
    return {
      kind: kind as WriteRelation,
      statementId: pickIndex(mount.statements, args.statement, "statement"),
    };
  };
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
        (relations
          ? "Write one observation about this reader, add evidence to one that is " +
            "already there, or delete one that turned out wrong. An observation is " +
            "never rewritten: what it says is what the evidence said on the day it " +
            "was written, and reading it differently later is a new observation, not " +
            "an edit of the old one. Every observation you create says how it stands " +
            "to what is already held about this reader (relation). When the same " +
            "thing has happened again, do not write a second observation saying it: " +
            'action "same-as" on the one that already says it, and your evidence is ' +
            "added to it. Write absolute dates, one fact per observation."
          : "Create, update, or delete one observation about this reader. Update an " +
            "existing observation instead of creating a near-duplicate; delete one that " +
            "turned out wrong. When a new fact contradicts an existing observation, " +
            "rewrite it as an evolution (keep the old state and add the resolution with " +
            "its date) — never silently drop the old state. Write absolute dates, one " +
            "fact per observation.") +
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
        action: Type.String({
          description: relations
            ? 'One of "create" | "same-as" | "delete".'
            : 'One of "create" | "update" | "delete".',
        }),
        id: Type.Optional(
          Type.String({
            description: relations
              ? "Observation id (required for delete)."
              : "Observation id (required for update/delete).",
          }),
        ),
        // The two targets are row numbers, bounded by the schema for the same
        // reason messageIndices is: an out-of-range or invented target is
        // refused by validation before execute sees it, so no edge can be
        // written to something that was never printed.
        ...(relations
          ? {
              relation: Type.Optional(
                Type.String({
                  description:
                    `How this observation stands to what is already held: ${relationList}. ` +
                    "Required for create.",
                }),
              ),
              ...(relations.statements.length > 0
                ? {
                    statement: Type.Optional(
                      Type.Integer({
                        minimum: 1,
                        maximum: relations.statements.length,
                        description:
                          "The number in front of a statement in the list above — required " +
                          'for relation "predicted-by" and "contradicts".',
                      }),
                    ),
                  }
                : {}),
              ...(relations.observations.length > 0
                ? {
                    observation: Type.Optional(
                      Type.Integer({
                        minimum: 1,
                        maximum: relations.observations.length,
                        description:
                          "The number in front of an observation in the index above — " +
                          'required for action "same-as".',
                      }),
                    ),
                  }
                : {}),
            }
          : {}),
        type: Type.Optional(Type.String({ description: `Observation type: ${TYPE_LIST} (required for create).` })),
        summary: Type.Optional(Type.String({ description: "One-line summary (required for create)." })),
        body: Type.Optional(
          Type.String({
            description: relations
              ? "Full markdown body (required for create)."
              : "Full markdown body (required for create; replaces on update).",
          }),
        ),
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
                  throw reject(
                    "bad-index",
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

        // The id gate (docs/48), run on what this call handed in and nothing
        // else. `text` is the prose being written, or null where the call
        // writes none; an id that resolves to nothing there would dangle for
        // good, since no later pass can tell a typo from a deleted observation.
        const gate = async (text: string | null): Promise<void> => {
          if (!relations) return;
          const known = new Set(
            [
              ...(await adapter.listObservations()),
              ...(await readOtherTopics()).flatMap((t) => [...t.entries]),
            ].map((e) => e.id),
          );
          const bad = await unresolvedIds(
            {
              annotationIds: evidence?.annotationIds ?? [],
              messageIds: evidence?.messageIds ?? [],
              mentions: text === null ? [] : mentionedIds(text),
            },
            known,
            opts.verify,
          );
          if (bad.anchors.length > 0) {
            throw reject(
              "unresolved-anchor",
              `This evidence resolves to nothing: ${bad.anchors.join(", ")}. Cite only the ` +
                "annotation ids and the line numbers printed in this pass.",
            );
          }
          if (bad.mentions.length > 0) {
            throw reject(
              "unresolved-mention",
              `Your text names observations that do not exist: ${bad.mentions.join(", ")}. ` +
                "Copy an id from the index above, or say it without an id.",
            );
          }
        };

        if (action === "create") {
          if (opts.requireAnchor && anchorCount === 0) {
            throw reject(
              "unresolved-anchor",
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
          // Read before anything is written: an observation created and only
          // then found to name a statement that is not there would be on disk
          // with the edge it declared missing, and nothing afterwards says so.
          const relation = relations ? readRelation(relations, args) : undefined;
          await gate(`${summary}\n${body}`);
          const entry = await adapter.retain({
            type,
            summary,
            body,
            anchors: evidence,
            ...(opts.bookId ? { bookId: opts.bookId } : {}),
            ...(observed ? { observed } : {}),
          });
          if (relations && relation && relation.kind !== "new") {
            if (relation.kind === "predicted-by") {
              await relations.addEvidence(relation.statementId, [entry.id]);
            } else {
              await relations.addContradiction(relation.statementId, entry.id);
            }
          }
          opts.onWrite?.("create", relation?.kind);
          return `Created ${entry.id}.`;
        }

        if (relations && action === "same-as") {
          // Refused rather than ignored: a model that passed a body meant to
          // change what the observation says, and silently keeping the old text
          // would leave it believing it had said something it did not.
          if (args.summary !== undefined || args.body !== undefined || args.type !== undefined) {
            throw new Error(
              "same-as adds evidence to an observation that already says this; it never " +
                'rewrites it. Drop summary/body/type, or create a new observation with relation "new".',
            );
          }
          const target = pickIndex(relations.observations, args.observation, "observation");
          if (anchorCount === 0) {
            throw reject(
              "unresolved-anchor",
              "same-as is a second piece of evidence for that observation: pass the " +
                "annotationIds" +
                (anchors.length > 0 ? " and/or messageIndices" : "") +
                " it happened in.",
            );
          }
          await gate(null);
          const grown = await adapter.anchor(
            target,
            evidence as EvidenceAnchors,
            observed ?? undefined,
          );
          if (!grown) throw reject("bad-index", `${target} is no longer on this reader's record.`);
          opts.onWrite?.("same-as", "same-as");
          return `Added evidence to ${grown.id}.`;
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

        if (!relations && action === "update") {
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

        throw new Error(
          relations
            ? 'action must be one of "create" | "same-as" | "delete"'
            : 'action must be one of "create" | "update" | "delete"',
        );
      },
    },
  ];
}
