// Taking a URL in as a run (docs/55, docs/68): what is written down when the
// model calls ingest_url, and how the answer is worded when it comes back.
//
// The work itself — fetch the page, cut its text into pages, file it under the
// book — is seconds to a minute, and the reader's chat is unusable for all of
// it if the turn waits. So the turn writes one run and ends there, the same rule
// delegate follows (docs/55 「delegate 写下就返回，回合不等」), even though there
// is no model inside this one.
//
// The ask is a file. A run record carries references and never content
// (docs/55), and this ask is three fields rather than one string — the URL, why
// the reader shared it, and the book it becomes a supplement of — so it is
// written as JSON beside the soul's own briefs and the collect task book, under
// the subtree palace registers as `run-brief`.
//
// No host in this file: the tool writes the ask, the worker reads it, and both
// halves are testable without the network.

import { appData } from "../../platform/app/appdata";
import { appRunner } from "../../legion/execute/runner";
import type { Delegated, DelegateInput } from "../../legion/execute/worker";
import type { Run } from "../../legion/run/types";
import type { BoxOrigin } from "../../box";

/** The kind reading registers for taking a URL in. */
export const INGEST_URL_KIND = "ingest-url";

/** Where the ask is kept. The subtree is registered in palace as `run-brief`. */
export const INGEST_ASKS_DIR = "legion/briefs";

/** What one ingest run is asked for. Frozen when the run is created. */
export interface IngestAsk {
  url: string;
  /** Why the reader shared it, in their companion's words. Carried to the prep note. */
  note?: string;
  /** The book this becomes a supplement of (docs/67). */
  bookId: string;
}

/** Write the ask for a run about to be delegated, answering its path. */
export async function writeIngestAsk(ask: IngestAsk): Promise<string> {
  const path = `${INGEST_ASKS_DIR}/ingest-${crypto.randomUUID()}.json`;
  await appData.mkdirp(INGEST_ASKS_DIR);
  await appData.writeAtomic(path, JSON.stringify(ask, null, 2));
  return path;
}

/** Read an ask back. A file with no URL or no book is not one. */
export function parseIngestAsk(text: string): IngestAsk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the ingest ask is not readable JSON");
  }
  const value = parsed as Partial<IngestAsk> | null;
  const url = typeof value?.url === "string" ? value.url.trim() : "";
  const bookId = typeof value?.bookId === "string" ? value.bookId.trim() : "";
  if (!url) throw new Error("the ingest ask names no URL");
  if (!bookId) throw new Error("the ingest ask names no book");
  const note = typeof value?.note === "string" && value.note.trim() ? value.note.trim() : undefined;
  return { url, bookId, ...(note === undefined ? {} : { note }) };
}

/** What starting one ingest run answers: enough to say a run is going. */
export interface StartedIngest {
  runId: string;
  /** Settles when this device has finished the run. Absent when nothing runs it here. */
  done?: Promise<Run>;
}

export interface StartIngestDeps {
  /** The place the turn is being held. The answer is delivered back to it. */
  origin?: BoxOrigin;
  /** Where the ask is put, answering the path. AppData unless injected. */
  write?: (ask: IngestAsk) => Promise<string>;
  /** The runner. This device's own unless a test hands one in. */
  delegate?: (input: DelegateInput) => Promise<Delegated>;
}

/**
 * Write the ask, hand legion the run, and answer without waiting for it.
 *
 * The delegator is the soul: the model asked for this in a turn of its own, and
 * the answer is owed back to the conversation it was asked in — a run a program
 * delegated is acknowledged and never spoken about (soul/bell.ts). Where it is
 * owed back to is filled in here from the place the turn is being held, exactly
 * as delegate does it, so the model cannot address the answer anywhere else.
 */
export async function startUrlIngest(
  ask: IngestAsk,
  deps: StartIngestDeps = {},
): Promise<StartedIngest> {
  const write = deps.write ?? writeIngestAsk;
  const send = deps.delegate ?? ((input: DelegateInput) => appRunner().delegate(input));
  const brief = await write(ask);
  const result = await send({
    kind: INGEST_URL_KIND,
    delegator: { kind: "soul" },
    brief,
    ...(deps.origin === undefined ? {} : { deliverTo: JSON.stringify(deps.origin) }),
  });
  // A refusal is the runner's own sentence, handed back as it is written.
  if (!result.ok) throw new Error(result.reason);
  return { runId: result.run.id, ...(result.done ? { done: result.done } : {}) };
}

/** What the run took in, as the line it leaves behind. */
export interface IngestOutcome {
  title: string;
  kind: "pdf" | "article";
  /** Pages of the copy in the library — the pages a citation counts off. */
  pages: number;
  /** Body characters, which is the size an article is measured in. */
  chars: number;
  /** The prep list's name for it, where this book has a pipeline that took it. */
  slug?: string;
}

/**
 * The one line the run produces (docs/55 「无产出的 run 是失败」). It is written
 * to the run's output file, and it says the three things the reader is owed:
 * what came in, how big it is, and that it is in the book's contents now.
 */
export function ingestOutputLine(outcome: IngestOutcome): string {
  const size = outcome.kind === "article" ? `${outcome.chars} characters` : `${outcome.pages} pages`;
  const readable = outcome.slug
    ? ` Its full text is on this book's prep list as "${outcome.slug}".`
    : "";
  return (
    `Took in "${outcome.title}" (${outcome.kind}, ${size}). It is a supplement of this book ` +
    `now: the reader can open it under the book's contents in the Outline sidebar.${readable}`
  );
}
