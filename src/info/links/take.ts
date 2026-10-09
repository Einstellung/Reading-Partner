// Taking a link in (docs/86 「回路」): the program opens #1, hands the model
// what it read and the reader's words, and lets it open and file candidates
// until it finishes or a cap stops it. The loop is legion/subagent's; the turn
// is injected, so a test scripts it and the app runs it on the daily tier.
//
// Filing is injected too, with the target it files to: info/links builds the
// document and never learns what a book, a topic or the library is.

import { runSubagent } from "../../legion/subagent/run";
import type { SubagentModel, SubagentTurnFn } from "../../legion/subagent/types";
import type { Bound, FetchBytes, PassedThrough } from "../../workshop/bindery";
import type { ExtractReadable } from "../../workshop/extract/readable-select";
import { linkAgent, linkTask } from "./agent";
import { composeReceipt, type LinkStop } from "./receipt";
import type { LinkReader } from "./readers";
import { addressKey, LinkSession, MAX_TOOL_CALLS, type Candidate, type Filed, type FiledInfo, type TrailStep } from "./session";
import type { LinkRecordEntry } from "./store";

export interface LinkIntakeDeps<T, D> {
  fetch: FetchBytes;
  extractReadable?: ExtractReadable;
  readers?: readonly LinkReader[];
  /** File a built document to the target. Throws with a sentence when it cannot. */
  file(built: Bound | PassedThrough, slugBase: string, target: T): Promise<Filed<D>>;
  /** Keep the source record (store.ts in the app). */
  saveRecord(key: string, entry: LinkRecordEntry): Promise<void>;
  /** One model turn of the loop: runSubagentTurnLive in the app, a script in a test. */
  turn: SubagentTurnFn;
  /** What the reader said when sharing the link. */
  note?: string;
  /** The model; unset is the daily tier. */
  model?: SubagentModel;
  /** The host about to be read, for the run's progress line. */
  report?(host: string): void;
  signal?: AbortSignal;
  now?: () => number;
}

export interface LinkIntake<D> {
  documents: D[];
  filed: FiledInfo[];
  /** The receipt's sentence before the documents. */
  lead: string;
  /** The receipt's lines after them. */
  notes: string[];
  stop: LinkStop;
  trail: TrailStep[];
  candidates: Candidate[];
  toolCalls: number;
  rounds: number;
}

function stopOf(session: LinkSession<unknown>, outcome: string, message: string | undefined): LinkStop {
  if (session.finished) return { kind: "finished", note: session.note };
  const at = session.last;
  if (outcome === "failed") return { kind: "broken", at, message: message ?? "the model call failed" };
  if (outcome === "out-of-turns") return { kind: "rounds", at };
  if (outcome === "answered") {
    // The model stopped without calling finish: a finish with no note, unless
    // it stopped because the tool calls ran out.
    return session.toolCalls >= MAX_TOOL_CALLS ? { kind: "steps", at } : { kind: "finished", note: null };
  }
  return { kind: "stopped", at, message: message ?? outcome };
}

/**
 * Take one link in. Throws, with a sentence the chat can say, when #1 could not
 * be read at all and gave nothing to go on, or when the model call broke off
 * before anything was filed; otherwise the intake says what came of it.
 */
export async function takeLinkIn<T, D>(url: string, target: T, deps: LinkIntakeDeps<T, D>): Promise<LinkIntake<D>> {
  const session = new LinkSession<D>(url, {
    fetch: deps.fetch,
    ...(deps.extractReadable ? { extractReadable: deps.extractReadable } : {}),
    ...(deps.readers ? { readers: deps.readers } : {}),
    file: (built, slug) => deps.file(built, slug, target),
    ...(deps.report ? { report: deps.report } : {}),
  });
  const first = await session.open(1);
  const one = session.get(1)!;
  const opened = one.opened!;
  if (opened.content && !opened.content.ok && opened.fresh.length === 0) {
    throw new Error(`Could not read ${url}: ${opened.content.message}.`);
  }

  const brief = await runSubagent(
    { definition: linkAgent(session, deps.model), task: linkTask(first, deps.note), ...(deps.signal ? { signal: deps.signal } : {}) },
    { run: deps.turn },
  );
  const stop = stopOf(session, brief.outcome, brief.failure?.message);

  const reading = opened.reading;
  const title = opened.content?.ok && !("passedThrough" in opened.content) ? opened.content.manuscript.title : "";
  const source = reading
    ? reading.receipt
    : title
      ? `the ${opened.via === "web" ? "web page" : `${opened.via} page`} "${title}"`
      : `the link ${url}`;
  const key = reading?.record.key ?? `web:${addressKey(url)}`;
  await deps.saveRecord(key, {
    source: reading?.record.source ?? "web",
    url,
    record: reading?.record.data ?? { title },
    documents: session.filed.map((f) => f.info.hash),
    trail: session.trail,
    ...(session.note ? { note: session.note } : {}),
    takenAt: (deps.now ?? Date.now)(),
  });

  if (stop.kind === "broken" && session.filed.length === 0) throw new Error(stop.message);
  const { lead, notes } = composeReceipt(session as LinkSession<unknown>, source, stop);
  return {
    documents: session.filed.map((f) => f.document),
    filed: session.filed.map((f) => f.info),
    lead,
    notes,
    stop,
    trail: session.trail,
    candidates: session.candidates,
    toolCalls: session.toolCalls,
    rounds: brief.rounds,
  };
}
