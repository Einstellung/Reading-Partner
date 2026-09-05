// The statement store: one file at the root of AppData holding every statement
// there is.
//
// One file rather than a directory per topic, which is how observations are
// stored, because a statement is not about a topic. "Reads past the maths" is
// one claim whether the evidence for it came from three books under two topics,
// and a per-topic layout would either duplicate it or make the cross-topic
// question unaskable (docs/memory: cross-topic recall is a requirement).
//
// The shape on disk is what the records merge strategy needs of a JSON
// collection: `{ statements: [...] }`, each record carrying `id`
// (platform/sync/merge/records.ts). Records rather than one opaque blob so two
// devices that each added a statement offline keep both.
//
// Dates are never taken from the clock here. Every write recomputes them from
// the evidence, and evidence that cannot be dated is refused rather than
// silently stamped with today — see dates.ts. The single exception is
// `confirmedOn`, and it is a supplied day rather than a read of the clock:
// see confirmedSpan.

import {
  anchorSpan,
  isObservationId,
  laterDay,
  unionSpans,
  type DaySpan,
} from "./dates";
import type { CreateStatementInput, Statement } from "./types";

export const STATEMENTS_FILE = "statements.json";

// The wrapper key the records strategy reads the collection out of. A wrapper
// rather than a bare array so a field added beside the collection later merges
// as a field instead of forcing the file's shape to change.
const CONTAINER = "statements";

export interface StatementIo {
  // The file's text, or null when it is not there.
  //
  // A read that fails must throw rather than answer null. This file holds every
  // statement at once, so a swallowed error followed by a write replaces the
  // lot with the one record in hand — and sync does not put them back, since
  // with a base the records the merge no longer sees are deletes
  // (platform/sync/merge/records.ts).
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  // The days one observation's own evidence covers, or null when there is no
  // such observation. Injected because observations are stored per topic and a
  // statement is not scoped to one: resolving an id means knowing the topics,
  // which is the caller's business and not this file's.
  observationDates(id: string): Promise<DaySpan | null>;
  // Overridable so a test can pin ids; the default mints them.
  newId?(): string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 16 hex, the width every other id in the app has.
function mintId(): string {
  return `s-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export interface StatementStore {
  listStatements(): Promise<Statement[]>;
  getStatement(id: string): Promise<Statement | null>;
  createStatement(input: CreateStatementInput): Promise<Statement>;
  // Null when there is no such statement. Both append and de-duplicate; neither
  // ever touches `text`.
  addEvidence(id: string, evidence: readonly string[]): Promise<Statement | null>;
  addContradiction(id: string, observationId: string): Promise<Statement | null>;
  // The new statement, or null when there is nothing to supersede — in which
  // case nothing is created either.
  supersede(oldId: string, input: CreateStatementInput): Promise<Statement | null>;
}

function appendUnique(existing: readonly string[], added: readonly string[]): string[] {
  const out = [...existing];
  const seen = new Set(existing);
  for (const item of added) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// The one date a caller is allowed to supply, and the narrowest opening that
// makes the profile carry-over possible: a line the reader kept from the old
// user-profile.md points at no message, so there is nothing to date it from and
// the day they kept it is the only date there is.
//
// Three conditions, all of them: the reader is the author, there is no evidence
// at all, and a day was given. A dream can never take this route — a claim it
// made with nothing behind it is the exact thing the computed dates refuse — and
// evidence, when there is any, always wins, because it dates the statement
// better than the day someone happened to press a button.
function confirmedSpan(input: CreateStatementInput, evidence: readonly string[]): DaySpan | null {
  if (input.confirmedOn === undefined) return null;
  if (input.author !== "reader" || evidence.length > 0) return null;
  if (!DAY.test(input.confirmedOn)) {
    throw new Error(`confirmedOn is not a day: ${input.confirmedOn}`);
  }
  return { first: input.confirmedOn, last: input.confirmedOn };
}

export function createStatementStore(io: StatementIo): StatementStore {
  const newId = io.newId ?? mintId;

  // The whole file. An unparseable file throws: every statement lives here, and
  // carrying on from an empty list would write the file back with the survivors
  // of nothing in it.
  async function readAll(): Promise<Statement[]> {
    const text = await io.read(STATEMENTS_FILE);
    if (text === null || text.trim() === "") return [];
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${STATEMENTS_FILE} is not an object`);
    }
    const held = (parsed as Record<string, unknown>)[CONTAINER];
    // A file written before the collection had anything in it.
    if (held === undefined) return [];
    if (!Array.isArray(held)) throw new Error(`${STATEMENTS_FILE}: ${CONTAINER} is not an array`);
    return held as Statement[];
  }

  async function writeAll(statements: readonly Statement[]): Promise<void> {
    await io.write(STATEMENTS_FILE, JSON.stringify({ [CONTAINER]: statements }, null, 2));
  }

  // What one piece of evidence dates to. Throws rather than skipping: a
  // statement dated from a subset of its evidence claims a span its own
  // evidence does not support, which is the exact lie the two fields exist to
  // stop, and it would be invisible afterwards.
  async function spanOf(evidence: string): Promise<DaySpan> {
    if (isObservationId(evidence)) {
      const span = await io.observationDates(evidence);
      if (span) return span;
      throw new Error(`statement evidence names no observation: ${evidence}`);
    }
    const span = anchorSpan(evidence);
    if (span) return span;
    throw new Error(`statement evidence carries no date: ${evidence}`);
  }

  async function spanOfAll(evidence: readonly string[]): Promise<DaySpan> {
    const spans: DaySpan[] = [];
    for (const item of evidence) spans.push(await spanOf(item));
    const span = unionSpans(spans);
    if (!span) throw new Error("a statement needs evidence to be dated by");
    return span;
  }

  async function mint(input: CreateStatementInput): Promise<Statement> {
    const evidence = appendUnique([], input.evidence);
    const span = confirmedSpan(input, evidence) ?? (await spanOfAll(evidence));
    return {
      id: newId(),
      kind: input.kind,
      text: input.text,
      author: input.author,
      evidence,
      contradictedBy: [],
      established: span.first,
      lastSupported: span.last,
      ...(input.expectedIntervalDays === undefined
        ? {}
        : { expectedIntervalDays: input.expectedIntervalDays }),
    };
  }

  // Read, replace one record, write. Null when the id is not there, and then
  // nothing is written at all.
  async function patch(
    id: string,
    change: (prev: Statement) => Promise<Statement>,
  ): Promise<Statement | null> {
    const all = await readAll();
    const at = all.findIndex((s) => s.id === id);
    if (at < 0) return null;
    const next = await change(all[at]);
    all[at] = next;
    await writeAll(all);
    return next;
  }

  return {
    listStatements: readAll,

    async getStatement(id) {
      return (await readAll()).find((s) => s.id === id) ?? null;
    },

    async createStatement(input) {
      const statement = await mint(input);
      const all = await readAll();
      all.push(statement);
      await writeAll(all);
      return statement;
    },

    addEvidence(id, evidence) {
      return patch(id, async (prev) => {
        const merged = appendUnique(prev.evidence, evidence);
        // Only what is genuinely new is dated: re-citing evidence already on
        // the statement changes nothing, and asking the resolver again for it
        // would fail a statement whose oldest observation has since been
        // deleted.
        const added = merged.slice(prev.evidence.length);
        if (added.length === 0) return prev;
        const span = await spanOfAll(added);
        return {
          ...prev,
          evidence: merged,
          // `established` stays put even when the new evidence is older: see
          // Statement.established.
          lastSupported: laterDay(prev.lastSupported, span.last),
        };
      });
    },

    addContradiction(id, observationId) {
      // Shape-checked rather than resolved, because a contradiction moves no
      // date and so needs no span — but an anchor or a typo landing in this
      // list would name something no reader of it can look up.
      if (!isObservationId(observationId)) {
        throw new Error(`a contradiction names an observation, not: ${observationId}`);
      }
      return patch(id, async (prev) => ({
        ...prev,
        contradictedBy: appendUnique(prev.contradictedBy, [observationId]),
      }));
    },

    async supersede(oldId, input) {
      const all = await readAll();
      const at = all.findIndex((s) => s.id === oldId);
      if (at < 0) return null;
      const statement = await mint(input);
      // The old one keeps everything else it had. It is the record of how that
      // evidence was read at the time, and the replacement is a second reading
      // rather than a correction of the first.
      all[at] = { ...all[at], supersededBy: statement.id };
      all.push(statement);
      await writeAll(all);
      return statement;
    },
  };
}
